# Pack Hunt — SPEC v0.4

Status: agreed 2026-08-27, from a feedback session. Supersedes v0.3.
Cross-cutting requirements: see `hub-orchestrator/specs/2026-08-26-suite-v0.3.md`
(league/tank/lab restructure still deferred for this app).

## Verdict
**Rework the movement and the objective.** v0.3's rules produced a degenerate
deer strategy: with survival-by-clock as the goal, hiding in one spot is
optimal, so the deer hides instead of running. Give the deer somewhere to GO.

## The game — the crossing

- **5 wolves, 1 deer** by default (sim controls can change counts later).
- **The deer must reach the LEFT edge of the field.** It spawns on the right.
  Reaching the left edge is a deer win; being caught is a wolf win. No clock
  win for either side — the objective forces movement, killing the hiding
  strategy structurally rather than by tuning.
- **Smooth, continuous movement** — no grid, no board-game squares. Continuous
  2D field, fixed deterministic ticks, seeded (follow battle-bots' arena
  pattern: simulate once, record frames, render from frames; scrubbing free).
- **Deer moves at 2× wolf speed.** The wolves' only edge is numbers and
  position: they must spread, anticipate, and intercept — a faster deer
  through a slower cordon.
- Catch = a wolf getting within touch radius of the deer.
- A generous tick cap remains purely as an infinite-loop backstop; in a
  correctly playing match it should essentially never bind (if neither side
  can end it, count it a deer win — the deer survived).

## Balance target — deer wins 3:1

With the default configuration, the deer should win about **75%** of matches.
Wolf catches are the event, at 1-in-4. Verify with batch runs across several
seed bases and archetype pairings; no pairing should be degenerate
(always-win/always-lose). Tuning knobs: field size, touch radius, wolf
spacing/spawn line, deer turn rate vs wolf turn rate — NOT the 2× speed
ratio, which is fixed by this spec.

## Personalities

Both sides remain personality-driven via sim-core's utilityDecide:
- **Wolves** — cooperation = cordon spacing & lane discipline; aggression =
  direct chase vs holding the line; patience = waiting in the lane vs
  breaking early; focus = clean intercept angles; risk = gambling on a
  predicted cut.
- **Deer** — risk = threading between wolves vs wide arcs; caution = safety
  margin kept from the nearest wolf; randomness = feints/jinks; focus =
  reading gaps in the cordon.
The legibility bar applies: a risky deer should visibly thread the needle;
a cooperative pack should visibly form a cordon.

## Stamina
v0.3's per-wolf stamina is **dropped** — the crossing objective bounds match
length naturally and stamina complicates a chase that is now about angles.
(Revisit only if wolves turn out to chase forever in circles.)

## Keep
- Deterministic seeded engine, replay/playback controls, dark-arcade look.
- Sweep/Sweep All/Evolve rewired to the new evaluator: win rate for the
  selected side over N seeded matches.
- The test suite discipline from v0.3: determinism, invariants (touch-radius
  catches only, speed ratio exactly 2×, bounds), win conditions, and a
  balance regression test asserting the default deer win rate is in a
  70–80% band.

## Remove
- The grid, square-occupancy rules, and attack-adjacent catch (superseded by
  continuous space + touch radius).
- Per-wolf stamina and exhaustion rendering.
- The survive-the-clock deer objective.
