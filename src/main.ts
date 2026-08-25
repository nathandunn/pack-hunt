import { ARCHETYPES, CORE_TRAITS, type Personality } from "@precog/sim-core";
import { runHunt, runSeries, W, H } from "./sim.js";
import { sweepTrait, sweepAll, SHAPE_LABEL, setTrait, type TraitKey } from "@precog/agent-forge/dist/sweep.js";

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

document.getElementById("btnHunt")!.addEventListener("click", () => {
  const trace: string[] = [];
  const r = runHunt(wolfSide.get(), deerSide.get(), +nW.value, +nD.value, Date.now() % 2 ** 31, 60, trace);
  outTitle.textContent = `Single hunt — ${nW.value} wolves vs ${nD.value} deer`;
  const verdict = r.caught === r.total
    ? `<span class="cw">PACK WIPEOUT — all ${r.total} deer caught in ${r.turns} turns</span>`
    : r.caught === 0
      ? `<span class="cd">CLEAN ESCAPE — no deer caught in ${r.turns} turns</span>`
      : `<span class="cn">${r.caught} of ${r.total} caught in ${r.turns} turns</span>`;
  out.innerHTML = `${verdict}\n\n<span class="mut">first turns of decision trace:</span>\n` + trace.slice(0, 40).join("\n");
});

document.getElementById("btnSim")!.addEventListener("click", () => {
  const total = +nD.value;
  const s = runSeries(wolfSide.get(), deerSide.get(), +nW.value, total, 300);
  outTitle.textContent = `Simulation — 300 hunts`;
  out.innerHTML =
    `<span class="mut">wolves: ${wolfSide.get().id} · deer: ${deerSide.get().id} · ${nW.value}v${nD.value}</span>\n\n` +
    `average deer caught: <b>${s.caughtAvg.toFixed(2)}</b> of ${total}\n\n` +
    bar(s.caughtAvg / total * 100, "fw", "catch rate") +
    bar(s.wipeouts / s.n * 100, "fw", "total wipeouts") +
    bar(s.escapes / s.n * 100, "fd", "clean escapes");
});

/** Metric is always "average deer caught" regardless of which side is swept — neutral, comparable. */
function makeEvaluator(side: "wolves" | "deer", n = 90) {
  const wp = wolfSide.get(), dp = deerSide.get();
  const total = +nD.value, nw = +nW.value;
  return (p: Personality): number => {
    const wolfP = side === "wolves" ? p : wp;
    const deerP = side === "deer" ? p : dp;
    const s = runSeries(wolfP, deerP, nw, total, n);
    return s.caughtAvg / total;
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

  outTitle.textContent = `Sweep — ${side} ${trait}, avg deer caught as ${trait} moves 0.0 → 1.0 (150 hunts/step)`;
  const rows = r.points.map(p => `<tr><td>${p.value.toFixed(1)}</td><td>${(p.metric * 100).toFixed(1)}%</td><td><div class="bartrack"><div class="barfill fw" style="width:${(p.metric * 100).toFixed(1)}%"></div></div></td></tr>`).join("");
  out.innerHTML =
    `<div class="summary">best <b>${r.best.value.toFixed(2)}</b> (${(r.best.metric * 100).toFixed(1)}% caught) · worst <b>${r.worst.value.toFixed(2)}</b> (${(r.worst.metric * 100).toFixed(1)}%) · impact <b>${(r.impact * 100).toFixed(1)}pp</b> · ${shapeArrow(r.shape)} ${SHAPE_LABEL[r.shape]}</div>` +
    `<table class="sweep"><tr><th>${trait}</th><th>caught%</th><th></th></tr>${rows}</table>` +
    `<div class="lockrow"><button id="lockBest">Lock ${side} to best (${r.best.value.toFixed(2)})</button><button id="lockWorst" class="ghost">Lock ${side} to worst (${r.worst.value.toFixed(2)})</button></div>`;
  document.getElementById("lockBest")!.addEventListener("click", () => applyLock(side, trait, r.best.value));
  document.getElementById("lockWorst")!.addEventListener("click", () => applyLock(side, trait, r.worst.value));
});

document.getElementById("btnSweepAll")!.addEventListener("click", () => {
  const side = sweepSideSel.value as "wolves" | "deer";
  const base = sideHandle(side).get();
  const evaluate = makeEvaluator(side, 60);
  const results = sweepAll(base, evaluate, 9);

  outTitle.textContent = `Sweep all — every trait on ${side}, ranked by impact (60 hunts/step, 9 steps)`;
  const rows = results.map(r =>
    `<tr><td>${r.trait}</td><td>${(r.impact * 100).toFixed(1)}pp</td><td>${shapeArrow(r.shape)} ${SHAPE_LABEL[r.shape]}</td><td>${r.best.value.toFixed(2)} (${(r.best.metric * 100).toFixed(0)}%)</td><td><button class="mini" data-trait="${r.trait}" data-value="${r.best.value}">lock best</button></td></tr>`
  ).join("");
  out.innerHTML = `<table class="sweep"><tr><th>trait</th><th>impact</th><th>shape</th><th>best</th><th></th></tr>${rows}</table>`;
  out.querySelectorAll<HTMLButtonElement>(".mini").forEach(btn => {
    btn.addEventListener("click", () => applyLock(side, btn.dataset.trait as TraitKey, +btn.dataset.value!));
  });
});
