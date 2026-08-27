import { test } from "node:test";
import assert from "node:assert/strict";
import { ARCHETYPES } from "@precog/sim-core";
import {
  runHunt, runSeries,
  FIELD_W, FIELD_H, WOLF_SPEED, DEER_SPEED, TOUCH_R, GOAL_X, MAX_TICKS,
  type TickFrame,
} from "../sim.js";

// v0.4 defaults: 5 wolves, 1 deer, teamplayer pack vs defender deer.
const WOLF_P = ARCHETYPES.teamplayer;
const DEER_P = ARCHETYPES.defender;

test("a fixed seed reproduces an identical hunt exactly, including the tick-by-tick frame log", () => {
  const framesA: TickFrame[] = [];
  const framesB: TickFrame[] = [];
  const a = runHunt(WOLF_P, DEER_P, 5, 1, 42, MAX_TICKS, framesA);
  const b = runHunt(WOLF_P, DEER_P, 5, 1, 42, MAX_TICKS, framesB);
  assert.deepEqual(a, b, "same seed must produce an identical hunt result");
  assert.deepEqual(framesA, framesB, "same seed must produce an identical frame log");
  assert.ok(framesA.length > 0, "a hunt must record frames");
});

test("different seeds produce different hunts (sanity check the seed actually matters)", () => {
  const framesA: TickFrame[] = [];
  const framesB: TickFrame[] = [];
  runHunt(WOLF_P, DEER_P, 5, 1, 1, MAX_TICKS, framesA);
  runHunt(WOLF_P, DEER_P, 5, 1, 2, MAX_TICKS, framesB);
  assert.notDeepEqual(framesA, framesB);
});

test("the deer moves at exactly 2x wolf speed, measured in flight from the frame log", () => {
  assert.equal(DEER_SPEED, WOLF_SPEED * 2, "the constant ratio is fixed by SPEC v0.4");
  const MARGIN = DEER_SPEED + 1;  // ignore steps that may have been clamped at a field edge
  let deerSteps = 0, wolfSteps = 0, wolfHolds = 0;
  for (let seed = 0; seed < 20; seed++) {
    const frames: TickFrame[] = [];
    runHunt(WOLF_P, DEER_P, 5, 1, seed, MAX_TICKS, frames);
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1], cur = frames[i];
      const pd = prev.deer[0], cd = cur.deer[0];
      if (pd.alive && !pd.escaped && cd.alive && !cd.escaped &&
          pd.x > MARGIN && pd.x < FIELD_W - MARGIN && pd.y > MARGIN && pd.y < FIELD_H - MARGIN) {
        const step = Math.hypot(cd.x - pd.x, cd.y - pd.y);
        assert.ok(Math.abs(step - DEER_SPEED) < 1e-9, `deer step ${step} must be exactly ${DEER_SPEED}`);
        deerSteps++;
      }
      for (let wi = 0; wi < cur.wolves.length; wi++) {
        const pw = prev.wolves[wi], cw = cur.wolves[wi];
        if (pw.x > MARGIN && pw.x < FIELD_W - MARGIN && pw.y > MARGIN && pw.y < FIELD_H - MARGIN) {
          const step = Math.hypot(cw.x - pw.x, cw.y - pw.y);
          // a wolf either holds its post (0) or moves at exactly WOLF_SPEED
          if (step > 1e-9) {
            assert.ok(Math.abs(step - WOLF_SPEED) < 1e-9, `wolf step ${step} must be exactly ${WOLF_SPEED}`);
            wolfSteps++;
          } else wolfHolds++;
        }
      }
    }
  }
  assert.ok(deerSteps > 1000, "expected to measure many deer steps in flight");
  assert.ok(wolfSteps > 1000, "expected to measure many wolf steps in flight");
  assert.ok(wolfHolds > 0, "expected at least one wolf to hold its post (patience visible)");
});

test("every entity stays inside the field across many seeds", () => {
  for (let seed = 0; seed < 60; seed++) {
    const frames: TickFrame[] = [];
    runHunt(ARCHETYPES.attacker, ARCHETYPES.wildcard, 5, 1, seed, MAX_TICKS, frames);
    for (const f of frames) {
      for (const w of f.wolves) {
        assert.ok(w.x >= 0 && w.x <= FIELD_W && w.y >= 0 && w.y <= FIELD_H,
          `seed ${seed} tick ${f.tick}: wolf ${w.id} out of bounds (${w.x},${w.y})`);
      }
      for (const d of f.deer) {
        assert.ok(d.x >= 0 && d.x <= FIELD_W && d.y >= 0 && d.y <= FIELD_H,
          `seed ${seed} tick ${f.tick}: deer ${d.id} out of bounds (${d.x},${d.y})`);
      }
    }
  }
});

test("a catch only ever happens within the touch radius, and ends that deer's hunt", () => {
  let catches = 0;
  for (let seed = 0; seed < 200 && catches < 20; seed++) {
    const frames: TickFrame[] = [];
    const r = runHunt(WOLF_P, DEER_P, 5, 1, seed, MAX_TICKS, frames);
    let sawCatch = false;
    for (const f of frames) {
      for (const ev of f.caught) {
        const d = f.deer.find(x => x.id === ev.deerId)!;
        const w = f.wolves.find(x => x.id === ev.wolfId)!;
        const dist = Math.hypot(w.x - d.x, w.y - d.y);
        assert.ok(dist <= TOUCH_R + 1e-9, `catch at distance ${dist} > touch radius ${TOUCH_R}`);
        assert.equal(d.alive, false, "a caught deer must be dead in the same frame");
        sawCatch = true;
        catches++;
      }
      if (sawCatch) {
        // once caught, the deer never moves or revives in later frames
        const at = f.deer[0];
        for (const g of frames.slice(frames.indexOf(f) + 1)) {
          assert.equal(g.deer[0].alive, false);
          assert.equal(g.deer[0].x, at.x);
          assert.equal(g.deer[0].y, at.y);
        }
        break;
      }
    }
    if (sawCatch) assert.equal(r.winner, "wolves", "a caught single deer means the wolves won");
  }
  assert.ok(catches > 0, "expected at least one catch across the scanned seeds");
});

test("win conditions fire both ways: escapes reach the goal line, catches are wolf wins", () => {
  let escapes = 0, catches = 0;
  for (let seed = 0; seed < 120; seed++) {
    const frames: TickFrame[] = [];
    const r = runHunt(WOLF_P, DEER_P, 5, 1, seed, MAX_TICKS, frames);
    assert.ok(!r.capped, `seed ${seed}: the backstop cap should essentially never bind in normal play`);
    const last = frames[frames.length - 1];
    if (r.winner === "deer") {
      escapes++;
      assert.equal(r.escaped, 1);
      assert.ok(last.deer[0].escaped, "a deer win must be a recorded escape");
      assert.ok(last.deer[0].x <= GOAL_X, `an escaped deer must be at the goal line (x=${last.deer[0].x})`);
    } else {
      catches++;
      assert.equal(r.caught, 1);
      assert.ok(!last.deer[0].alive, "a wolf win must be a recorded catch");
    }
    assert.equal(r.ticks, frames.length, "result tick count must match the frame log");
  }
  assert.ok(escapes > 0, "expected deer escapes across the scanned seeds");
  assert.ok(catches > 0, "expected wolf catches across the scanned seeds");
});

test("the tick-cap backstop counts as a deer win (the deer survived)", () => {
  // A tiny cap forces the backstop on a hunt that would otherwise continue.
  const r = runHunt(WOLF_P, DEER_P, 5, 1, 7, 3);
  assert.equal(r.capped, true);
  assert.equal(r.winner, "deer");
  assert.equal(r.escaped, 1);
  assert.equal(r.caught, 0);
  assert.equal(r.ticks, 3);
});

test("balance regression: default 5v1 teamplayer pack vs defender deer lands in the 70-80% deer-win band", () => {
  const s = runSeries(WOLF_P, DEER_P, 5, 1, 300, 900);
  assert.ok(
    s.deerWinRate >= 0.70 && s.deerWinRate <= 0.80,
    `deer win rate ${(s.deerWinRate * 100).toFixed(1)}% outside the 70-80% band (SPEC v0.4 target ~75%)`,
  );
});

test("no archetype pairing is fully degenerate (never 0% or 100% deer wins)", () => {
  const keys = Object.keys(ARCHETYPES);
  for (const wk of keys) {
    for (const dk of keys) {
      const s = runSeries(ARCHETYPES[wk], ARCHETYPES[dk], 5, 1, 60, 1700);
      assert.ok(s.deerWins > 0, `${wk} wolves vs ${dk} deer: deer never won (degenerate)`);
      assert.ok(s.wolfWins > 0, `${wk} wolves vs ${dk} deer: wolves never won (degenerate)`);
    }
  }
});
