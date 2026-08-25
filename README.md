# Pack Hunt

Asymmetric personality simulation: a wolf pack hunts deer on a grid. Unlike the
symmetric duel in [battle-bots](https://github.com/nathandunn/battle-bots), the
two sides have **different action sets and different win conditions** — wolves
score by catching, deer score by surviving the clock.

Where personality bites:
- **cooperation** decides whether wolves converge on one target or split up
- **patience** gates ambush-waiting versus immediate pursuit
- **caution / risk** on the deer side trades early flight against staying near cover
- **randomness** is softmax temperature via sim-core's `utilityDecide`

Built on [`@precog/sim-core`](https://github.com/nathandunn/sim-core).

Live: https://pack.apps.precogsoftwareservices.com

```bash
npm install && npm run build
```
