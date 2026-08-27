/**
 * Pack Hunt v0.4 — "the crossing".
 *
 * Pure simulation, no DOM: continuous 2D field, fixed deterministic ticks,
 * one seeded sim-core Rng per hunt. The hunt is simulated once up front and a
 * frame log recorded; the UI renders from frames (playback + scrubbing free),
 * the Lab tooling (Simulate / Sweep / Evolve) runs it headless — the same
 * pattern as battle-bots' arena.
 *
 * The game: the deer spawns near the RIGHT edge and must reach the LEFT edge.
 * Wolves spawn as a loose cordon between it and the goal. Reaching the left
 * edge is a deer win; a wolf getting within TOUCH_R is a wolf win. There is no
 * clock win — MAX_TICKS is purely an infinite-loop backstop and counts as a
 * deer win (the deer survived).
 *
 * The deer moves at EXACTLY 2× wolf speed (fixed by SPEC v0.4 — never tune
 * this ratio). The wolves' only edge is numbers and position: pure pursuit
 * from behind loses to a 2× deer every time, so wolf play is built around
 *   - intercept: a closed-form lead solution on the deer's current velocity
 *     (with a risk-scaled gamble on a predicted cut when no solution exists),
 *   - cordon: assigned lanes on a line that gives ground but stays between
 *     the deer and the goal (cooperation = lane discipline & spacing),
 *   - guard: a deep post just in front of the goal line.
 *
 * Trait mapping (see wolfCandidates / deerCandidates):
 *   wolves — cooperation = cordon spacing & lane discipline; aggression =
 *     direct chase vs holding the line; patience = waiting in the lane;
 *     focus = clean intercept angles; risk = gambling on a predicted cut.
 *   deer — risk = threading between wolves vs wide arcs; caution = safety
 *     margin from the nearest wolf; randomness = feints/jinks; focus =
 *     reading gaps in the cordon (low focus misreads wolf positions).
 */
import { Rng, utilityDecide, type Candidate, type Personality } from "@precog/sim-core";
import { runBatch } from "@precog/agent-forge/dist/batch.js";

// ── world constants ───────────────────────────────────────────────
export const FIELD_W = 900;
export const FIELD_H = 520;
export const WOLF_SPEED = 1.5;                  // units / tick
export const DEER_SPEED = WOLF_SPEED * 2;       // SPEC v0.4: exactly 2× — fixed
export const TOUCH_R = 12;                      // catch = wolf within this of the deer
export const GOAL_X = 6;                        // deer escapes when x <= GOAL_X
export const MAX_TICKS = 3000;                  // infinite-loop backstop only (counts as deer win)
export const TICKS_PER_SEC = 30;                // playback timebase only

/**
 * Balance knobs (SPEC v0.4: tune these — never the 2× speed ratio).
 * Exported as a mutable object so tuning scripts can search the space
 * without rebuilds; the values below are the shipped defaults.
 */
export const TUNING = {
  deerSpawnX: FIELD_W - 36,   // deer spawn line (right edge)
  cordonX: 330,               // wolf spawn / initial cordon line
  cordonLead: 165,            // cordon stays this far goal-side of the deer
  guardX: 44,                 // deepest the line retreats (the last stand)
  deerTurn: 0.14,             // deer turn rate, rad/tick (2× speed, wide radius)
  wolfTurn: 0.34,             // wolf turn rate, rad/tick (slower = nimbler)
  deerDecide: 8,              // deer re-decides every N ticks
  wolfDecide: 8,              // wolves re-decide every N ticks (staggered)
  cordonSpacingMin: 26,       // fence spacing at cooperation 0 (a clump on the deer) …
  cordonSpacingSpan: 42,      //   … plus this much at cooperation 1 (a wide disciplined fence)
  gapNoise: 55,               // max misread of a wolf's y at focus 0 (units)
  panicBase: 34,              // repulsion radius at caution 0 …
  panicSpan: 62,              //   … plus this much at caution 1
};

const HOLD_EPS = 3;           // a wolf this close to its post holds still (patience visible)
const WALL = 34;              // deer steers off the top/bottom walls inside this margin

export type WolfAction = "chase" | "intercept" | "cordon" | "guard";
export type DeerAction = "dash" | "thread" | "arc" | "jink";

// ── entities ──────────────────────────────────────────────────────
interface WolfEnt {
  id: string; x: number; y: number; h: number;   // h = heading, radians
  laneY: number;                                 // assigned cordon lane center
  action: WolfAction;
}
interface DeerEnt {
  id: string; x: number; y: number; h: number;
  alive: boolean; escaped: boolean;
  action: DeerAction;
  tx: number; ty: number;                        // committed steering target
}

// ── frames ────────────────────────────────────────────────────────
export interface WolfFrame { id: string; x: number; y: number; h: number; action: WolfAction; }
export interface DeerFrame { id: string; x: number; y: number; h: number; alive: boolean; escaped: boolean; action: DeerAction; }
export interface CatchEvent { deerId: string; wolfId: string; }
export interface TickFrame {
  tick: number;
  wolves: WolfFrame[];
  deer: DeerFrame[];
  /** Catches that landed this tick (wolf within TOUCH_R). */
  caught: CatchEvent[];
  /** Deer ids that crossed the goal line this tick. */
  escaped: string[];
}

export interface HuntResult {
  winner: "deer" | "wolves";
  caught: number;
  escaped: number;
  total: number;
  ticks: number;
  capped: boolean;    // tick-cap backstop fired (counts as a deer win)
}

// ── math helpers ──────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const TAU = Math.PI * 2;
/** Signed smallest angle from a to b, in (-π, π]. */
function angDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}
/** Rotate heading toward a desired angle, clamped by a per-tick turn rate. */
function turnToward(h: number, want: number, rate: number): number {
  const d = angDiff(h, want);
  return h + clamp(d, -rate, rate);
}

/**
 * Closed-form intercept: earliest t where a pursuer at (wx,wy) moving at
 * speed s can meet a target at (dx,dy) with velocity (vx,vy). Returns the
 * meet point, or null when no solution exists within tCap (the deer is
 * faster, so a solution only exists while its course closes with the wolf).
 */
export function interceptPoint(
  wx: number, wy: number, dx: number, dy: number,
  vx: number, vy: number, s: number, tCap: number,
): { x: number; y: number } | null {
  const rx = dx - wx, ry = dy - wy;
  const a = vx * vx + vy * vy - s * s;
  const b = 2 * (rx * vx + ry * vy);
  const c = rx * rx + ry * ry;
  let t: number | null = null;
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) { const tt = -c / b; if (tt > 1e-6) t = tt; }
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
      if (t1 > 1e-6) t = t1;
      else if (t2 > 1e-6) t = t2;
    }
  }
  if (t === null || t > tCap) return null;
  return { x: dx + vx * t, y: dy + vy * t };
}

// ── candidate sets (exported for tests / docs) ────────────────────
/**
 * Wolf action utilities. `near` ∈ [0,1] is proximity to the deer, `ahead`
 * is whether the wolf is still goal-side of it. A wolf that has been passed
 * can only chase (hopeless at ½ speed) — position is everything.
 */
export function wolfCandidates(near: number, ahead: boolean): Candidate<WolfAction>[] {
  return [
    { action: "chase",                             // straight at the deer — works from in FRONT
      base: 0.12 + 0.5 * near + (ahead ? 0 : 0.3),
      considerations: { aggression: 1.0, patience: -0.35 } },
    { action: "intercept",                         // lead the deer's velocity to a meet point
      base: 0.34 + 0.22 * near,
      considerations: { focus: 0.85, risk: 0.3, aggression: 0.15 } },
    { action: "cordon",                            // hold the assigned lane on the retreating line
      base: ahead ? 0.52 : 0.02,
      considerations: { cooperation: 1.1, patience: 0.45, aggression: -0.3 } },
    { action: "guard",                             // deep post just in front of the goal line
      base: ahead ? 0.16 : 0.0,
      considerations: { patience: 0.7, caution: 0.75, risk: -0.2 } },
  ];
}

/** Deer action utilities. `near` ∈ [0,1] is proximity of the nearest wolf. */
export function deerCandidates(p: Personality, near: number): Candidate<DeerAction>[] {
  return [
    { action: "dash",                              // commit to the best-scored gap
      base: 0.55,
      considerations: { focus: 0.45, patience: 0.2 } },
    { action: "thread",                            // most DIRECT gap, however narrow
      base: 0.14 + 0.3 * near,
      considerations: { risk: 1.0, caution: -0.55 } },
    { action: "arc",                               // swing wide around the whole line
      base: 0.2,
      considerations: { caution: 0.9, risk: -0.35 } },
    { action: "jink",                              // perpendicular feint for a few ticks
      base: 0.04 + p.randomness * 0.5 + 0.28 * near,
      considerations: { focus: -0.2 } },
  ];
}

// ── gap reading ───────────────────────────────────────────────────
interface Gap { center: number; half: number; }

/** Corridors between the wolves ahead of the deer (plus the two wall gaps). */
function readGaps(ys: number[]): Gap[] {
  const sorted = [...ys].sort((a, b) => a - b);
  const gaps: Gap[] = [];
  let prev = 0;
  for (const y of [...sorted, FIELD_H]) {
    gaps.push({ center: (prev + y) / 2, half: (y - prev) / 2 });
    prev = y;
  }
  return gaps;
}

// ── the hunt ──────────────────────────────────────────────────────
export function runHunt(
  wolfP: Personality, deerP: Personality, nWolves: number, nDeer: number, seed: number,
  maxTicks = MAX_TICKS, record?: TickFrame[],
): HuntResult {
  const rng = new Rng(seed);
  const T = TUNING;

  // Spawn: wolves as a loose cordon on the cordon line, lanes evenly spread;
  // deer on the right edge. Draw order is fixed → deterministic.
  const wolves: WolfEnt[] = Array.from({ length: nWolves }, (_, i) => {
    const laneY = ((i + 0.5) * FIELD_H) / nWolves;
    return {
      id: `w${i}`,
      x: clamp(T.cordonX + (rng.next() * 2 - 1) * 26, TOUCH_R, FIELD_W - TOUCH_R),
      y: clamp(laneY + (rng.next() * 2 - 1) * 24, TOUCH_R, FIELD_H - TOUCH_R),
      h: 0, laneY, action: "cordon" as WolfAction,
    };
  });
  const deer: DeerEnt[] = Array.from({ length: nDeer }, (_, i) => ({
    id: `d${i}`,
    x: T.deerSpawnX - rng.next() * 18,
    y: FIELD_H * (0.18 + 0.64 * rng.next()),
    h: Math.PI,                                   // facing the goal
    alive: true, escaped: false,
    action: "dash" as DeerAction, tx: GOAL_X, ty: FIELD_H / 2,
  }));
  for (const d of deer) d.ty = d.y;

  const unresolved = () => deer.some(d => d.alive && !d.escaped);
  const liveDeer = () => deer.filter(d => d.alive && !d.escaped);

  let tick = 0;
  let capped = false;

  for (tick = 0; ; tick++) {
    if (!unresolved()) break;
    if (tick >= maxTicks) { capped = true; break; }

    // ── wolves ────────────────────────────────────────────────────
    for (let i = 0; i < wolves.length; i++) {
      const w = wolves[i];
      const live = liveDeer();
      if (!live.length) break;
      // nearest live deer is this wolf's mark
      let mark = live[0], markD = Infinity;
      for (const d of live) {
        const dd = Math.hypot(d.x - w.x, d.y - w.y);
        if (dd < markD) { markD = dd; mark = d; }
      }
      const ahead = w.x < mark.x;

      if ((tick + i * 3) % T.wolfDecide === 0) {
        const near = clamp(1 - markD / 260, 0, 1);
        w.action = utilityDecide(wolfCandidates(near, ahead), wolfP, rng).action;
      }

      // steering target from the (possibly held) action, using LIVE deer state
      const vx = Math.cos(mark.h) * DEER_SPEED, vy = Math.sin(mark.h) * DEER_SPEED;
      const lineX = clamp(mark.x - T.cordonLead, T.guardX, T.cordonX);
      // where the deer's current course crosses the cordon line
      const ttl = Math.max(0, (mark.x - lineX) / Math.max(0.8, -vx));
      const predY = clamp(mark.y + vy * Math.min(ttl, 50), 0, FIELD_H);
      // cooperation = cordon spacing & lane discipline: the pack fences a
      // window centered on the predicted crossing point — low coop clumps
      // right on the deer (visibly no cordon), high coop spreads a wide,
      // even wall. Rank comes from the wolf's assigned lane order.
      const spacing = T.cordonSpacingMin + wolfP.traits.cooperation * T.cordonSpacingSpan;
      const fenceY = clamp(predY + (i - (nWolves - 1) / 2) * spacing, 12, FIELD_H - 12);
      let tx: number, ty: number;
      switch (w.action) {
        case "chase": tx = mark.x; ty = mark.y; break;
        case "intercept": {
          const tCap = 40 + wolfP.traits.risk * 260;   // risk = how far a cut to gamble on
          const meet = interceptPoint(w.x, w.y, mark.x, mark.y, vx, vy, WOLF_SPEED, tCap);
          if (meet) { tx = meet.x; ty = meet.y; }
          else {
            // no solution — cut the line at a predicted point on the deer's path
            const lead = 60 + wolfP.traits.risk * 180;
            tx = Math.max(T.guardX, mark.x - lead);
            const tt = (mark.x - tx) / Math.max(0.6, -vx);
            ty = clamp(mark.y + vy * tt, 0, FIELD_H);
          }
          break;
        }
        case "cordon": tx = lineX; ty = fenceY; break;
        case "guard": tx = T.guardX; ty = clamp(predY + (i - (nWolves - 1) / 2) * spacing * 0.6, 12, FIELD_H - 12); break;
      }

      const distT = Math.hypot(tx - w.x, ty - w.y);
      if ((w.action === "cordon" || w.action === "guard") && distT < HOLD_EPS) {
        // at the post: hold (patience made visible) — zero displacement
      } else if (distT > 1e-9) {
        w.h = turnToward(w.h, Math.atan2(ty - w.y, tx - w.x), T.wolfTurn);
        w.x = clamp(w.x + Math.cos(w.h) * WOLF_SPEED, 0, FIELD_W);
        w.y = clamp(w.y + Math.sin(w.h) * WOLF_SPEED, 0, FIELD_H);
      }
    }

    // ── deer ──────────────────────────────────────────────────────
    for (let i = 0; i < deer.length; i++) {
      const d = deer[i];
      if (!d.alive || d.escaped) continue;

      let nearD = Infinity;
      for (const w of wolves) nearD = Math.min(nearD, Math.hypot(w.x - d.x, w.y - d.y));

      if ((tick + i) % T.deerDecide === 0) {
        // read the cordon: wolves still ahead of the deer, with a focus-scaled
        // misread of each one's y position (low focus = bad gap reading)
        const noise = (1 - deerP.traits.focus) * T.gapNoise;
        const ys: number[] = [];
        for (const w of wolves) {
          const yN = clamp(w.y + (rng.next() * 2 - 1) * noise, 0, FIELD_H); // draw ALWAYS → stable rng stream
          if (w.x < d.x + 30) ys.push(yN);
        }
        const gaps = readGaps(ys);
        const margin = 14 + deerP.traits.caution * 46;  // caution = safety margin kept
        let dashGap = gaps[0], dashScore = -Infinity;
        let threadGap = gaps[0], threadDev = Infinity;
        for (const g of gaps) {
          const s = Math.min(g.half - margin, 120) - 0.35 * Math.abs(g.center - d.y);
          if (s > dashScore) { dashScore = s; dashGap = g; }
          if (g.half > 8 && Math.abs(g.center - d.y) < threadDev) { threadDev = Math.abs(g.center - d.y); threadGap = g; }
        }
        const edge = gaps[0].half >= gaps[gaps.length - 1].half ? gaps[0] : gaps[gaps.length - 1];
        const jinkSign = rng.next() < 0.5 ? -1 : 1;     // draw ALWAYS → stable rng stream
        const jinkAmt = 80 + rng.next() * 70;

        const near = clamp(1 - nearD / 200, 0, 1);
        d.action = utilityDecide(deerCandidates(deerP, near), deerP, rng).action;
        const lookX = Math.max(GOAL_X, d.x - 320);
        switch (d.action) {
          case "dash": d.tx = lookX; d.ty = dashGap.center; break;
          case "thread": d.tx = lookX; d.ty = threadGap.center; break;
          case "arc": d.tx = Math.max(GOAL_X, d.x - 180); d.ty = clamp(edge.center, WALL, FIELD_H - WALL); break;
          case "jink": d.tx = d.x - 50; d.ty = clamp(d.y + jinkSign * jinkAmt, WALL, FIELD_H - WALL); break;
        }
      }

      // per-tick steering: committed target + always-on close-range repulsion
      let ax = d.tx - d.x, ay = d.ty - d.y;
      const al = Math.hypot(ax, ay) || 1;
      ax /= al; ay /= al;
      const panicR = TUNING.panicBase + deerP.traits.caution * TUNING.panicSpan;
      for (const w of wolves) {
        const dx = d.x - w.x, dy = d.y - w.y;
        const dd = Math.hypot(dx, dy);
        if (dd < panicR && dd > 1e-6) {
          const k = ((panicR - dd) / panicR) ** 2 * 2.4;
          ax += (dx / dd) * k; ay += (dy / dd) * k;
        }
      }
      if (d.y < WALL) ay += ((WALL - d.y) / WALL) * 1.1;
      if (d.y > FIELD_H - WALL) ay -= ((d.y - (FIELD_H - WALL)) / WALL) * 1.1;

      d.h = turnToward(d.h, Math.atan2(ay, ax), T.deerTurn);
      d.x = clamp(d.x + Math.cos(d.h) * DEER_SPEED, 0, FIELD_W);
      d.y = clamp(d.y + Math.sin(d.h) * DEER_SPEED, 0, FIELD_H);
    }

    // ── resolution: catches first, then escapes ───────────────────
    const caughtNow: CatchEvent[] = [];
    const escapedNow: string[] = [];
    for (const d of deer) {
      if (!d.alive || d.escaped) continue;
      for (const w of wolves) {
        if (Math.hypot(w.x - d.x, w.y - d.y) <= TOUCH_R) {
          d.alive = false;
          caughtNow.push({ deerId: d.id, wolfId: w.id });
          break;
        }
      }
      if (d.alive && d.x <= GOAL_X) { d.escaped = true; escapedNow.push(d.id); }
    }

    record?.push({
      tick,
      wolves: wolves.map(w => ({ id: w.id, x: w.x, y: w.y, h: w.h, action: w.action })),
      deer: deer.map(d => ({ id: d.id, x: d.x, y: d.y, h: d.h, alive: d.alive, escaped: d.escaped, action: d.action })),
      caught: caughtNow,
      escaped: escapedNow,
    });
  }

  const caught = deer.filter(d => !d.alive).length;
  // unresolved deer at the backstop cap survived → they count as escaped
  const escaped = deer.length - caught;
  return {
    winner: escaped >= caught ? "deer" : "wolves",
    caught, escaped, total: nDeer,
    ticks: tick, capped,
  };
}

// ── batch evaluator (shared runBatch loop) ────────────────────────
export interface SeriesResult {
  deerWins: number; wolfWins: number; n: number;
  deerWinRate: number;
  avgTicks: number;
  caughtTotal: number; escapedTotal: number;
}

export function runSeries(
  wolfP: Personality, deerP: Personality, nWolves: number, nDeer: number, n: number, seedBase = 900,
): SeriesResult {
  const t = runBatch({
    trials: n,
    seedBase,
    init: () => ({ deerWins: 0, wolfWins: 0, ticks: 0, caught: 0, escaped: 0 }),
    runTrial: (s, trialSeed) => {
      const r = runHunt(wolfP, deerP, nWolves, nDeer, trialSeed);
      if (r.winner === "deer") s.deerWins++; else s.wolfWins++;
      s.ticks += r.ticks;
      s.caught += r.caught;
      s.escaped += r.escaped;
    },
  });
  return {
    deerWins: t.deerWins, wolfWins: t.wolfWins, n,
    deerWinRate: t.deerWins / n,
    avgTicks: t.ticks / n,
    caughtTotal: t.caught, escapedTotal: t.escaped,
  };
}
