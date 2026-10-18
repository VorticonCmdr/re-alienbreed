# What is still open

Updated 2026-10-18. The port plays from the start-up logos through the title, all 19 levels and the ending. This list is
everything that is not done, not checked against the original, or approximated. Evidence for what *is* done:
[evidence.md](evidence.md); current state: [STATUS.md](STATUS.md).

## 1. Not implemented (strict mode stops with a diagnostic)

| Item | What the original does | Where | What it would take |
| --- | --- | --- | --- |
| Two players | The title menu offers it; both player records (`BE1C`, `BE88`) run, aliens alternate their target by the parity of `cs:5119` (`1000:50CD`), credits can be shared (`cs:1118`), the HUD shows both, the camera follows both | `1000:50B1`–`50EF`, `1000:7BAE` (camera), HUD `18B2:17D0` | A second input byte and key bindings (SETUP.DAT `0x5E`–`0x66` hold only one set; the second set is not located), the camera rule for two players, target alternation, then a DOSBox comparison with two inputs |
| Shots more than 3 px above the map | `1000:3C08` reads the row table's preceding words, which are other data, so the cell it tests depends on unrelated memory | `1000:3C08` | Identify the words before `2EF5:1CA8` and what they make the test return; rare in practice (a shot fired upward at the top row) |
| Level change while a demo recording runs | `1000:1E9D` skips the player restore at the next level load while `cs:8716` is set, so the new level starts with a player record that the level load (`6644`) cleared and `1DF4` re-initialised | `1000:1E93`–`1F73` | Establish what `1DF4`–`1E6C` leaves in the record without the restore; a recording lasts 0x400 frames (about 15 s), so an exit inside one is unusual |
| Freeing a child record | `1000:74B5` frees child records (count `+34`) by clearing only the flags `+0A`/`+0B`, so their other fields persist into the next allocation | `1000:74B5`–`74FB` | Model per-field persistence for that path; the port reports it (`Freeing a child object`) |

## 2. Implemented from the disassembly, not compared with an original run

Each of these is covered by unit tests or the browser scenario, but no DOSBox capture has confirmed it. The DOSBox
method that worked for the death and countdown runs (inputs written into the demo playback buffer at `01F5:1F8D`,
watchpoints, frame ends keyed on `[AF84]`, see [scenarios/events-lbmz.json](scenarios/events-lbmz.json)) applies to the
in-level items; screens need breakpoints on their retrace waits instead.

| Item | Where in the port | Static source | Suggested check |
| --- | --- | --- | --- |
| Intex purchases (weapons, tools, map, credits) | `src/game/intex.js` | [intex.md](intex.md) | Partial restore with credits poked, a purchase typed through the menu, then the player record `+3E`, `+5E`, `+62` and the panel |
| Level transition and carried state | `nextStage`, `savePlayer`, `carriedGlobals` in `sim.js` | `1000:1FEE`–`2011`, `21A6`, `1E15`–`1E6C` | Watch the save at `21A6` and the restore, then compare the first frames of the next level |
| Intermission (deck lift, briefing, level code) and its timing | `src/game/intermission.js` | `1000:44EC` | Retrace counts at the waits, the deck-man script frames, the text pages |
| Bosses of levels 8 and 17 | `bossHook`, `bossMove`, `startBoss` in `sim.js` | `1000:6030`, `6958` | Same method as the level 5 boss (redirect the attract demo at `01F5:1830`) |
| Level 16/17 scripted spawns | `scriptedSpawn` | `1000:642D`, `4F01`, `515E` | Redirect the attract demo to index 16 and walk onto cell 0x0A |
| Title loop, credits, story pages, attract demo hand-off | `src/game/title.js` | `1000:083B`–`0B2D` | Retrace counts per page |
| Start-up logos | `src/game/intro.js` | `1000:0761`–`0767`, `7D0C`–`7DE4` | The black start palette was read in DOSBox; the retrace counts are static |
| Ending and game-over screens | `src/game/endings.js` | `1000:41A2`, `4109` | Retrace counts |
| Demo recording | `stepFrame` (`state.demoRecord`), `main.js` | `1000:364A`, `3935`–`3981` | Record in DOSBox with the cheat and compare the written `demo.dat` with the port's buffer for the same inputs |
| Exit cheat | `exitToDos` in `main.js` | `1000:7ABF`–`7B47` | — (the text comes from the user's executable) |
| The in-game timer rate and the countdown per frame | `src/game/timing.js` | PIT reload 0x26D7 (120 Hz) | Needs a run without breakpoint stops in the countdown window (stops change the ticks per frame), e.g. read `[B078]` and `[AF84]` only at the start and end |
| Countdown sounds (0x16 per second, 0x0B every 11th) | `timerTick` | `1000:78F0`–`7942` | Breakpoint on `1000:72B0` during the countdown |
| Music driver in-game timing (IRQs collapsed while the frame has interrupts off) | `advanceRetrace` | observed counts only | A long run comparing driver ticks with INT 8 runs at a known cycle setting |

## 3. Approximations

| Item | What the port does | Why |
| --- | --- | --- |
| OPL2 sound | Own synthesizer for the FM chip (`src/game/opl2.js`); the register writes it receives are exact | Envelope rates, key scaling and the rhythm section differ from the real chip |
| In-game music speed | `GAME_OPEN_SHARE` = 0.8: the share of each frame in which INT 8 can reach the music driver | A machine property in the original; 0.8 plays the songs at the 96 ticks/s their CMF headers declare |
| Boss wall tests | An occupied cell blocks; the original passes a leftover register as its own cell | The register's value at that point is not established |
| Level-start and spawn scans | Probe points outside the map are skipped | The original reads unrelated memory there |
| Counters at a new game | Boot values | In the original they depend on how long the title and attract loop ran; only the RNG seed (`[B07A]`) is modelled from elapsed time |
| Text-mode exit screen | The exit message in a plain text block | The original switches to 80×25 text mode and prints it with DOS |
| Saving the recorded demo | Offered as a `DEMO.DAT` download; the attract demo plays it for the rest of the session | The original writes `demo.dat` into the game directory, so it also plays after a restart |
| Panel reloads after a boss starts or dies (`209E`, `A316`, `A31A`) | Not reproduced | The panel is redrawn every frame anyway |
| Start-up code check | Off by default (as in `ALIEN.EXE`); the page option runs the unpatched check with a randomly picked entry, shown as plain text | The original picks the entry with its RNG, whose early seeding is not established, and prints in 80×25 text mode |

## 4. Not covered at all

- The SETUP program and sound-card selection: the port always behaves like the Sound Blaster set-up (`[AF94]` = 4).
- The pause and quit keys of SETUP.DAT (offsets `0x64`, `0x66`): the port reads the bindings but does nothing with them;
  where the original uses them is not located yet.
- Joysticks: the original polls them every 4th INT 8 tick (`1000:782E`) when SETUP.DAT selects one and reads the input
  word from `B42A`/`B42C`; the port takes the keyboard only.
- Other builds of the game: the port refuses executables other than the two supported hashes.
