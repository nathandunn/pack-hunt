# Pack Hunt — SPEC v0.2

Status: agreed 2026-08-25.

## Verdict
Iterate. The simulation is the most visually interesting of the set and is
currently entirely invisible.

## The main gap
Pack Hunt already runs a real spatial simulation — wolves converging, cutting
off, holding position; deer fleeing, scattering, freezing — on a 16x10 grid.
None of it is rendered. The user sees a truncated text trace and a number.

## Add — animated board
- Render the 16x10 grid with wolf and deer sprites
- Animate movement turn by turn
- Distinct visual for each action: chase (direct line), converge (pack focus
  highlight), cutoff (flanking arc), hold (idle marker)
- Catch flash when a wolf reaches a deer
- Turn counter and live remaining-deer count
- Playback controls: play / pause / step / speed

This is where "see what the algorithm is doing" pays off most in the whole
suite — cooperation visibly changes pack shape.

## Add — sweep upgrades
Same four as Battle Bots:
1. Sweep either side (wolves or deer) — currently wolves only
2. Per-sweep summary with best value, delta, and shape of effect
3. Sweep all traits, ranked by impact
4. Lock to best / worst and continue sweeping

## Keep
Trait sliders, archetype presets, batch simulation stats
(average caught, wipeout rate, clean escape rate).

## Audience
Public demo. Strongest candidate for a portfolio centrepiece because the
personality effect is legible on screen rather than only in numbers.
