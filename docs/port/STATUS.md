# Port status

Updated 2026-10-18 (aliens and firing). Evidence for each claim: [evidence.md](evidence.md). Scenarios: [scenarios/](scenarios/).

## Supported build

`ALIEN.EXE` SHA-256 `0787a2ca…e0c7` (IBM PC, passcode compare skipped) or `ALIEN.EX_` `8d998048…ac2a` (the same program
with the check). Other builds are refused at load. Assets come from the user's `game/` folder or a folder picked in the
browser; tables are read from the executable at runtime.

## Working route

`npm run dev`, open `/game.html`, press **Play**. Level index 2 (`LBMZ.HUF`, the first level and the attract demo's
level) starts at the original's spawn point. The player walks with the arrow keys (3 px per frame, diagonals
unnormalised), collides per axis with sliding, rides conveyors, obeys one-way cells, picks up keys, first aid, ammo,
extra lives and credits, takes damage from hazard cells, and opens doors with keys or by shooting them. Firing uses the original fire rate, ammo cost,
shot speeds and start offsets; impacts, alien eggs, alien deaths and explosions run the original object scripts read
from the executable. Aliens spawn, hatch, wander or chase with the original random generator, collide with walls and
each other, hurt the player on contact and die from shots. The camera follows with the original's dead zone and step
limits.
The bottom panel is drawn from `PANEL.VHF`; its live values are not drawn yet (they are shown in text below the canvas).

**Strict mode (default)** stops with a diagnostic as soon as the original would do something not reproduced yet.
**Preview mode** (checkbox) skips such behaviour instead and lists what it skipped; it is not faithful and never counts
as verification.

## Verification

| Command | What it checks |
| --- | --- |
| `npm test` | Unit tests; tests needing the original files skip without them. |
| `npm run verify` | Requires the original files. Runs every test with skipping forbidden (missing fixtures, zero or skipped tests fail), then the browser scenario in headless Chrome. |

Verified levels, from strongest to weakest:

- **Closed-loop replay** (`test/demo.test.js`, `scenarios/demo-lbmz.json`): `DEMO.DAT` replayed from level start with
  the original's seed reproduces three unfitted checkpoints (frames 100, 300, 500): player position, sprite frame,
  energy, ammo, fire and walk counters, camera, live aliens, object count, RNG state, the first alien's slot, its
  spawn cooldown and its object script frame. The whole 1024-frame demo replays without reaching unimplemented
  behaviour. A negative control (one dropped input byte) fails the comparison.
- **Browser acceptance** (`scripts/browser-scenario.mjs`): real key events in Chrome, asset loading from `game/`, spawn
  point, 3 px steps, ~70 updates per second, camera follow, rendered playfield, firing and impact, first alien spawn,
  alien drawn from the alien sheet and palette bank.
- **Routine checks** (`test/*.test.js`): map decoding (hash), RNG against an independent trace, collision, pickups, BCD,
  animation ticker.

## Known limitations

- Not implemented (strict stop): the self-destruct trigger cell 0x15, player death, generator hits and the
  self-destruct, bouncing shots (weapons 3 and 7), destructible walls, the Intex terminal, the exit, level 16/17
  objectives, object hooks (bosses), child objects, two players. Not present at all yet: sound and music, the HUD
  values, menus, levels other than index 2.
- The original's spawn scan creates 5 phantom spawn records from reads above the map; they can never spawn and are
  omitted. The level-start door and decor scans have the same out-of-map reads; the port skips those points.
- The level-start scans skip probe points on world row/column 0, where the original reads unrelated memory.
- Frame rate: one update per 70 Hz retrace with the lag flag at 0 (a fast machine). The original speeds movement up
  when a frame takes 5 or more 96 Hz ticks; that is not modelled.
- Tile animation positions and the tile-versus-sprite camera lag are observed on two screenshots only.

## Next milestone

Finish level 1: hazards and player death, generator destruction and the self-destruct countdown, the exit, and the
HUD values on the panel. Capture further original checkpoints beyond frame 500 (more alien traffic) and a level-start
comparison of the door list and animation slots against the original.
