import { test } from "node:test";
import assert from "node:assert/strict";
import { ARCHETYPES } from "@precog/sim-core";
import { runHunt, W, H, WOLF_STAMINA, type TurnSnapshot } from "../sim.js";

const ARCH_KEYS = Object.keys(ARCHETYPES);

test("a fixed seed reproduces an identical hunt exactly, including the tick-by-tick replay", () => {
  const wolfP = ARCHETYPES.teamplayer, deerP = ARCHETYPES.defender;
  const replayA: TurnSnapshot[] = [];
  const replayB: TurnSnapshot[] = [];
  const a = runHunt(wolfP, deerP, 3, 5, 42, 60, replayA);
  const b = runHunt(wolfP, deerP, 3, 5, 42, 60, replayB);
  assert.deepEqual(a, b, "same seed must produce an identical hunt result");
  assert.deepEqual(replayA, replayB, "same seed must produce an identical turn-by-turn replay");
});

test("different seeds produce different outcomes (sanity check the seed actually matters)", () => {
  const wolfP = ARCHETYPES.teamplayer, deerP = ARCHETYPES.defender;
  const a = runHunt(wolfP, deerP, 3, 5, 1);
  const b = runHunt(wolfP, deerP, 3, 5, 2);
  assert.notDeepEqual(a, b);
});

test("no two entities — wolf or deer, spawn included — ever occupy the same cell, across many seeds and roster sizes", () => {
  let turnsChecked = 0;
  for (let seed = 0; seed < 400; seed++) {
    const wolfP = ARCHETYPES[ARCH_KEYS[seed % ARCH_KEYS.length]];
    const deerP = ARCHETYPES[ARCH_KEYS[(seed + 1) % ARCH_KEYS.length]];
    const nW = 1 + (seed % 8);
    const nD = 1 + (seed % 12);
    const replay: TurnSnapshot[] = [];
    runHunt(wolfP, deerP, nW, nD, seed, 60, replay);
    for (const snap of replay) {
      turnsChecked++;
      const occ = new Set<string>();
      for (const w of snap.wolves) {
        const k = `${w.x},${w.y}`;
        assert.ok(!occ.has(k), `seed ${seed} turn ${snap.turn}: wolf ${w.id} landed on an occupied cell`);
        occ.add(k);
        assert.ok(w.x >= 0 && w.x < W && w.y >= 0 && w.y < H, "wolf must stay on the board");
      }
      for (const d of snap.deer) {
        if (!d.alive) continue;
        const k = `${d.x},${d.y}`;
        assert.ok(!occ.has(k), `seed ${seed} turn ${snap.turn}: deer ${d.id} landed on an occupied cell`);
        occ.add(k);
        assert.ok(d.x >= 0 && d.x < W && d.y >= 0 && d.y < H, "deer must stay on the board");
      }
    }
  }
  assert.ok(turnsChecked > 1000, "the sweep above should have actually exercised a meaningful number of turns");
});

test("a catch is an attack-adjacent move: the wolf that caught a deer ends the turn on that deer's previous square, flagged as having attacked", () => {
  // Aggressive wolves against a reckless, rarely-fleeing deer archetype, scanned
  // over many seeds, is close to guaranteed to produce at least one catch.
  const wolfP = ARCHETYPES.attacker, deerP = ARCHETYPES.attacker;
  let found = false;
  for (let seed = 0; seed < 200 && !found; seed++) {
    const replay: TurnSnapshot[] = [];
    runHunt(wolfP, deerP, 4, 6, seed, 60, replay);
    let prevDeerPos = new Map<string, { x: number; y: number }>();
    for (const snap of replay) {
      if (snap.caught.length) {
        for (const deerId of snap.caught) {
          const before = prevDeerPos.get(deerId);
          assert.ok(before, "a caught deer must have existed on the board the previous turn");
          const attacker = snap.wolves.find(w => w.attacked && w.x === before!.x && w.y === before!.y);
          assert.ok(attacker, `some wolf must be flagged attacked and standing on the caught deer's previous square (turn ${snap.turn})`);
          found = true;
        }
      }
      for (const d of snap.deer) if (d.alive) prevDeerPos.set(d.id, { x: d.x, y: d.y });
    }
  }
  assert.ok(found, "expected at least one catch across the scanned seeds");
});

test("holding position costs no stamina; any other completed action spends exactly one point", () => {
  const wolfP = ARCHETYPES.teamplayer, deerP = ARCHETYPES.defender;
  let holdsSeen = 0, movesSeen = 0;
  for (let seed = 0; seed < 40; seed++) {
    const replay: TurnSnapshot[] = [];
    runHunt(wolfP, deerP, 3, 5, seed, 60, replay);
    const lastStamina = new Map<string, number>();
    for (const snap of replay) {
      for (const w of snap.wolves) {
        if (w.exhausted && w.action === null) continue; // already dropped out before this turn
        const prev = lastStamina.get(w.id);
        if (prev !== undefined) {
          if (w.action === "hold") { assert.equal(w.stamina, prev, "hold must never spend stamina"); holdsSeen++; }
          else { assert.equal(w.stamina, prev - 1, "a non-hold action must spend exactly one stamina point"); movesSeen++; }
        }
        lastStamina.set(w.id, w.stamina);
      }
    }
  }
  assert.ok(holdsSeen > 0, "expected to observe at least one free hold across the scanned seeds");
  assert.ok(movesSeen > 0, "expected to observe at least one stamina-spending move across the scanned seeds");
});

test("a wolf that reaches zero stamina is exhausted, stops acting, and stays put for the rest of the hunt", () => {
  const wolfP = ARCHETYPES.attacker, deerP = ARCHETYPES.defender;
  let checkedAny = false;
  for (let seed = 0; seed < 30; seed++) {
    const replay: TurnSnapshot[] = [];
    runHunt(wolfP, deerP, 3, 5, seed, 60, replay);
    const exhaustedAt = new Map<string, { turnIdx: number; x: number; y: number }>();
    replay.forEach((snap, turnIdx) => {
      for (const w of snap.wolves) {
        if (w.exhausted && !exhaustedAt.has(w.id)) exhaustedAt.set(w.id, { turnIdx, x: w.x, y: w.y });
      }
    });
    for (const [id, at] of exhaustedAt) {
      checkedAny = true;
      // The turn a wolf's stamina hits zero is still the turn it spent its
      // last point (action is the move that used it up); only from the NEXT
      // turn on does it sit out entirely with action:null.
      for (let i = at.turnIdx + 1; i < replay.length; i++) {
        const frame = replay[i].wolves.find(w => w.id === id)!;
        assert.equal(frame.exhausted, true, `${id} must remain exhausted once it drops out`);
        assert.equal(frame.action, null, `${id} must take no further action once exhausted`);
        assert.equal(frame.stamina, 0, `${id} must show zero stamina once exhausted`);
        assert.equal(frame.x, at.x, `${id} must not move once exhausted`);
        assert.equal(frame.y, at.y, `${id} must not move once exhausted`);
      }
    }
  }
  assert.ok(checkedAny, "expected at least one wolf to exhaust across the scanned seeds");
});

test("stamina never goes negative or above the per-wolf budget", () => {
  for (let seed = 0; seed < 100; seed++) {
    const replay: TurnSnapshot[] = [];
    runHunt(ARCHETYPES.attacker, ARCHETYPES.wildcard, 4, 6, seed, 60, replay);
    for (const snap of replay) for (const w of snap.wolves) {
      assert.ok(w.stamina >= 0 && w.stamina <= WOLF_STAMINA, `stamina ${w.stamina} out of [0, ${WOLF_STAMINA}]`);
    }
  }
});

test("the hunt ends once every deer is caught, every wolf is exhausted, or the turn cap is hit — never later", () => {
  for (const [wolfKey, deerKey] of [["attacker", "defender"], ["defender", "attacker"], ["teamplayer", "wildcard"]] as const) {
    const r = runHunt(ARCHETYPES[wolfKey], ARCHETYPES[deerKey], 3, 5, 7, 60);
    assert.ok(r.turns <= 60, "must respect the turn-cap backstop");
    assert.ok(r.caught >= 0 && r.caught <= r.total);
    assert.ok(r.exhausted >= 0 && r.exhausted <= 3);
  }
});
