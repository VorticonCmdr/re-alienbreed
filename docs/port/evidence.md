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
| `ALIEN.EXE` never reprograms PIT channel 0; its only port-0x43 write is a PC-speaker tone (`1CE3:029E`) | static (byte search for `E6 43`, `BA 43 00`, `B0 36`) | — |
| `AVMFM.BIN` sets PIT channel 0 to mode 3 with reload `0x308C` (12,428), i.e. **96.0 Hz** | observed (PIT read-back status `0x36`; reload stored at *live* `2F11:013E`; setter at driver file offset `0x960`) | AVMFM.BIN |
| The game's INT 8 handler is `1000:7872`. It increments the frame-tick counter `[8184]` and `[AF86]`, a 32-bit counter `[B078]`, and a 1/80 accumulator `[AD4C] += 0x334` that drives a countdown `cs:[7969]` | static + observed (IVT) | `1000:7872` |
| INT 9 (keyboard) handler is `1000:79D4` | observed (IVT) | — |
| In-game frame end (`2EF5:1282`): set the CRTC start, wait for retrace start, set pel panning, then wait until `[8184] != 0`, reset it, and set the lag flag `[818A] = (ticks >= 5)` (forced to 0 when `byte [1000:8716] != 0`) | static | `2EF5:1282`–`12E8` |
| One game update per frame end: over one interval, 287 retrace waits and 287 completed frame ends against 1,476 INT 8 calls (5.14 ticks per frame at the current, unknown cycle setting) | observed | breakpoints at *live* `20EA:1297`, `20EA:12BC`, `01F5:7872` |
| The lag flag picks a faster movement table: `cs:[7B4A + flag*32 + dir*2]` | static | `1000:4CB5` |
| Port reference: on a fast machine every frame is one 70 Hz retrace and the lag flag stays 0 (one 10.4 ms tick always fits inside 14.3 ms) | **inferred**, still to be checked at high cycles | — |

## Copy protection

`1000:03D5` shows a manual-lookup prompt, picks an entry from `[B038] & 0x3F`, and reads three
keystrokes. In `ALIEN.EXE` the compare is skipped (`1000:0452`), so any three keys continue. The
browser port starts after this screen. The code table is not read or reproduced.
