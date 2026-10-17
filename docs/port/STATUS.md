# Port status

Updated 2026-10-18. Evidence for each claim: [evidence.md](evidence.md). Scenarios: [scenarios/](scenarios/).

## Supported build

`ALIEN.EXE` SHA-256 `0787a2ca…e0c7` (IBM PC, passcode compare skipped) or `ALIEN.EX_` `8d998048…ac2a` (the same program
with the check). Other builds are refused at load. Assets come from the user's `game/` folder or a folder picked in the
browser; tables are read from the executable at runtime.

## Working route

`npm run dev`, open `/game.html`, press **Play**. Level index 2 (`LBMZ.HUF`, the first level and the attract demo's
level) starts at the original's spawn point. The player walks with the arrow keys (3 px per frame, diagonals
unnormalised), collides per axis with sliding, rides conveyors, obeys one-way cells, picks up keys, first aid, ammo,
extra lives and credits, and opens doors with keys. The camera follows with the original's dead zone and step limits.
The bottom panel is drawn from `PANEL.VHF`; its live values are not drawn yet (they are shown in text below the canvas).

**Strict mode (default)** stops with a diagnostic as soon as the original would do something not reproduced yet.
Walking right from the start reaches the first alien spawn at frame 47. **Preview mode** (checkbox) skips such
behaviour instead and lists what it skipped; it is not faithful and never counts as verification.

## Verification

| Command | What it checks |
| --- | --- |
| `npm test` | Unit tests; tests needing the original files skip without them. |
| `npm run verify` | Requires the original files. Runs every test with skipping forbidden (missing fixtures, zero or skipped tests fail), then the browser scenario in headless Chrome. |

Verified levels, from strongest to weakest:

- **Closed-loop replay** (`test/demo.test.js`, `scenarios/demo-lbmz.json`): `DEMO.DAT` replayed from level start reproduces
  two observed player/camera checkpoints of the original exactly, 21 frames apart. The first checkpoint's frame number is
  a fitted alignment; the second is not. A negative control (one dropped input byte) fails the comparison.
- **Browser acceptance** (`scripts/browser-scenario.mjs`): real key events in Chrome, asset loading from `game/`, spawn
  point, 3 px steps, ~70 updates per second, camera follow, rendered playfield, strict stop on firing.
- **Routine checks** (`test/*.test.js`): map decoding (hash), RNG against an independent trace, collision, pickups, BCD,
  animation ticker.

## Known limitations

- Not implemented (strict stop): aliens, firing and projectiles, hazards (0x14, 0x15, 0x40, 0x44-0x46, 0x64), death,
  the Intex terminal, the exit, self-destruct, level 16/17 objectives, sound and music, the HUD values, two players,
  menus, levels other than index 2.
- The level-start scans skip probe points on world row/column 0, where the original reads unrelated memory.
- Frame rate: one update per 70 Hz retrace with the lag flag at 0 (a fast machine). The original speeds movement up
  when a frame takes 5 or more 96 Hz ticks; that is not modelled.
- Tile animation positions and the tile-versus-sprite camera lag are observed on two screenshots only.

## Next milestone

Aliens and firing (spawn, AI, contact damage, projectiles, generators), specified in the static notes from
`1000:4A66`, `52F4` and `5928`. Then extend the demo replay past frame 85 against further original checkpoints,
including the RNG seed (`[B07A]`, normally 0 early in a session).
