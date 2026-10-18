# Port status

Updated 2026-10-18 (title, all levels, Intex, sound effects, FM music). Evidence for each claim: [evidence.md](evidence.md);
music driver: [avmfm.md](avmfm.md); Intex: [intex.md](intex.md). Scenarios: [scenarios/](scenarios/).

## Supported build

`ALIEN.EXE` SHA-256 `0787a2ca…e0c7` (IBM PC, passcode compare skipped) or `ALIEN.EX_` `8d998048…ac2a` (the same program
with the check). Other builds are refused at load. Assets come from the user's `game/` folder or a folder picked in the
browser; tables, texts, scripts and the music driver are read from the user's files at runtime.

## Working route

`npm run dev`, open `/game.html`, press **Play** (Z fires and skips screens, X is the action key, arrows move, 1 cycles
weapons, M shows the map once bought, Esc abandons). Start-up shows the title with its song and menu (players, share
credits, start game); idling runs the credits, the story pages and the attract demo. A new game starts like the
original's: intermission (CARGOBAY and the deck 1 briefing), then level index 1 (`L0MZ`).
Every exit leads through the intermission (deck lift with the deck-man, briefing, level code) to the next index, carrying
the player's energy, lives, keys, ammo, weapons, credits and tallies, the random generator and the counters the
original never resets. After index 18 the ending plays; every finished game ends on the game-over screen.
`?level=N` (development) skips the title and starts a new game at index N without the first intermission.

Intex terminals (action key on a terminal cell): boot text with the typewriter, main menu, weapon and tool shops,
radar map, mission text, statistics, info pages, the cheat and level-code words, and the original's way back into the
level. The M key opens the map screen for a player who bought the map.

In a level: walking, collision, conveyors, one-way cells, hazards, pickups, doors (keys or shooting), all seven
weapons including bouncing shots, destructible walls with burning debris, aliens and eggs, generators, the
self-destruct with its countdown and explosion sequence, the exit rules per level, the bosses of levels 5, 8 and 17
(objective cell 0x3D), the scripted spawns of levels 16 and 17 (cell 0x0A), red palettes on levels 14 and 15.

Sound: the 25 digital effects with the original's single-voice priority rule; the game-over sample. Music: the five CMF
songs through a port of the original FM driver (title, in-game, alarm, monster, Intex) into an OPL2 synthesizer, at the
PIT rates the driver programs, with the alarm song's start-without-stop quirk.

**Strict mode (default)** stops with a diagnostic as soon as the original would do something not reproduced yet.
**Preview mode** (checkbox) skips such behaviour and lists it on screen; it is not faithful and never counts as verification.

## Verification

| Command | What it checks |
| --- | --- |
| `npm test` | Unit tests; tests needing the original files skip without them. |
| `npm run verify` | Requires the original files. Every test with skipping forbidden, then the browser scenario in headless Chrome (intermission, new game at index 1, level index 2 movement, firing, sound, aliens, music at 120 Hz). |
| `npm run verify:runtime` | Requires local DOSBox captures in `.work/captures` (never committed). Compares the FM driver's complete state with the original after 1000 title and 3000 in-game ticks, and the level 5 boss fight (boss, player, RNG, records) in a partial restore: one unfitted point with a negative control and one point fitted to a 5-frame offset. |

Verified levels, from strongest to weakest:

- **Independent runtime**: the music driver against the original's memory; the level 5 boss at one unfitted and one
  fitted point (above).
- **Closed-loop replay** (`test/demo.test.js`, `scenarios/demo-lbmz.json`): `DEMO.DAT` reproduces unfitted original
  checkpoints at frames 100-900 (player, camera, aliens, objects, RNG). Negative control: one dropped input byte.
- **Browser acceptance** (`scripts/browser-scenario.mjs`).
- **Routine checks**: map decoding, RNG trace, collision, pickups, BCD tallies, weapon cycling, bouncing shots,
  destructible walls, bosses on levels 5/8/17, scripted spawns, PIT model, sound priority, song loop restart.
  The title, intermission, Intex, endings, scripted spawns, bosses of levels 8 and 17 and the level sequence are static
  analysis checked by these tests and the browser scenario (title, intermission, a level, an Intex visit), not yet
  compared with original runs.

## Known limitations

- Not implemented (strict stop): two players, shots more than 3 pixels above the map, the demo-recording and
  exit-to-DOS cheat words. Not present: the start-up screens before the title (logos and intro).
- Timing model (`src/game/timing.js`): one game update per 70.086 Hz retrace; the lag flag follows the INT 8 count, so
  it is set only after pauses (fades, the Intex). In-game the PIT runs
  at 120 Hz; interrupts arriving while the frame has them disabled are collapsed and do not tick the music. The share of
  the frame before that window is a machine property; the port uses 0.8, which makes in-game songs advance at the
  96 ticks/s their CMF headers declare. The self-destruct timer runs at the full 120 Hz under this model.
- The OPL2 synthesizer is an approximation of the chip's sound (envelopes, key scaling, rhythm section); the register
  writes it receives are exact. Waveform select is never enabled by the game, so all operators are sines.
- Counters the original never resets start at their boot values for a new game; in the original they depend on how
  long the title and attract loop ran.
- The boss's wall tests use an unknown leftover register as the "own" cell; occupied cells are treated as blocking.
- The level-start and spawn scans skip probe points the original reads from outside the map (see evidence.md).
- The panel reload calls after a boss starts or dies (`209E`, `A316`, `A31A`) are not reproduced; the panel is redrawn
  every frame anyway.

## Next milestone

Original-run comparisons for the remaining new paths (an Intex purchase, a level transition with carried state, the
intermission timing, the bosses of levels 8 and 17), the start-up screens, and two players.
