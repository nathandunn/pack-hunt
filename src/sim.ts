import { Rng, utilityDecide, type Candidate, type Personality } from "@precog/sim-core";
import { runBatch } from "@precog/agent-forge/dist/batch.js";

// Board is intentionally roomier than v0.2: more open ground for a pack to
// have to actually earn a cutoff, rather than corner deer against an edge.
export const W = 33, H = 21;

/** Per-wolf move budget (SPEC v0.3 rule 3). Holding position is free; every
 *  other action spends one point. At zero a wolf is exhausted and drops out. */
export const WOLF_STAMINA = 30;

export interface Actor { id: string; x: number; y: number; alive: boolean; p: Personality; }
export interface Wolf extends Actor { stamina: number; exhausted: boolean; }

export interface World { wolves: Wolf[]; deer: Actor[]; turn: number; maxTurns: number; }

export type WolfAction = "chase" | "converge" | "cutoff" | "hold";
export type DeerAction = "flee" | "scatter" | "freeze" | "graze";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const clampX = (x: number) => Math.min(W - 1, Math.max(0, x));
const clampY = (y: number) => Math.min(H - 1, Math.max(0, y));
const key = (x: number, y: number) => `${x},${y}`;

function nearest<T extends { x: number; y: number; alive: boolean }>(a: { x: number; y: number }, xs: T[]): T | null {
  const live = xs.filter(x => x.alive);
  if (!live.length) return null;
  return live.reduce((m, c) => (dist(a, c) < dist(a, m) ? c : m), live[0]);
}

/** Wolves that are still hunting — alive and not exhausted. Exhausted wolves
 *  still occupy their square (no-overlap still applies to them) but are no
 *  longer a threat deer need to react to, and don't get a turn. */
function activeWolves(w: World): Wolf[] { return w.wolves.filter(x => !x.exhausted); }

/** Pack focus: the deer most (active) wolves are already closest to. */
function packTarget(w: World): Actor | null {
  const live = w.deer.filter(d => d.alive);
  if (!live.length) return null;
  const votes = new Map<string, number>();
  for (const wolf of activeWolves(w)) {
    const t = nearest(wolf, live);
    if (t) votes.set(t.id, (votes.get(t.id) ?? 0) + 1);
  }
  let best = live[0], bv = -1;
  for (const d of live) { const v = votes.get(d.id) ?? 0; if (v > bv) { bv = v; best = d; } }
  return best;
}

/** Pure step planner: given a mover at (fx,fy) heading toward (tx,ty), what
 *  cell would it land on? Never mutates — callers decide whether the move
 *  is legal before committing it. */
function planStep(fx: number, fy: number, tx: number, ty: number, speed = 1): { x: number; y: number } {
  const dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
  let x = fx, y = fy;
  if (Math.abs(tx - fx) >= Math.abs(ty - fy)) { x = clampX(fx + dx * speed); if (dy) y = clampY(fy + dy); }
  else { y = clampY(fy + dy * speed); if (dx) x = clampX(fx + dx); }
  return { x, y };
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

export interface HuntResult { caught: number; total: number; turns: number; exhausted: number; }

/** One frame of replay data: every actor's position and chosen action that turn. */
export interface WolfFrame { id: string; x: number; y: number; action: WolfAction | null; stamina: number; exhausted: boolean; attacked: boolean; }
export interface DeerFrame { id: string; x: number; y: number; alive: boolean; action: DeerAction | null; }
export interface TurnSnapshot {
  turn: number;
  wolves: WolfFrame[];
  deer: DeerFrame[];
  /** Deer id the pack is converging on this turn, if any wolf chose converge. */
  focusId: string | null;
  /** Deer ids caught this turn (an attack-adjacent move onto their square). */
  caught: string[];
}

/** Occupant tag used to resolve the no-square-sharing rule and the single
 *  attack exception (a wolf may move onto an adjacent deer's square). */
type Occupant = { kind: "wolf" | "deer"; actor: Actor };

export function runHunt(
  wolfP: Personality, deerP: Personality, nWolves: number, nDeer: number, seed: number,
  maxTurns = 60, replay?: TurnSnapshot[],
): HuntResult {
  const rng = new Rng(seed);
  // Rule 1 (no square sharing) applies from the very first frame, so initial
  // placement is rejection-sampled against every cell claimed so far.
  const spawned = new Set<string>();
  function spawn(x: () => number, y: () => number): { x: number; y: number } {
    let px = 0, py = 0;
    for (let tries = 0; tries < 1000; tries++) {
      px = x(); py = y();
      if (!spawned.has(key(px, py))) break;
    }
    spawned.add(key(px, py));
    return { x: px, y: py };
  }
  const wolves: Wolf[] = Array.from({ length: nWolves }, (_, i) => {
    const pos = spawn(() => rng.int(3), () => rng.int(H));
    return { id: `w${i}`, x: pos.x, y: pos.y, alive: true, p: wolfP, stamina: WOLF_STAMINA, exhausted: false };
  });
  const deer: Actor[] = Array.from({ length: nDeer }, (_, i) => {
    const pos = spawn(() => W - 1 - rng.int(4), () => rng.int(H));
    return { id: `d${i}`, x: pos.x, y: pos.y, alive: true, p: deerP };
  });
  const w: World = { wolves, deer, turn: 0, maxTurns };

  for (
    w.turn = 1;
    w.turn <= maxTurns && deer.some(d => d.alive) && wolves.some(wolf => !wolf.exhausted);
    w.turn++
  ) {
    // Board occupancy at the start of the turn. Updated in place as each
    // actor resolves its move, so later actors in the same turn see the
    // freshest state — sequential, deterministic resolution in array order.
    const occ = new Map<string, Occupant>();
    for (const wolf of wolves) occ.set(key(wolf.x, wolf.y), { kind: "wolf", actor: wolf });
    for (const d of deer) if (d.alive) occ.set(key(d.x, d.y), { kind: "deer", actor: d });

    const focus = packTarget(w);
    let anyConverge = false;
    const wolfFrames: WolfFrame[] = [];
    const caught: string[] = [];

    for (const wolf of wolves) {
      if (wolf.exhausted) {
        wolfFrames.push({ id: wolf.id, x: wolf.x, y: wolf.y, action: null, stamina: wolf.stamina, exhausted: true, attacked: false });
        continue;
      }
      const own = nearest(wolf, deer);
      const destFor: Record<WolfAction, { x: number; y: number }> = {
        chase: own ? planStep(wolf.x, wolf.y, own.x, own.y) : { x: wolf.x, y: wolf.y },
        converge: focus ? planStep(wolf.x, wolf.y, focus.x, focus.y) : { x: wolf.x, y: wolf.y },
        cutoff: own ? planStep(wolf.x, wolf.y, clampX(own.x + 2), own.y) : { x: wolf.x, y: wolf.y },
        hold: { x: wolf.x, y: wolf.y },
      };
      // Rule 1 (no square sharing): filter out any candidate whose destination
      // is occupied, except rule 2's exception — a wolf may always step onto
      // an (adjacent, since this is a single-cell step) live deer's square.
      const legal = wolfCandidates().filter(c => {
        const d = destFor[c.action];
        if (d.x === wolf.x && d.y === wolf.y) return true;
        const occAt = occ.get(key(d.x, d.y));
        return !occAt || occAt.kind === "deer";
      });
      const act = utilityDecide(legal, wolf.p, rng).action;
      const dest = destFor[act];
      let attacked = false;
      if (dest.x !== wolf.x || dest.y !== wolf.y) {
        const occAt = occ.get(key(dest.x, dest.y));
        if (occAt && occAt.kind === "deer") {
          occAt.actor.alive = false;
          caught.push(occAt.actor.id);
          occ.delete(key(dest.x, dest.y));
          attacked = true;
        }
        occ.delete(key(wolf.x, wolf.y));
        wolf.x = dest.x; wolf.y = dest.y;
        occ.set(key(wolf.x, wolf.y), { kind: "wolf", actor: wolf });
        wolf.stamina--;
        if (wolf.stamina <= 0) wolf.exhausted = true;
      }
      if (act === "converge") anyConverge = true;
      wolfFrames.push({ id: wolf.id, x: wolf.x, y: wolf.y, action: act, stamina: wolf.stamina, exhausted: wolf.exhausted, attacked });
    }

    const deerFrames: DeerFrame[] = [];
    for (const d of deer) {
      if (!d.alive) { deerFrames.push({ id: d.id, x: d.x, y: d.y, alive: false, action: null }); continue; }
      const threat = nearest(d, activeWolves(w));
      const td = threat ? dist(d, threat) : 99;
      const fast = rng.next() < 0.35 ? 2 : 1;
      const scatterTarget = { x: rng.int(W), y: rng.int(H) };
      const grazeDx = rng.next() < 0.5 ? 1 : -1, grazeDy = rng.next() < 0.5 ? 1 : -1;
      const destFor: Record<DeerAction, { x: number; y: number }> = {
        flee: threat ? planStep(d.x, d.y, clampX(d.x + (d.x - threat.x)), clampY(d.y + (d.y - threat.y)), fast) : { x: d.x, y: d.y },
        scatter: planStep(d.x, d.y, scatterTarget.x, scatterTarget.y, fast),
        freeze: { x: d.x, y: d.y },
        graze: { x: clampX(d.x + grazeDx), y: clampY(d.y + grazeDy) },
      };
      // Rule 1: deer get no exception — any occupied destination is illegal.
      const legal = deerCandidates(td).filter(c => {
        const dd = destFor[c.action];
        if (dd.x === d.x && dd.y === d.y) return true;
        return !occ.has(key(dd.x, dd.y));
      });
      const act = utilityDecide(legal, d.p, rng).action;
      const dest = destFor[act];
      if (dest.x !== d.x || dest.y !== d.y) {
        occ.delete(key(d.x, d.y));
        d.x = dest.x; d.y = dest.y;
        occ.set(key(d.x, d.y), { kind: "deer", actor: d });
      }
      deerFrames.push({ id: d.id, x: d.x, y: d.y, alive: true, action: act });
    }
    for (const id of caught) { const f = deerFrames.find(x => x.id === id); if (f) f.alive = false; }
    replay?.push({ turn: w.turn, wolves: wolfFrames, deer: deerFrames, focusId: anyConverge && focus ? focus.id : null, caught });
  }
  return {
    caught: deer.filter(d => !d.alive).length,
    total: nDeer,
    turns: w.turn - 1,
    exhausted: wolves.filter(wolf => wolf.exhausted).length,
  };
}

export function runSeries(wolfP: Personality, deerP: Personality, nWolves: number, nDeer: number, n: number, seed = 900): { caughtAvg: number; wipeouts: number; escapes: number; n: number } {
  const t = runBatch({
    trials: n,
    seedBase: seed,
    init: () => ({ caught: 0, wipeouts: 0, escapes: 0 }),
    runTrial: (s, trialSeed) => {
      const r = runHunt(wolfP, deerP, nWolves, nDeer, trialSeed);
      s.caught += r.caught;
      if (r.caught === r.total) s.wipeouts++;
      if (r.caught === 0) s.escapes++;
    },
  });
  return { caughtAvg: t.caught / n, wipeouts: t.wipeouts, escapes: t.escapes, n };
}
