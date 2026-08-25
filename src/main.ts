import { ARCHETYPES, CORE_TRAITS, type Personality } from "@precog/sim-core";
import { runHunt, runSeries, W, H } from "./sim.js";

const TRAITS = [...CORE_TRAITS, "randomness"] as const;
const clone = (p: Personality): Personality => JSON.parse(JSON.stringify(p));

function buildSide(rootId: string, def: string): () => Personality {
  const root = document.getElementById(rootId)!;
  const sel = document.createElement("select");
  for (const k of Object.keys(ARCHETYPES)) sel.append(new Option(k, k));
  sel.value = def;
  const lbl = document.createElement("label"); lbl.textContent = "Personality preset";
  root.append(lbl, sel);
  const sl: Record<string, HTMLInputElement> = {}, vv: Record<string, HTMLElement> = {};
  const tl = document.createElement("label"); tl.textContent = "Traits"; root.append(tl);
  for (const t of TRAITS) {
    const row = document.createElement("div"); row.className = "trait";
    const n = document.createElement("span"); n.textContent = t;
    const i = document.createElement("input");
    i.type = "range"; i.min = "0"; i.max = "1"; i.step = "0.05";
    const v = document.createElement("span"); v.className = "v";
    row.append(n, i, v); root.append(row); sl[t] = i; vv[t] = v;
    i.addEventListener("input", () => { v.textContent = (+i.value).toFixed(2); });
  }
  const apply = (p: Personality) => {
    for (const t of CORE_TRAITS) { sl[t].value = String(p.traits[t]); vv[t].textContent = p.traits[t].toFixed(2); }
    sl.randomness.value = String(p.randomness); vv.randomness.textContent = p.randomness.toFixed(2);
  };
  apply(clone(ARCHETYPES[def]));
  sel.addEventListener("change", () => apply(clone(ARCHETYPES[sel.value])));
  return () => {
    const traits: Record<string, number> = {};
    for (const t of CORE_TRAITS) traits[t] = +sl[t].value;
    return { id: sel.value, name: sel.value, archetype: sel.value, traits: traits as Personality["traits"], randomness: +sl.randomness.value };
  };
}

const getWolf = buildSide("sideW", "teamplayer");
const getDeer = buildSide("sideD", "defender");
const nW = document.getElementById("nWolves") as HTMLInputElement;
const nD = document.getElementById("nDeer") as HTMLInputElement;
const out = document.getElementById("out")!;
const outTitle = document.getElementById("outTitle")!;

function bar(pct: number, cls: string, label: string) {
  return `<div class="barrow"><div class="barlbl">${label}</div><div class="bartrack"><div class="barfill ${cls}" style="width:${pct.toFixed(1)}%"></div></div><div class="barval">${pct.toFixed(1)}%</div></div>`;
}

document.getElementById("btnHunt")!.addEventListener("click", () => {
  const trace: string[] = [];
  const r = runHunt(getWolf(), getDeer(), +nW.value, +nD.value, Date.now() % 2 ** 31, 60, trace);
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
  const s = runSeries(getWolf(), getDeer(), +nW.value, total, 300);
  outTitle.textContent = `Simulation — 300 hunts`;
  out.innerHTML =
    `<span class="mut">wolves: ${getWolf().id} · deer: ${getDeer().id} · ${nW.value}v${nD.value}</span>\n\n` +
    `average deer caught: <b>${s.caughtAvg.toFixed(2)}</b> of ${total}\n\n` +
    bar(s.caughtAvg / total * 100, "fw", "catch rate") +
    bar(s.wipeouts / s.n * 100, "fw", "total wipeouts") +
    bar(s.escapes / s.n * 100, "fd", "clean escapes");
});

document.getElementById("btnSweep")!.addEventListener("click", () => {
  const trait = (document.getElementById("sweepTrait") as HTMLSelectElement).value;
  const total = +nD.value;
  const rows: string[] = [];
  for (let s = 0; s <= 10; s++) {
    const v = s / 10;
    const wp = getWolf();
    if (trait === "randomness") wp.randomness = v; else wp.traits[trait] = v;
    const r = runSeries(wp, getDeer(), +nW.value, total, 150);
    rows.push(`<tr><td>${v.toFixed(1)}</td><td>${r.caughtAvg.toFixed(2)}</td><td><div class="bartrack"><div class="barfill fw" style="width:${(r.caughtAvg / total * 100).toFixed(1)}%"></div></div></td></tr>`);
  }
  outTitle.textContent = `Sweep — wolf ${trait} 0.0 → 1.0 (150 hunts per step)`;
  out.innerHTML = `<table class="sweep"><tr><th>${trait}</th><th>avg caught</th><th></th></tr>${rows.join("")}</table>`;
});
