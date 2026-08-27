import { ARCHETYPES, CORE_TRAITS, type Personality } from "@precog/sim-core";
import {
  runHunt, runSeries, FIELD_W, FIELD_H, GOAL_X, TOUCH_R, MAX_TICKS, TUNING,
  type TickFrame, type HuntResult, type WolfAction, type DeerAction,
} from "./sim.js";
import { sweepTrait, sweepAll, SHAPE_LABEL, setTrait, type TraitKey } from "@precog/agent-forge/dist/sweep.js";
import { evolve } from "@precog/agent-forge/dist/evolve.js";

const TRAITS = [...CORE_TRAITS, "randomness"] as const;
const clone = (p: Personality): Personality => JSON.parse(JSON.stringify(p));

interface SideHandle {
  get: () => Personality;
  set: (p: Personality) => void;
}

function buildSide(rootId: string, def: string): SideHandle {
  const root = document.getElementById(rootId)!;
  const sel = document.createElement("select");
  for (const k of Object.keys(ARCHETYPES)) sel.append(new Option(k, k));
  sel.value = def;
  const lbl = document.createElement("label"); lbl.textContent = "Personality preset";
  root.append(lbl, sel);
  const sl: Record<string, HTMLInputElement> = {}, vv: Record<string, HTMLElement> = {}, lk: Record<string, HTMLElement> = {};
  const tl = document.createElement("label"); tl.textContent = "Traits"; root.append(tl);
  for (const t of TRAITS) {
    const row = document.createElement("div"); row.className = "trait";
    const n = document.createElement("span"); n.textContent = t;
    const i = document.createElement("input");
    i.type = "range"; i.min = "0"; i.max = "1"; i.step = "0.05";
    const v = document.createElement("span"); v.className = "v";
    const lock = document.createElement("span"); lock.className = "lockmark";
    row.append(n, i, v, lock); root.append(row); sl[t] = i; vv[t] = v; lk[t] = lock;
    i.addEventListener("input", () => { v.textContent = (+i.value).toFixed(2); lock.textContent = ""; });
  }
  const apply = (p: Personality) => {
    for (const t of CORE_TRAITS) { sl[t].value = String(p.traits[t]); vv[t].textContent = p.traits[t].toFixed(2); }
    sl.randomness.value = String(p.randomness); vv.randomness.textContent = p.randomness.toFixed(2);
    for (const t of TRAITS) lk[t].textContent = "";
  };
  apply(clone(ARCHETYPES[def]));
  sel.addEventListener("change", () => apply(clone(ARCHETYPES[sel.value])));
  const get = (): Personality => {
    const traits: Record<string, number> = {};
    for (const t of CORE_TRAITS) traits[t] = +sl[t].value;
    return { id: sel.value, name: sel.value, archetype: sel.value, traits: traits as Personality["traits"], randomness: +sl.randomness.value };
  };
  const set = (p: Personality) => {
    for (const t of CORE_TRAITS) { sl[t].value = String(p.traits[t]); vv[t].textContent = p.traits[t].toFixed(2); }
    sl.randomness.value = String(p.randomness); vv.randomness.textContent = p.randomness.toFixed(2);
  };
  (root as any)._lockMarks = lk;
  return { get, set };
}

const wolfSide = buildSide("sideW", "teamplayer");
const deerSide = buildSide("sideD", "defender");
const nW = document.getElementById("nWolves") as HTMLInputElement;
const nD = document.getElementById("nDeer") as HTMLInputElement;
const out = document.getElementById("out")!;
const outTitle = document.getElementById("outTitle")!;
const sweepSideSel = document.getElementById("sweepSide") as HTMLSelectElement;

function sideHandle(which: "wolves" | "deer") { return which === "wolves" ? wolfSide : deerSide; }
function lockMarksOf(which: "wolves" | "deer") { return (document.getElementById(which === "wolves" ? "sideW" : "sideD") as any)._lockMarks as Record<string, HTMLElement>; }

function bar(pct: number, cls: string, label: string) {
  return `<div class="barrow"><div class="barlbl">${label}</div><div class="bartrack"><div class="barfill ${cls}" style="width:${pct.toFixed(1)}%"></div></div><div class="barval">${pct.toFixed(1)}%</div></div>`;
}
function shapeArrow(shape: string) {
  return ({ up: "↑", down: "↓", peaked: "▲", valley: "▼", flat: "–" } as Record<string, string>)[shape] ?? "";
}

// ── smooth field player (renders recorded frames, interpolated) ────
const canvas = document.getElementById("huntCanvas") as HTMLCanvasElement;
canvas.width = FIELD_W;
canvas.height = FIELD_H;
const ctx = canvas.getContext("2d")!;
const turnLbl = document.getElementById("turnLbl")!;
const remainLbl = document.getElementById("remainLbl")!;
const wolvesLbl = document.getElementById("wolvesLbl")!;
const playBtn = document.getElementById("playBtn") as HTMLButtonElement;
const stepBtn = document.getElementById("stepBtn") as HTMLButtonElement;
const restartBtn = document.getElementById("restartBtn") as HTMLButtonElement;
const speedSel = document.getElementById("speedSel") as HTMLSelectElement;
const scrub = document.getElementById("scrub") as HTMLInputElement;

let frames: TickFrame[] = [];
let result: HuntResult | null = null;
let cursor = 0;                 // fractional frame index — positions interpolate
let playing = false;
let timer: number | null = null;
/** Catch/escape events indexed for the flash effects: tick + location. */
let flashes: { tick: number; x: number; y: number; kind: "catch" | "escape" }[] = [];

const WOLF_TINT: Record<WolfAction, string> = {
  chase: "#e07b3c", intercept: "#f0c060", cordon: "#d4a24c", guard: "#9a9a58",
};
const DEER_TINT: Record<DeerAction, string> = {
  dash: "#8fc98a", thread: "#aee08a", arc: "#7ab890", jink: "#c9e498",
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function drawField() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#181d15";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // the goal: the deer escapes across this line on the LEFT edge
  ctx.fillStyle = "rgba(143,201,138,0.10)";
  ctx.fillRect(0, 0, GOAL_X + 16, FIELD_H);
  ctx.strokeStyle = "#8fc98a";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath(); ctx.moveTo(GOAL_X + 16, 0); ctx.lineTo(GOAL_X + 16, FIELD_H); ctx.stroke();
  ctx.setLineDash([]);
  ctx.save();
  ctx.translate(12, FIELD_H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "rgba(143,201,138,0.55)";
  ctx.font = '11px "IBM Plex Mono",monospace';
  ctx.textAlign = "center";
  ctx.fillText("ESCAPE", 0, 0);
  ctx.restore();
}

function drawAt(c: number) {
  drawField();
  if (!frames.length) return;
  const i0 = Math.min(frames.length - 1, Math.floor(c));
  const i1 = Math.min(frames.length - 1, i0 + 1);
  const t = c - i0;
  const f0 = frames[i0], f1 = frames[i1];

  // wolves — triangles oriented along heading, tinted by action
  for (let i = 0; i < f0.wolves.length; i++) {
    const a = f0.wolves[i], b = f1.wolves[i];
    const x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a.h);
    ctx.fillStyle = WOLF_TINT[a.action];
    ctx.beginPath();
    ctx.moveTo(10, 0); ctx.lineTo(-7, 6); ctx.lineTo(-4, 0); ctx.lineTo(-7, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // touch radius, faint — the catch circle is the whole game
    ctx.strokeStyle = "rgba(212,162,76,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, TOUCH_R, 0, Math.PI * 2); ctx.stroke();
  }

  // deer — circle with a heading nose, visibly outpacing the pack
  for (let i = 0; i < f0.deer.length; i++) {
    const a = f0.deer[i], b = f1.deer[i];
    if (a.escaped) continue;                      // already off the field
    const x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t);
    if (!a.alive) {                               // caught — leave a marker
      ctx.strokeStyle = "#c96a4a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5);
      ctx.moveTo(x - 5, y + 5); ctx.lineTo(x + 5, y - 5);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = DEER_TINT[a.action];
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a.h) * 13, y + Math.sin(a.h) * 13);
    ctx.stroke();
  }

  // event flashes — expanding ring for ~22 ticks after a catch / escape
  for (const fl of flashes) {
    const age = c - fl.tick;
    if (age < 0 || age > 22) continue;
    const k = age / 22;
    ctx.strokeStyle = fl.kind === "catch" ? `rgba(240,120,80,${1 - k})` : `rgba(143,201,138,${1 - k})`;
    ctx.lineWidth = 3 - 2 * k;
    ctx.beginPath(); ctx.arc(fl.x, fl.y, 8 + k * 46, 0, Math.PI * 2); ctx.stroke();
  }

  // win banner on the final frame
  if (result && c >= frames.length - 1.001) {
    const deerWin = result.winner === "deer";
    ctx.fillStyle = "rgba(16,19,15,0.72)";
    ctx.fillRect(0, FIELD_H / 2 - 44, FIELD_W, 88);
    ctx.fillStyle = deerWin ? "#8fc98a" : "#e07b3c";
    ctx.font = '800 44px "Bitter",Georgia,serif';
    ctx.textAlign = "center";
    ctx.fillText(deerWin ? (result.capped ? "SURVIVED" : "ESCAPED") : "CAUGHT", FIELD_W / 2, FIELD_H / 2 + 8);
    ctx.font = '13px "IBM Plex Mono",monospace';
    ctx.fillStyle = "#7e8875";
    ctx.fillText(
      deerWin ? `the deer crossed in ${result.ticks} ticks` : `the pack closed the cordon in ${result.ticks} ticks`,
      FIELD_W / 2, FIELD_H / 2 + 32,
    );
  }
}

function renderCurrent() {
  drawAt(cursor);
  const f = frames[Math.min(frames.length - 1, Math.floor(cursor))] ?? null;
  turnLbl.textContent = `tick ${frames.length ? Math.floor(cursor) + 1 : 0} / ${frames.length}`;
  scrub.max = String(Math.max(0, frames.length - 1));
  scrub.value = String(Math.floor(cursor));
  if (f) {
    const escaped = f.deer.filter(d => d.escaped).length;
    const caught = f.deer.filter(d => !d.alive).length;
    // best progress across the field: escaped = 100%, caught deer freeze where they fell
    const lead = Math.max(...f.deer.map(d => d.escaped ? 1 : 1 - (d.x - GOAL_X) / (TUNING.deerSpawnX - GOAL_X)));
    remainLbl.textContent = `progress ${(Math.max(0, Math.min(1, lead)) * 100).toFixed(0)}% · ${escaped} escaped · ${caught} caught`;
    const counts = new Map<string, number>();
    for (const w of f.wolves) counts.set(w.action, (counts.get(w.action) ?? 0) + 1);
    wolvesLbl.textContent = [...counts.entries()].map(([a, n]) => `${a}×${n}`).join(" ");
  } else {
    remainLbl.textContent = "progress —";
    wolvesLbl.textContent = "";
  }
}

function stopPlaying() {
  playing = false;
  playBtn.textContent = "▶ Play";
  if (timer !== null) { clearInterval(timer); timer = null; }
}

function startPlaying() {
  if (!frames.length) return;
  if (cursor >= frames.length - 1) cursor = 0;
  playing = true;
  playBtn.textContent = "⏸ Pause";
  const rate = { "1x": 1, "2x": 2, "4x": 4 }[speedSel.value] ?? 1;
  if (timer !== null) clearInterval(timer);
  timer = window.setInterval(() => {
    cursor += rate;
    if (cursor >= frames.length - 1) { cursor = frames.length - 1; renderCurrent(); stopPlaying(); return; }
    renderCurrent();
  }, 33);
}

playBtn.addEventListener("click", () => { playing ? stopPlaying() : startPlaying(); });
stepBtn.addEventListener("click", () => {
  stopPlaying();
  cursor = Math.min(frames.length - 1, Math.floor(cursor) + 1);
  renderCurrent();
});
restartBtn.addEventListener("click", () => { stopPlaying(); cursor = 0; renderCurrent(); });
speedSel.addEventListener("change", () => { if (playing) startPlaying(); });
scrub.addEventListener("input", () => { stopPlaying(); cursor = +scrub.value; renderCurrent(); });

document.getElementById("btnHunt")!.addEventListener("click", () => {
  stopPlaying();
  frames = [];
  result = runHunt(wolfSide.get(), deerSide.get(), +nW.value, +nD.value, Date.now() % 2 ** 31, MAX_TICKS, frames);
  flashes = [];
  for (const f of frames) {
    for (const ev of f.caught) {
      const d = f.deer.find(x => x.id === ev.deerId)!;
      flashes.push({ tick: f.tick, x: d.x, y: d.y, kind: "catch" });
    }
    for (const id of f.escaped) {
      const d = f.deer.find(x => x.id === id)!;
      flashes.push({ tick: f.tick, x: Math.max(d.x, 4), y: d.y, kind: "escape" });
    }
  }
  cursor = 0;
  renderCurrent();
  outTitle.textContent = `Single hunt — ${nW.value} wolves vs ${nD.value} deer`;
  const verdict = result.winner === "deer"
    ? `<span class="cd">${result.capped ? "SURVIVED — the backstop cap ended it" : "ESCAPED"} — ${result.escaped} of ${result.total} deer crossed in ${result.ticks} ticks</span>`
    : `<span class="cw">CAUGHT — the pack took ${result.caught} of ${result.total} deer in ${result.ticks} ticks</span>`;
  out.innerHTML = verdict;
  startPlaying();
});
// ── end field player ──────────────────────────────────────────────

document.getElementById("btnSim")!.addEventListener("click", () => {
  const s = runSeries(wolfSide.get(), deerSide.get(), +nW.value, +nD.value, 300);
  outTitle.textContent = `Simulation — 300 hunts`;
  out.innerHTML =
    `<span class="mut">wolves: ${wolfSide.get().id} · deer: ${deerSide.get().id} · ${nW.value}v${nD.value}</span>\n\n` +
    `deer wins: <b>${s.deerWins}</b> · wolf wins: <b>${s.wolfWins}</b> · avg length <b>${s.avgTicks.toFixed(0)}</b> ticks\n\n` +
    bar(s.deerWinRate * 100, "fd", "deer win rate") +
    bar((1 - s.deerWinRate) * 100, "fw", "wolf win rate");
});

/** Metric: win rate FOR THE SELECTED SIDE over N seeded hunts. */
function makeEvaluator(side: "wolves" | "deer", n = 90) {
  const wp = wolfSide.get(), dp = deerSide.get();
  const total = +nD.value, nw = +nW.value;
  return (p: Personality): number => {
    const wolfP = side === "wolves" ? p : wp;
    const deerP = side === "deer" ? p : dp;
    const s = runSeries(wolfP, deerP, nw, total, n);
    return side === "deer" ? s.deerWinRate : 1 - s.deerWinRate;
  };
}

function applyLock(side: "wolves" | "deer", trait: TraitKey, value: number) {
  const handle = sideHandle(side);
  handle.set(setTrait(handle.get(), trait, value));
  lockMarksOf(side)[trait].textContent = "🔒";
}

document.getElementById("btnSweep")!.addEventListener("click", () => {
  const side = sweepSideSel.value as "wolves" | "deer";
  const trait = (document.getElementById("sweepTrait") as HTMLSelectElement).value as TraitKey;
  const base = sideHandle(side).get();
  const evaluate = makeEvaluator(side, 150);
  const r = sweepTrait(base, trait, evaluate, 11);

  outTitle.textContent = `Sweep — ${side} ${trait}, ${side} win rate as ${trait} moves 0.0 → 1.0 (150 hunts/step)`;
  const cls = side === "deer" ? "fd" : "fw";
  const rows = r.points.map(p => `<tr><td>${p.value.toFixed(1)}</td><td>${(p.metric * 100).toFixed(1)}%</td><td><div class="bartrack"><div class="barfill ${cls}" style="width:${(p.metric * 100).toFixed(1)}%"></div></div></td></tr>`).join("");
  out.innerHTML =
    `<div class="summary">best <b>${r.best.value.toFixed(2)}</b> (${(r.best.metric * 100).toFixed(1)}% wins) · worst <b>${r.worst.value.toFixed(2)}</b> (${(r.worst.metric * 100).toFixed(1)}%) · impact <b>${(r.impact * 100).toFixed(1)}pp</b> · ${shapeArrow(r.shape)} ${SHAPE_LABEL[r.shape]}</div>` +
    `<table class="sweep"><tr><th>${trait}</th><th>win%</th><th></th></tr>${rows}</table>` +
    `<div class="lockrow"><button id="lockBest">Lock ${side} to best (${r.best.value.toFixed(2)})</button><button id="lockWorst" class="ghost">Lock ${side} to worst (${r.worst.value.toFixed(2)})</button></div>`;
  document.getElementById("lockBest")!.addEventListener("click", () => applyLock(side, trait, r.best.value));
  document.getElementById("lockWorst")!.addEventListener("click", () => applyLock(side, trait, r.worst.value));
});

document.getElementById("btnSweepAll")!.addEventListener("click", () => {
  const side = sweepSideSel.value as "wolves" | "deer";
  const base = sideHandle(side).get();
  const evaluate = makeEvaluator(side, 60);
  const results = sweepAll(base, evaluate, 9);

  outTitle.textContent = `Sweep all — every trait on ${side}, ranked by impact on ${side} win rate (60 hunts/step, 9 steps)`;
  const rows = results.map(r =>
    `<tr><td>${r.trait}</td><td>${(r.impact * 100).toFixed(1)}pp</td><td>${shapeArrow(r.shape)} ${SHAPE_LABEL[r.shape]}</td><td>${r.best.value.toFixed(2)} (${(r.best.metric * 100).toFixed(0)}%)</td><td><button class="mini" data-trait="${r.trait}" data-value="${r.best.value}">lock best</button></td></tr>`
  ).join("");
  out.innerHTML = `<table class="sweep"><tr><th>trait</th><th>impact</th><th>shape</th><th>best</th><th></th></tr>${rows}</table>`;
  out.querySelectorAll<HTMLButtonElement>(".mini").forEach(btn => {
    btn.addEventListener("click", () => applyLock(side, btn.dataset.trait as TraitKey, +btn.dataset.value!));
  });
});

/** Optimizer stage 2: evolve all 7 traits of one side at once against the fixed opponent. */
document.getElementById("btnEvolve")!.addEventListener("click", () => {
  const side = sweepSideSel.value as "wolves" | "deer";
  const base = sideHandle(side).get();
  const POP = 14, GENS = 10, N = 30;
  const evaluate = makeEvaluator(side, N);   // already win-rate-for-the-selected-side
  const genRows: string[] = [];
  const r = evolve({
    evaluate, base, seed: 9000, popSize: POP, generations: GENS,
    onGeneration: g => genRows.push(`<tr><td>${g.generation}</td><td>${(g.bestFitness * 100).toFixed(1)}%</td><td>${(g.meanFitness * 100).toFixed(1)}%</td></tr>`),
  });

  outTitle.textContent = `Evolve — ${side}, pop ${POP} × ${GENS} generations (${r.evaluations} evaluations × ${N} hunts = ${r.evaluations * N} hunts)`;
  const gene = (t: TraitKey) => t === "randomness" ? r.best.randomness : r.best.traits[t];
  const vector = TRAITS.map(t => `${t} <b>${gene(t).toFixed(2)}</b>`).join(" · ");
  out.innerHTML =
    `<div class="summary">best ${side} win rate <b>${(r.bestFitness * 100).toFixed(1)}%</b> · started at ${(r.history[0].bestFitness * 100).toFixed(1)}%</div>` +
    `<table class="sweep"><tr><th>gen</th><th>best win%</th><th>mean win%</th></tr>${genRows.join("")}</table>` +
    `<div class="summary">${vector}</div>` +
    `<div class="lockrow"><button id="applyEvolved">Apply best to ${side}</button></div>`;
  document.getElementById("applyEvolved")!.addEventListener("click", () => {
    sideHandle(side).set(r.best);
    const marks = lockMarksOf(side);
    for (const t of TRAITS) marks[t].textContent = "🧬";
  });
});

renderCurrent();
