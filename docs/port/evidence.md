# Port evidence log

Claims about the original program, each with its evidence level and scope. Levels:
**observed** (seen in DOSBox), **static** (read in Ghidra/disassembly), **regression** (checked by an
automated test), **approximate**, **unknown**. Addresses are Ghidra addresses unless marked *live*.

## Target identity

| Item | Value | Level |
| --- | --- | --- |
| Executable that runs | `ALIEN.EXE`, 183,351 bytes, SHA-256 `0787a2ca63e712ef1e2278fd5a78d9a0ea1e9ca0197398ab9e4cb684b067e0c7` | observed (DOSBox `C:\ALIEN.EXE`) |
| Unpatched twin | `ALIEN.EX_`, SHA-256 `8d998048583420402d9296918d1f119eb34c40980aa31bdd2b1fbe504728ac2a`; differs only at file `0xC52`–`0xC56` (passcode compare, see [`../ex_.md`](../ex_.md)) | static |
| Format | MZ, header 0x800 bytes, 0x1BF relocations, entry `CS:IP = 0000:0000`, `SS:SP = 1EC5:0300`; TLINK signature at `0x1C` | static |
| CPU mode | 16-bit real mode, no DOS extender. READ.ME: "written in 100% Assembler", so no C calling convention is assumed; most variables live in `cs:` or `DS=0x2041` (static) | static |
| Resource root | The game folder itself (`C:\`). Root `SETUP.DAT` is byte-identical to `sb16/SETUP.DAT` (SoundBlaster config), so `run.bat` (which copies over root files) is not needed | observed |
| `SETUP.DAT` | SHA-256 `cfd218f4…3c0c` | — |
| Music driver loaded at runtime | `AVMFM.BIN`, SHA-256 `db755df8…640c`, loaded COM-style (file offset 0 = *live* `2F11:0100`) | observed |
| Ghidra project | `ghidra/Alien Breed` (ignored by Git), program `/ALIEN.EXE` imported from `game/ALIEN.EXE` | — |

## Static-to-runtime mapping

The image is loaded at *live* segment `0x01F5` (PSP `0x01E5`) in the reference DOSBox session. Ghidra
loads it at `0x1000`, so **Ghidra segment = live segment + 0x0E0B**.

Validated by byte comparison: `CODE_0` (`1000:0460`, 96 bytes) and `CODE_5` (`2EF5:0000`, 32 bytes)
match live memory exactly, apart from bytes the game writes at runtime. Runtime `DS = 0x1236` maps to
`0x2041`, the start of `CODE_4`. Revalidate if the DOS environment, the launch path or the executable
changes, since the load segment depends on memory already in use.

## Reference emulator

- DOSBox build: `dosbox-automation 0.84.0-vc1 (f6d9b)`, heavy debugger, `normal` core, driven by the
  `dosbox-mcp` bridge 0.1.1 (protocol 1.14). The CPU cycle setting is in the bridge's human-edited config
  and is **not** visible through the MCP tools.
- Mount: a disposable copy of `game/` at `.work/dos` as `C:`, read-write (the game may write files).

Tool caveats found so far:

- `wait_for frames` counts host render frames (~62 per second of uptime), not the game's 70 Hz VGA
  refresh. Use counters inside the game for timing.
- Calls are not synchronized with emulation: the emulator keeps running between MCP calls, so two
  separate reads cannot measure a rate. Use never-firing conditional execute breakpoints
  (`condition: cs == 0`) as hit counters, which count over one shared interval.
- A memory watchpoint stopped in an unrelated drawing routine; read watchpoints need confirmation.
- There is no machine save-state. The only complete checkpoint is a fresh boot through the scenario
  recipe. Memory writes are partial restores and are only valid when noted.
- Breakpoints added while running stay inert until a pause/continue cycle. Issue state-changing calls one
  at a time.

## Timing and frame pacing

| Claim | Level | Where |
| --- | --- | --- |
| `ALIEN.EXE` reprograms PIT channel 0 itself only at start-up and exit: `1CE3:029E` writes control word 0xB4 but sends the count to port 40h (reload 0x438C, 69 Hz, from `1000:06B0`; 0xFFFF at `7B09`). Earlier this was misread as a PC-speaker tone. During play the music driver sets the rate (below) | static | `1CE3:029E` |
| The music driver programs the PIT on song start and stop: 0x308C (96 Hz) for title and Intex music, 0x26D7 (120 Hz) for in-game, monster and alarmed music, 0x438C (69 Hz) after a stop. Observed: 0x308C stored at *live* `2F11:013E` during the title, 0x26D7 (9943) during the attract demo (2026-10-18). Full analysis: [avmfm.md](avmfm.md) | observed + static | AVMFM.BIN |
| The game's INT 8 handler is `1000:7872`. It increments the frame-tick counter `[8184]` and `[AF86]`, a 32-bit counter `[B078]`, and a 1/80 accumulator `[AD4C] += 0x334` that drives a countdown `cs:[7969]` | static + observed (IVT) | `1000:7872` |
| INT 9 (keyboard) handler is `1000:79D4` | observed (IVT) | — |
| In-game frame end (`2EF5:1282`): set the CRTC start, wait for retrace start, set pel panning, then wait until `[8184] != 0`, reset it, and set the lag flag `[818A] = (ticks >= 5)` (forced to 0 when `byte [1000:8716] != 0`) | static | `2EF5:1282`–`12E8` |
| One game update per frame end: over one interval, 287 retrace waits and 287 completed frame ends against 1,476 INT 8 calls (5.14 ticks per frame at the current, unknown cycle setting) | observed | breakpoints at *live* `20EA:1297`, `20EA:12BC`, `01F5:7872` |
| The lag flag picks a faster movement table: `cs:[7B4A + flag*32 + dir*2]` | static | `1000:4CB5` |
| Port reference: on a fast machine every frame is one 70 Hz retrace and the lag flag stays 0 (one 10.4 ms tick always fits inside 14.3 ms) | **inferred**, still to be checked at high cycles | — |

## Files opened on the way into level 1

Observed 2026-10-17 with an INT 21h AH=3Dh breakpoint, fresh boot, route: launch, type `000` at the
passcode prompt, Enter through the title and both story pages. Names are as passed to DOS. Each name
lives in one of three filename pools in `DS = 0x2041` (around `9700`, `9A00` and `AE00`). Every pool
entry is the name followed by a 6-byte record whose meaning is still **unknown**.

| # | File | Phase |
| ---: | --- | --- |
| 1 | `setup.dat` | startup |
| 2 | `demo.dat` | startup (attract-mode input recording) |
| 3 | `avmfm.bin` | startup (FM music driver; sets the 96 Hz PIT) |
| 4 | `avm_sb.dat` | startup (compressed SoundBlaster driver) |
| — | passcode prompt (three INT 21h AH=01h reads) | |
| 5–29 | the 25 `sams\*.voc` samples, in table order at *live* `0E91:01BE` | after passcode |
| 30 | `team_17.vhf` | intro |
| 31 | `avm256.vhf` | intro |
| 32 | `avm.voc` | intro |
| 33 | `al_logo.vhf` | intro |
| 34 | `font.vhf` | intro |
| 35 | `adlib\title.cmf` | title music |
| 36 | `title.vhf` | title |
| — | story pages (no file opens) | |
| 37 | `moonpic.vhf` | before the game |
| 38 | `title.vhf` | reloaded |
| 39 | `player1.ehf` | game start |
| 40 | `player2.ehf` | game start |
| 41 | `boom_new.ehf` | game start |
| 42 | `alien03.ehf` | level 1 aliens |
| 43–45 | `lbms\tea.256`, `lbms\teb.256`, `lbms\tean.256` | level 1 tile group E |
| 46 | `lbmz.huf` | level 1 map |
| 47 | `panel.vhf` | HUD |
| 48 | `adlib\ingame.cmf` | in-game music |

So level 1 uses map `LBMZ.HUF`, tile group E and alien set 03, not the first file of each series. The
level-to-file mapping is not yet located in the code.

## Level table and map format

| Claim | Level | Where |
| --- | --- | --- |
| Level index `[B0B2]` selects the map record through a 19-entry word table at `2041:957D`. Records are `{far pointer to name, 4 bytes}` followed by the name. Index → map: 0 LZMZ, 1 L0MZ, 2 LBMZ, 3 L3MZ, 4 L4MZ, 5 L5MZ, 6 PCMAP4, 7 L6MZ, 8 L7MZ, 9 L8MZ, 10 L9MZ, 11 PCMAP3, 12 PCMAP5, 13 LAMZ, 14 L1MZ, 15 PCMAP2, 16 PCMAP1, 17 L2MZ, 18 PCMAP6 | static | `1000:1B70` |
| The attract demo uses index 2 (`LBMZ.HUF`). A new game starts at index **1** (`L0MZ.HUF`): `1000:17DE` sets `[B018] = 1`, or 2 when the demo mode `cs:[8716]` is non-zero, and `1830` copies it to `[B0B2]`. The earlier note that the first playable level is index 2 came from runs that reached the attract demo, not a new game (re-checked 2026-10-18: both observed level starts had `cs:[8716] = 2`) | static; observed (demo) | `1000:17DE`–`1830` |
| The loader decompresses the file into segment `[B411]` (observed `0x3811`), copies the first 0x2D00 words (23,040 bytes) to `2EF5:635A`, then calls the level initialiser `2EF5:0000`. The load buffer is reused soon afterwards | static + observed | `1000:1B70`–`1BB7` |
| The map is 120 × 96 cells of **big-endian** words. The initialiser writes `(w & 0xFC00) >> 10` (6-bit type) as a word array at `2041:0000` and replaces each cell in place with `(w & 0x1FF) << 4` (tile index as a 256-byte paragraph offset). Bit 9 is unused | static; tile pass observed exact for 77 of 96 rows ~1 s into a demo run (the remaining rows contain cells changed during play, not yet identified) | `2EF5:0000`–`0071` |
| `LBMZ.HUF` decompresses with `src/lzhuf.js` to 26,228 bytes; the remaining 3,188 bytes after the map are not yet explained | static (length) | — |
| Tiles are 16 × 16 blocks cut from the 320 × 200 `.256` sheets, 20 per row and 12 rows per sheet: tiles 0–239 from `T?A`, 240–479 from `T?B`. LBMZ uses at most tile 470. The role of `T?AN` is **unknown** | approximate (visual render matches the original's look; no pixel comparison yet) | — |

## Demo recording and playback

| Claim | Level | Where |
| --- | --- | --- |
| `cs:[8716]` is the demo mode: 0 = play, 1 = record, 2 = playback (observed during the attract demo). Recording appends the per-frame input byte `[B423]` to `cs:[8719 + n]` and writes the file after 0x400 frames | static (record path), observed (mode 2) | `1000:391D`–`3967` |
| `DEMO.DAT` (1,024 bytes) is read at startup; it is therefore a one-byte-per-frame input recording for 1,024 frames | inferred (size, open order) | — |
| The lag flag `[818A]` is forced to 0 while demo mode is non-zero, so demo movement does not depend on host speed | static | `2EF5:12DA` |
| Low 4 bits of `[B423]` select the movement direction | static | `1000:4CAA` |

## Copy protection

`1000:03D5` shows a manual-lookup prompt, picks an entry from `[B038] & 0x3F`, and reads three
keystrokes. In `ALIEN.EXE` the compare is skipped (`1000:0452`), so any three keys continue. By default the
browser port starts after this screen; the page option "Ask for the code" runs it (`src/game/passcode.js`).

| Claim | Level | Where |
| --- | --- | --- |
| `ALIEN.EXE` differs from `ALIEN.EX_` only in five bytes at file `0xC52` (`1000:0452`): `EB 22 90 90 90` jumps to `0476` → `0493` (RET) | static (byte compare) | `cmp ALIEN.EXE ALIEN.EX_` |
| Unpatched flow: `03C1` waits 100 retraces and sets three tries (`cs:0496`); `03D5` advances the RNG and takes entry = `[B038]` & 0x3F from the 64 six-byte records at `cs:049A` (row digits, column, then the three code characters), writes table letter 'A' + entry / 16, the row and the column into the prompt at `cs:061A` (`cs:0687`, `068D`/`068E`, `0697`), sets text mode 2, prints it with INT 21h/09 and reads three characters with INT 21h/01 (echoed; Enter counts) | static (`ALIEN.EX_` disassembled with ndisasm) | `1000:03C1`–`0441` |
| `0452`–`0474` compare the three characters byte for byte (case-sensitive); a mismatch waits 50 retraces (`0478`), decrements the tries and asks again with a new entry, and after the third failure jumps to `7B0F` (text mode, the exit message at `DS:5BBA`, program end) | static | `1000:0452`–`0493` |
| The RNG is seeded once at start-up from the clock: `1000:027D` INT 1Ah function 2 (BCD time), AX = (minutes << 8 \| seconds) + 0x40B, `[B0BA]` = AX, `[B0BC]` = −AX, `[B0BE]` = 1 (`seedFromClock`); nothing else steps it before `03D5`, which steps it once per prompt. DOSBox at 10:10:56 (CL = 0x10, DH = 0x56): after the step `[B038]` = 0x9A78, state 0x9A78/0x0489, history 1, entry 56, prompt "Table-D Row-16 Column-M", all as the port computes | static + observed (one boot, `01F5:0281`, `03D8`) | `1000:027D`–`02A4`, `03D5` |

## Sound effects

| Claim | Level | Where |
| --- | --- | --- |
| Effects go through `1000:72B0` with the sound id in AX. With the Sound Blaster device (`[AF94] = 4`) it calls `1000:7300`; devices 5–7 map the id through `cs:7243` to FM effects instead (not used by this port) | static | `1000:72B0` |
| Sound id *n* plays sample *n* of the list loaded at startup: near pointers at `1C9C:0184` up to `0xFFFF` (25 `sams\*.voc` names, loaded in order into far pointers at `DS:D3FC`, `1C9C:0365`). The driver is given the file data from offset `0x1A` (after the VOC header) | static | `1C9C:0365`, `1000:733B` |
| One voice. If the driver status word `[AFD0]` is 0 the stored priority `cs:[72AD]` is reset to 0 and the sample plays; otherwise the new sample is dropped when the stored priority is greater (signed `JG`) than the new id's priority `cs:[7275 + 2n]`, and replaces the playing one when equal or higher (driver function 8 stops it first) | static | `1000:7300`–`735E` |
| All 43 call sites of `72B0` were checked: each is either a `sounds.push` in the port (pickups, doors, hurt, hazards, firing, out of ammo, impacts, generators, countdown, explosions, alien kill, egg, weapon cycle) or inside a path that stops in strict mode (bouncing shots `5448`, destructible walls `5563`/`55DA`, Intex `2657`/`5BF9`/`14DA`, boss hooks `3669`/`6958`/`69AF`/`69EF`/`6C53`, level 16/17 `6456`, `7238` script sound from a non-implemented opcode path) | static | xrefs of `1000:72B0` |

## Level sequence and carried state

| Claim | Level | Where |
| --- | --- | --- |
| The main-loop pass `1000:34E6` checks keys before the level-over tests: `[B086]` (last INT 9 scancode) equal to the abort binding `[E7D5]` (SETUP.DAT `0x65`) ends the game; release of `1` (`0x82`) / `0` (`0x8B`) cycles player 1 / 2 to the next owned weapon (bit *w−1* of `+3E`) with sound 5; `M` (`0x32`) opens the map for a player whose `+62` bit 0 is set; `=`/`-` are cheats behind `cs:[7FD9] = 0xFF`; `R` starts demo recording behind `cs:[7FE2]` | static | `1000:34E6`–`3666` |
| Then: exit taken `[B427]`, nobody alive `[B09A] = 0`, end sequence `[92F2] >= 0x8C` each leave the loop through the player save `1000:21A6` | static | `1000:35B5`–`35DF` |
| After the loop: if the exit was taken, index 18 runs the ending (`1000:41A2`), index 0 runs `44EC`, any other index is incremented and the next level loads from `1000:1937`. Otherwise the music stops, the game-over screen (`4109`, not in demo mode) and the title follow | static | `1000:1FEE`–`205C` |
| `1000:21A6` saves energy `+2E`, lives `+5B`, keys `+2C`, ammo `+42`, weapon `+5A`, owned weapons `+3E`, credits `+5E/+60`, map flag `+62` and the words `+63..+69`; `1000:1E15`–`1E6C` restores them at the next level start. A new game sets energy 0x40, lives 4, keys 0, ammo 0x17F, weapon 1, owned 0x7F (player 1; player 2 owns 1) and zeroes the saved words, so `+69` (the movement mask) starts at 0 | static | `1000:188B`–`1932`, `21A6`, `1E15` |
| `+63..+6A` hold overlapping packed-BCD tallies: shots fired `+63` (`59DC`), kills `+65` (`4B5A`), doors opened `+67` (`4806`), each `ADD AX,1/DAA` then `ADC AX,0/DAA` on the next word. DAA adjusts AL only, so each word counts 00–99 in its low byte and carries into the next word's low byte | static | as listed |
| Between levels (not in demo mode) `1000:44EC` shows an intermission: `CARGOBAY` before index 1, otherwise `DECKLIFT` with the deck-man animation (scripts, up to 150 frames or fire), a text page from the table at `cs:5BDE + 2·index` (400 frames or fire) and, for index > 1, a 9-character code from `cs:82A6 + 10·(index−2)` (3000 frames or fire) | static | `1000:44EC`–`476E` |

## Music driver against the original

| Claim | Level | Where |
| --- | --- | --- |
| The port of the driver (`src/game/fmdriver.js`) reproduces the original's complete sequencer state (read position, delay counter, batch age, rhythm flags, voice owners, note codes, keys, KSL bits, volumes, F-numbers, age stamps, programs, pitch offsets) after 1000 driver ticks of TITLE.CMF and 3000 ticks of INGAME.CMF from fn 6, captured in DOSBox at the driver tick entry *live* `2F11:120E` (`npm run verify:runtime`, captures in `.work/captures`). Negative control: one tick more differs | independent runtime | `scripts/runtime-checks.mjs` |
| In the attract demo at slow DOSBox cycles (about 21 frames per second), 2,030 INT 8 runs against 1,768 driver ticks and 358 frames: the music skips the IRQs that arrive while the frame has interrupts off | observed (breakpoint hit counts at `01F5:7872`, `2F11:120E`, `20EA:12BC`) | — |
| Nothing in ALIEN.EXE writes OPL registers, and the driver never writes register 1, so waveform select stays off and every operator plays a sine | static (no `0x388` users besides the driver set-up at `1000:023B`) | — |

## Bosses against the original

| Claim | Level | Where |
| --- | --- | --- |
| Partial restore in DOSBox: the attract demo redirected to level index 5 (AX = 5 at *live* `01F5:1830`), player 1 moved to (1712, 848) and `[7B3F]` = 0xFF at `01F5:1F8D`, starting counters read there (RNG seed 26, `[AF84]` 10240, `[AD4C]` 16148, cs:4035 12, cs:5119 161, cs:7969 5). The port, started from the same values and fed `DEMO.DAT`, reproduces the boss (position, sprite frame, energy, facing, mode, countdown), player 1 (position, ammo, sprite frame), the RNG and the types of the first six records at frame-end hit 5 (port step 5, unfitted; one step off fails) and, **fitted**, at hit 115 (port step 120, chosen because it matches: the RNG and the boss position are constant over steps 113-123, so only the boss countdown and the shot count pin the step). Why the original's hit count is 5 behind is not established (inferred: breakpoint hits lost while skipping). Future captures should read the frame counter `[AF84]` (incremented once per pass at `1000:3806`) instead of relying on hit counts | independent runtime (partial restore; one unfitted, one fitted point) | `npm run verify:runtime` |
| In the first attempt (player left on the spawn point), the original completed level 5 as soon as the boss started, because the spawn point is an exit pad and the exit counts once the boss is active; the demo then loaded index 6. The port predicts the same | observed | — |
| The lag flag: the frame end `2EF5:12B4` takes `[8184]` (INT 8 runs since the previous frame end, never reset elsewhere) and sets `[818A]` = 1 at 5 or more, except in demo playback. The first frame after the level-start fade, the Intex or the M screen is therefore a lag frame | static | `2EF5:12B4`–`12E2` |

## Generator kill, death and countdown against the original

Scenario `scenarios/events-lbmz.json`: inputs planned in the port (a waypoint controller over the level's type grid) and
written into the demo playback buffer `cs:8719` at *live* `01F5:1F8D`, so the original plays them in attract mode with
the lag flag forced to 0. Captures in `.work/captures` (local), checked by `npm run verify:runtime`.

| Claim | Level | Where |
| --- | --- | --- |
| Demo playback reads `cs:[8719 + cs:[8717]]` into `[B423]` (`1000:3996`), the buffer recording writes; after a fresh boot the attract demo starts with `[AF84]` = 0, RNG state 0/0/1 (seed 0) and `[8182]`, cs:4035, cs:4037, cs:5119, cs:5A43, cs:5671 at 0 and cs:602A at 0xFFFF; `[AD4C]` (36112, 37752) and cs:7969 (7) depend on how long the title ran and only matter for the countdown, which takes them from the capture | static + observed (three boots) | `1000:3928`–`39BD` |
| A frame end (`2EF5:12BC`) with `[AF84]` = N shows the state at the port's flip of step N−1: that pass's scripts have run, its player and alien updates (`1000:39C6`, `3A95`) have not. 95 frame ends across both runs match on player 1 (position, frame, energy, ammo, lives), records 1–5 (type, position, frame, energy), the RNG and `[BD5F]`; one step later fails | independent runtime (run A unmodified; run B partial restore) | `npm run verify:runtime` |
| Generator: with `[BD5F]` poked to 3 at the level start, the shot kill (`1000:53B7`) and the self-destruct start (`5F94`, `[AF8A]` = 0xFF, `[AF8B]` = 0x60) happen in the pass with `[AF84]` = 622, as in port step 621 | independent runtime (partial restore) | `npm run verify:runtime` |
| Countdown: from the start counters (`[AD4C]` = 36112, `cs:7969` = 7 at `[B078]` = 8276), the original changes `[AF8B]` at the same INT 8 counts as the port's `timerTick` (12 values 0x60 → 0x49, `[AD4C]` and `cs:7969` included); one tick later fails. The sounds (0x16 per second, 0x0B at cycle 0) were not captured; they follow from the code (static). Compared in ticks, not frames: breakpoint stops change how many ticks fall into a frame (5 to 7 per frame in these runs), so this says nothing about real-time rates | independent runtime (partial restore) | `npm run verify:runtime` |
| Death: on the 0x40 cell (moving left) the original takes 0x10 twice in pass 486 and four times in pass 487, loses the life and starts the dying script (type 2) in pass 487, and is back to type 1 in pass 520; an alien contact costs 6 in pass 926. The port matches all of them (respawn 33 frames after the death) | independent runtime (unmodified) | `npm run verify:runtime` |
| Fixed after these runs: the shot test `1000:4987` takes the alien's y from the shot's y to y + 0x20 (`ADD AX,10h` / `SUB AX,10h` cancel), not ±0x10, so a new shot hits in the pass that fires it | static + runtime (the earlier window put the player 3 px off from pass 445 on) | `1000:49A5`–`49B9` |
| Fixed after these runs: the script end frees a record with `1000:759C` (`REP STOSB`, 0x6C zero bytes); the allocator `7376` and the alien spawn `5074` do not write push `+26`, move mask `+69` or stuck `+4D`, so a hatching alien's first move is blocked by the zero mask (`4CB5`, reset to 0x0F at `4D07` after the move). The level load clears all 50 records (`6644` from `1DA9`, 0x1518 bytes from `BE1C`). Values left by the child-free path `74B5` (flags only) are not modelled | static + runtime (alien x was 1 px off, walk and stuck one off) | `1000:7376`, `759C`, `5074`–`50EF`, `4D07` |

## Start-up logos and the last two cheat words

| Claim | Level | Where |
| --- | --- | --- |
| After the memory set-up, `1000:0761`–`0767` call `7D0C` (record `AE0E`, TEAM_17), `7D38` (`ADFB`, AVM256, with the sample record `ADEB`) and `7D20` (`AE22`, AL_LOGO), then the font is loaded (`076F`) and the title loop starts. Each runs `7D52`: load, `D924` draws the picture, `767D` waits for one retrace, the palette is taken from offset 64000, the AVM logo starts its sample through the voice driver (only with `[AF94]` = 4), `D863` fades in, `7709` waits `cs:7D35` retraces (100, 200, 100) and `D779` fades out. Nothing reads the keyboard | static | `1000:0752`–`0787`, `7D0C`–`7DE4` |
| The palette is black when the first logo's fade-in starts (DAC entries 0–7 and 200–201 read as 0 at `01F5:7DCB`) | observed (one boot) | DOSBox port reads `3C7`/`3C9` |
| Recording cheat `7FDA` sets `cs:7FE2`; then at `1000:364A`, every main-loop pass in which `[B086]` is 0x13 (R, not consumed) sets `cs:8716` = 1 and `cs:8717` = 0, so recording starts from the last pass that still sees R. Each pass of `37D6` stores the input byte `[B423]` at `cs:8719 + index` (the buffer the attract demo plays); at 0x400 recording ends (`cs:8716` = 0) and `3956`–`3981` create `demo.dat` and write the buffer. While `cs:8716` is set the frame end keeps the lag flag at 0 (`2EF5:12DA`), the level load skips the intermission (`1986`) and the player restore (`1E9D`), and the game end skips the game-over screen (`2043`) | static | `1000:3651`–`3666`, `3928`–`398A` |
| Exit cheat `801C` jumps to `7ABF`: the music driver is stopped (functions 7, 8, 3), the voice driver and the timer are reset, mode 2 (80×25 text) is set, the '$'-terminated text at `DS:5BBA` is printed (`[5A00]` = 0 on this path; 1 and 2 select `AE9C` and `5BA4`, set by driver errors in segment `1CE3`) and `INT 21h/4Ch` ends the program | static | `1000:7ABF`–`7B47` |

## Shot probes outside the map

| Claim | Level | Where |
| --- | --- | --- |
| `1000:3C08` indexes per pixel: DI = word `[2EF5:1CA8 + 2(y−16)]` + word `[2EF5:3CA8 + 2(x−16)]`, then reads the word at `DS:DI` (`[AF82]`, code `[AF81]`); the type map starts at `DS:0`. The shot update calls it after the move (`539B`) and does not check the out-of-map flag `cs:3C07` | static | `1000:3C08`–`3C7E`, `52F4`–`53A4` |
| The level set-up `2EF5:0000` stores width 0x78, height 0x60 and stride 0xF0 at `2EF5:1CA2`, `1CA4`, `1CA6` (zero in the file) and fills the row table with (py >> 4)·0xF0 and the column table with (px >> 4)·2, 16 entries per cell. So 1, 2 and 3 pixels above the map read DI = 0xF0, 0x60, 0x78 + 2·column (row 1, and row 0 shifted by 48 or 60 cells), not row 0 as the port assumed before; left of the map the column word is the row table's tail, 0xEF10 | static + observed (live words at `20EA:1C9C`–`1CA7`, both tables) | `2EF5:0006`–`00B9` |
| Further up the row words are code bytes of `2EF5` (`1C82`–`1CA1`); the word at `1C9D` is a segment the DOS loader relocates (0x1041 in the file, 0x1236 in DOSBox, load segment `01F5`), which moves the reads 5 and 6 pixels above. No shot moves faster than 19 pixels a frame (lag and spread included), and shots above the camera are removed before they move, so probes reach at most 19 pixels above | static + observed | `2EF5:1C9C` |
| `DS` areas these reads reach held the executable's bytes at the level starts of index 2 (demo) and index 1 (a game) and at demo frame 900: `F79C`, `9C8A`, `9D88`, `8826`, `669D`, `8A05`, `FF9C` (240 bytes each). `8E12` (5 pixels above) changes during play and is not modelled; `C3D8` (4 pixels above) is in the object records, zero while a record is free | observed (three snapshots) | — |
| Level index 11 (PCMAP3) is the only level where a reachable row-1 cell (columns 20–31) has an open row-0 cell above. With the attract demo redirected there and the player placed in row 1 firing upward, the original's words read 1, 2, 3, 4, 6, 7 and 8 pixels above the map (70 probes) equal the port's model, including the player's occupancy bit (0x8000) one pixel above and wall codes 2 and 3 pixels above, where the old row-0 rule read 0x10 | independent runtime (partial restore) | `npm run verify:runtime`, scenario `shot-above-map.json` |
