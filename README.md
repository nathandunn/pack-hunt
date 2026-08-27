# Pack Hunt

Asymmetric personality simulation: the crossing. A deer spawns on the right
edge of a smooth continuous 2D field and must reach the left edge at exactly
2× wolf speed; a wolf pack cordons the ground in between and wins by touch.
Unlike the symmetric duel in
[battle-bots](https://github.com/nathandunn/battle-bots), the two sides have
**different action sets and different win conditions** — and the pace asymmetry
means the wolves win by numbers and interception angles, never by pursuit.

Where personality bites:
- **cooperation** (wolves) sets cordon spacing and lane discipline — a wall vs a clump
- **aggression / patience** trade direct chasing against holding the line
- **focus** sharpens intercept angles (wolves) and gap reading (deer)
- **risk / caution** on the deer side trade threading the needle against wide arcs
- **randomness** is softmax temperature via sim-core's `utilityDecide` — jinks and feints

Built on [`@precog/sim-core`](https://github.com/nathandunn/sim-core).

Live: https://pack.apps.precogsoftwareservices.com

```bash
npm install && npm run build
```
