import { Rng, utilityDecide, type Candidate, type Personality } from "@precog/sim-core";

export const W = 16, H = 10;
export interface Actor { id: string; x: number; y: number; alive: boolean; p: Personality; }
export interface World { wolves: Actor[]; deer: Actor[]; turn: number; maxTurns: number; }

export type WolfAction = "chase" | "converge" | "cutoff" | "hold";
export type DeerAction = "flee" | "scatter" | "freeze" | "graze";

const dist = (a: Actor, b: Actor) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const clampX = (x: number) => Math.min(W - 1, Math.max(0, x));
const clampY = (y: number) => Math.min(H - 1, Math.max(0, y));

function nearest(a: Actor, xs: Actor[]): Actor | null {
  const live = xs.filter(x => x.alive);
  if (!live.length) return null;
  return live.reduce((m, c) => (dist(a, c) < dist(a, m) ? c : m), live[0]);
}

/** Pack focus: the deer most wolves are already closest to. */
function packTarget(w: World): Actor | null {
  const live = w.deer.filter(d => d.alive);
  if (!live.length) return null;
  const votes = new Map<string, number>();
  for (const wolf of w.wolves.filter(x => x.alive)) {
    const t = nearest(wolf, live);
    if (t) votes.set(t.id, (votes.get(t.id) ?? 0) + 1);
  }
  let best = live[0], bv = -1;
  for (const d of live) { const v = votes.get(d.id) ?? 0; if (v > bv) { bv = v; best = d; } }
  return best;
}

function step(a: Actor, tx: number, ty: number, speed = 1) {
  const dx = Math.sign(tx - a.x), dy = Math.sign(ty - a.y);
  if (Math.abs(tx - a.x) >= Math.abs(ty - a.y)) { a.x = clampX(a.x + dx * speed); if (dy) a.y = clampY(a.y + dy); }
  else { a.y = clampY(a.y + dy * speed); if (dx) a.x = clampX(a.x + dx); }
}

export function wolfCandidates(): Candidate<WolfAction>[] {
  return [
    { action: "chase",    base: 0.5, considerations: { aggression: 1.0, focus: 0.4 } },
    { action: "converge", base: 0.2, considerations: { cooperation: 1.2, focus: 0.3 } },
    { action: "cutoff",   base: 0.1, considerations: { patience: 0.7, focus: 0.8, risk: 0.3 } },
    { action: "hold",     base: 0.0, considerations: { patience: 0.9, caution: 0.5 } },
  ];
}

export function deerCandidates(threatDist: number): Candidate<DeerAction>[] {
  const close = threatDist <= 3;
  return [
    { action: "flee",    base: close ? 0.9 : 0.3, considerations: { caution: 1.0, risk: -0.3 } },
    { action: "scatter", base: close ? 0.5 : 0.1, considerations: { cooperation: -0.4, risk: 0.6 } },
    { action: "freeze",  base: close ? 0.1 : 0.2, considerations: { patience: 0.7, caution: 0.3 } },
    { action: "graze",   base: close ? 0.0 : 0.6, considerations: { risk: 0.8, patience: 0.4 } },
  ];
}

export interface HuntResult { caught: number; total: number; turns: number; }

export function runHunt(wolfP: Personality, deerP: Personality, nWolves: number, nDeer: number, seed: number, maxTurns = 60, trace?: string[]): HuntResult {
  const rng = new Rng(seed);
  const wolves: Actor[] = Array.from({ length: nWolves }, (_, i) => ({ id: `w${i}`, x: rng.int(3), y: rng.int(H), alive: true, p: wolfP }));
  const deer: Actor[] = Array.from({ length: nDeer }, (_, i) => ({ id: `d${i}`, x: W - 1 - rng.int(4), y: rng.int(H), alive: true, p: deerP }));
  const w: World = { wolves, deer, turn: 0, maxTurns };

  for (w.turn = 1; w.turn <= maxTurns && deer.some(d => d.alive); w.turn++) {
    const focus = packTarget(w);
    for (const wolf of wolves) {
      if (!wolf.alive) continue;
      const act = utilityDecide(wolfCandidates(), wolf.p, rng).action;
      const own = nearest(wolf, deer);
      if (act === "chase" && own) step(wolf, own.x, own.y);
      else if (act === "converge" && focus) step(wolf, focus.x, focus.y);
      else if (act === "cutoff" && own) step(wolf, clampX(own.x + 2), own.y);
      // hold: no move
      if (trace && w.turn <= 12) trace.push(`T${w.turn} ${wolf.id} ${act}`);
    }
    for (const d of deer) {
      if (!d.alive) continue;
      const threat = nearest(d, wolves);
      const td = threat ? dist(d, threat) : 99;
      const act = utilityDecide(deerCandidates(td), d.p, rng).action;
      const fast = rng.next() < 0.35 ? 2 : 1;
      if (act === "flee" && threat) step(d, clampX(d.x + (d.x - threat.x)), clampY(d.y + (d.y - threat.y)), fast);
      else if (act === "scatter") step(d, rng.int(W), rng.int(H), fast);
      else if (act === "graze") step(d, d.x + (rng.next() < 0.5 ? 1 : -1), d.y + (rng.next() < 0.5 ? 1 : -1));
      // freeze: no move
      if (trace && w.turn <= 12) trace.push(`T${w.turn} ${d.id} ${act}`);
    }
    for (const wolf of wolves) for (const d of deer)
      if (wolf.alive && d.alive && dist(wolf, d) === 0) d.alive = false;
  }
  return { caught: deer.filter(d => !d.alive).length, total: nDeer, turns: w.turn - 1 };
}

export function runSeries(wolfP: Personality, deerP: Personality, nWolves: number, nDeer: number, n: number, seed = 900): { caughtAvg: number; wipeouts: number; escapes: number; n: number } {
  let caught = 0, wipeouts = 0, escapes = 0;
  for (let i = 0; i < n; i++) {
    const r = runHunt(wolfP, deerP, nWolves, nDeer, seed + i);
    caught += r.caught;
    if (r.caught === r.total) wipeouts++;
    if (r.caught === 0) escapes++;
  }
  return { caughtAvg: caught / n, wipeouts, escapes, n };
}
