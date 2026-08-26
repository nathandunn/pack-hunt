# Pack Hunt — SPEC v0.3

Status: agreed 2026-08-26, from a feedback session. Supersedes v0.2.
Cross-cutting requirements (league, legibility, lab, style):
see `hub-orchestrator/specs/2026-08-26-suite-v0.3.md`.

## Verdict
**Iterate.** The hunt is the right idea; three rule changes tighten it and
make escape the norm.

## Rule changes

1. **No square sharing.** No two entities — wolf or deer — ever occupy the
   same cell. All movement into an occupied square is illegal, with one
   exception:
2. **Catch = attack-adjacent.** A wolf catches by moving INTO an adjacent
   deer's square as an attack; the deer is removed and the wolf takes the
   square. This is the only square-entry onto an occupied cell, and it is
   the moment the animation celebrates.
3. **Per-wolf stamina, ~30 moves.** Each wolf individually has a budget of
   about 30 moves. **Holding position costs nothing** — patient wolves can
   ambush while eager ones burn out. A wolf out of moves is exhausted and
   drops out of the hunt (visibly — slumped sprite, greyed).

## Balance target — deer usually escape

In the wild the hunt usually fails. Tune (via batch sims, then by watching)
so a typical hunt catches **0–1 deer**; full wipeouts should be rare events.
A catch is the fireworks moment of the fish tank precisely because most
hunts end with the pack exhausted and the herd away.

## Keep from v0.2
- The animated board, sprites, action glyphs, and playback controls.
- The asymmetric sides and both sides' action sets (adjusted for the
  no-overlap rule).
- Sweep/evolve/simulate (now in the Lab section).

## Personality notes
Stamina makes **patience** directly visible (ambush vs burnout) and sharpens
**cooperation** (coordinated cutoffs matter more when moves are finite).
Exaggerate per the suite legibility bar.

## Out of scope
- Terrain/obstacles, seasons, pack hierarchies.
- Human control of a wolf or deer.
