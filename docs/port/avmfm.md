# AVMFM.BIN: FM music driver

Spec for a bit-exact JavaScript port of the AdLib/FM music path. The original bytes are not reproduced here. Every
table is named by file offset, size and element type, and the port reads it from the user's `AVMFM.BIN` at runtime
(6,9xx bytes, SHA-256 `db755df8…640c`).

**Addresses.** `f:XXXX` is a file offset, which is also the Ghidra address in program `AVMFM.BIN`. The driver is loaded
COM-style, so *live* = `f + 0x100`, and every absolute address inside the driver's own code is a live address. ALIEN.EXE
addresses are Ghidra `1000:XXXX` (file offset `0x800 + XXXX`). **V** = Verified (read in the disassembly at the given
address). **I** = Inferred. **U** = Unknown.

## 0. Identity

- **V** The driver is a resident memory image of Creative's `SBFMDRV` (CMF driver), family "Version 1.30B". The
  leftover strings start at f:13C6. It has no installer code: header fields (old vectors, segments, port) are
  pre-filled, and the game patches them. Data occupies f:0000–0934 (the velocity table ends at f:0934). Code runs from f:0935 (set-vector, unused) to about f:13C5. Everything
  after f:13C6 is junk.
- **V** Signature `FMDRV` at f:0003.

### Driver variables (all in the driver segment)

All are little-endian. Each initial value is whatever the file holds at that offset.

| f: | size | meaning |
| --- | --- | --- |
| 009 | w | OPL index port. The data port is +1. The game writes 0x388 (`1000:023B`) |
| 010 | w | driver-side loop count (fn 15). Reset to 0 by fn 8. The game never sets it |
| 012 | dw | far pointer: "old INT 8" chained by the tick handler. Filled by the game |
| 01A | dw | far pointer to the instrument bank (16 bytes per instrument) |
| 01E | dw | far pointer: current read position in the music data (offset, segment) |
| 026 | dw | far pointer: start of the music data (kept for the driver-side loop) |
| 02A | dd | 32-bit tick delay counter |
| 02E | dw | far pointer to the caller's status byte |
| 032 | dw | far pointer: user trap called on SysEx F0. 0 = none |
| 036, 038 | w | busy-wait loop counts after the OPL index write and data write |
| 03A | w | "system clock" reload, set by fn 3 |
| 03C | w | music PIT reload, set by fn 4 |
| 03E | w | reload currently programmed into the PIT |
| 040 | w | chain accumulator |
| 042 | w | free-running accumulator (never read by the game) |
| 044 | w | melodic voice count: 9, or 6 in rhythm mode |
| 046 | b | current event channel (low nibble of the status byte). f:047 stays 0 |
| 048 | b | current event type: high nibble − 8. f:049 stays 0 |
| 04A | w | batch counter ("age"), +1 per processed batch |
| 04C | w | global transpose in semitones (fn 5). Never set by the game: 0 |
| 052 | 16×16 b | built-in instrument bank, used only after fn 8 |
| 152 | 11 b | voice owner: channel (active), channel\|0x80 (released), 0xFF (free) |
| 15D | 11 b | voice note code (block<<4 \| semitone), kept for pitch re-tuning |
| 168 | 11 b | voice MIDI key as received |
| 173 | 11 b | voice KSL bits (level byte & 0xC0) |
| 17E | 11 b | voice volume (0x3F − TL) used at note-on |
| 189 | 11 b | voice base volume (fade source) |
| 194 | 11 w | voice A0/B0 value without the key-on bit (low = A0, high = B0) |
| 1AA | 11 w | voice age stamp (the f:04A value at note-on) |
| 1C0–1C6 | | fade state (fn 14, unused by the game) |
| 1C7 | 9 b | operator offset of voice 0–8 (the modulator slot, standard OPL2 layout) |
| 1D0 | 11 b | default register image used by the reset routine (§4.1) |
| 1DB | 5 b | percussion operator offset for percussion index 6–10 (stored as `[f:1D5+idx]`) |
| 1E0 | 5 b | BD-register bit for percussion index 6–10 (`[f:1DA+idx]`, also `[f:1D5+ch]` for ch 11–15) |
| 1E5 | 5 b | OPL voice number for percussion index 6–10 (`[f:1DF+idx]`) |
| 1EA | b | instrument count |
| 1EB | b | play state: 0 stopped, 1 playing, 2 paused |
| 1EC, 1ED | b | data bytes 1 and 2 of the current event |
| 1EE | b | INT 80h re-entrancy flag |
| 1F0 | b | shadow of OPL register 0xBD |
| 1F1 | b | rhythm-mode flag |
| 1F3 | 16 b | current program per MIDI channel |
| 203 | 16 w | pitch offset per channel, in 1/64-semitone steps (controllers 0x68/0x69) |
| 223 | 16 b | channel enable. A note-on is ignored when the byte is 0. All 1 in the file, and fn 8 sets all to 1 |

Percussion indices: 6 = bass drum (ch 11), 7 = snare (ch 12), 8 = tom (ch 13), 9 = cymbal (ch 14), 10 = hi-hat (ch 15).

## 1. Entry points and INT 80h functions

- **V** The game installs the vectors itself. At `1000:0206`–`0252`, right after loading the driver at paragraph
  `[B088]`:
  - IVT 80h ← driver:live 0x12CE (dispatcher f:11CE).
  - The driver's f:012 ← the current INT 8 vector (`AX=3508h` at `1000:021F`).
  - f:009 ← 0x388.
  - fn 1 with status byte `1041:E33A`.
  - fn 3 with AX = 0x438C.
- **V** Later, `1000:06B5` calls `1000:771A`. When `[AF92]==0` (FM music), that routine sets IVT 60h ← driver:live 0x120E
  (the tick handler f:110E, at `1000:778A`). It then saves the INT 8 vector, installs the game's `1000:7872` as INT 8,
  and copies the old INT 8 vector to INT 62h and the old INT 9 vector to INT 61h (`1000:77BC`–`77FB`).
- **I** The order of these two blocks follows the linear init path (`01DB`–`0252` runs before `06B5`). So f:012 holds the
  pre-game INT 8 vector (normally the BIOS), not `7872`. This was not checked live.
- **V** The driver's INT 9 handler (f:119A, Ctrl+Alt+Del → all notes off) is never installed by the game.

**Dispatcher** f:11CE (**V**):
- It saves the registers and sets DS=ES=CS.
- If the busy flag f:1EE is set, it returns AX=0xFFF8. Otherwise it sets the flag and executes `sti` (interrupts are
  enabled inside all functions).
- BX 0–15 dispatch through the 16-word table at f:26B. A negative BX dispatches as `~BX` (0–4) through the 5-word table
  at f:28B. Any other value returns AX=0xFFFF.
- The result goes to the caller's AX. Some functions also return DX by writing the saved DX slot.

| BX | f: | function |
| --- | --- | --- |
| 0 | 1231 | AX = version word f:00C |
| **1** | 1235 | set the status byte pointer to DX:AX (exchanged; the old pointer is returned), then write 0 to the new byte |
| **2** | 1248 | instrument bank: f:1EA = CL, f:01A = DX:AX. Then run the mode reset (§4.2) and the voice reset (§4.1). AX=0 |
| **3** | 128A | f:03A = AX ("system clock" reload). The PIT is not touched |
| **4** | 128E | f:03C = AX, then **program the PIT at once**: f:03E = AX, port 43h ← 36h, port 40h ← AX lo, then hi. AX=0 |
| 5 | 1297 | f:04C = AX (transpose). AX=0 |
| **6** | 0C77 | play DX:AX (§3.1). Returns 0xFFFE if already playing or paused |
| **7** | 127A | if the state ≠ 0, stop (§3.4), AX=0. Otherwise AX=0xFFFD |
| **8** | 0C38 | reset: loop f:010=0, fade off, stop, mode reset, enable all 16 channels, bank = built-in (16 instruments at f:052), voice reset, f:03C=0x48D3, transpose 0 |
| 9 | 0CE4 | pause: if the state is 1, set the state to 2 and run all-notes-off (§3.4). Otherwise 0xFFFD |
| 10 | 0CF9 | resume: if the state is 2, set it to 1. Otherwise 0xFFFC |
| 11 | 129D | set the SysEx trap to DX:AX |
| 12 | 12AA | DX:AX = CS:live 0x323 (the channel-enable table) |
| 13 | 12B1 | DX:AX = the current event position |
| 14 | 12BF | fade (DI step period, CX/AX levels in %). Unused by the game |
| 15 | 1316 | swap the loop count f:010 with AX |
| −1…−5 | 131B… | read saved vector AL / CS:0x142 / CS:0x2EE / write saved vector CL / CS:0x2EB |

**V** The game uses only functions 1, 2, 3, 4, 6, 7 and 8. All 25 `CD 80` sites in ALIEN.EXE were checked:

- Init (`024A`, `0252`): fn 1 and fn 3.
- Song start (`0C30`/`0C47`/`0C60` title, `2309`/`2328`/`2341` monster, `23C7`/`23E6`/`23FF` alarmed, `2485`/`24A4`/`24BD`
  in-game, `2543`/`255A`/`2573` intex): fn 2, then fn 4, then fn 6.
- Stop (`17CF`, `2039`, `2283`): fn 7, after clearing `cs:[0F0C]`.
- Loop restart (`79BB`, `79CE`): fn 7, then fn 6.
- Exit (`7ADB`, `7AE0`, `7AE8`): fn 7, fn 8, then fn 3 with 0xFFFF.

Song start sequence (**V**, CMF loaded at offset 0 of segment `[E338]`):

```
fn2(AX = hdr[06h] (instrument offset), DX = seg, CX = hdr[24h] (instrument count))   ; driver keeps CL only
fn4(AX = 0x1234DC / D)                                                               ; 16-bit DIV, quotient
cs:[0F0C] = 0xFF                                                                     ; "loop this song"
fn6(AX = hdr[08h] (music offset), DX = seg)
```

The divisor D is set per song, and every CMF has hdr[0Ch] = 96:

| Song | Caller | D | Reload | Rate |
| --- | --- | --- | --- | --- |
| title | `0BAD` | `hdr[0Ch]` = 96 | 12428 (0x308C) | 96.01 Hz |
| intex | `24C0` | `hdr[0Ch]` = 96 | 12428 (0x308C) | 96.01 Hz |
| monster | `2286` | `T + (T >> 2)` with T = `hdr[0Ch]`, so 120 | 9943 (0x26D7) | 120.00 Hz |
| alarmed | `2344` | `T + (T >> 2)`, so 120 | 9943 (0x26D7) | 120.00 Hz |
| ingame | `2402` | `T + (T >> 2)`, so 120 | 9943 (0x26D7) | 120.00 Hz |

The 0x308C value in [evidence.md](evidence.md) was therefore title or intex music. In-game music runs at **120 Hz**.

## 2. Timing

### 2.1 Interrupt chain while FM music is enabled (`[AF92]==0`) — V

```
IRQ0 (PIT ch0) ──► game 1000:7872 (the real INT 8 handler)
                    ├─ counters: [AF86]++, [8184]++, [B078]++ (32-bit), [AD4C]+=0x334 …
                    ├─ if byte [7B4A] != 0 → own-chain path (set to 0xFF by the file loaders D01F/D076 while a file is read; see intex.md 9.1)
                    ├─ if cs:[3AEB] == 0:  call 796A
                    │      796A: INT 60h ──► driver tick handler f:110E (§2.2); the driver EOIs or chains the BIOS
                    │            then: if [E33A]==0 and cs:[0F0C]==0xFF → INT80 fn7, fn6 (restart the song)
                    │            then: pop the return address, jump to 795E: restore registers, IRET
                    │            (the game's own chain/EOI at 794D is SKIPPED)
                    └─ else (cs:[3AEB] != 0): 794D: [B41F] += 0x5DEC; on carry INT 62h (old INT 8), otherwise EOI
```

The INT 60h path lives at `1000:7942`–`79D3`.

- So the game's handler is the outermost IRQ0 handler and runs **once per PIT interrupt**. The driver is a sub-call.
  The brief's "driver chains to 7872" is reversed: the driver chains only to the pre-game vector at f:012.
- The PIT reload is always the one the driver last programmed:

| State | Reload | Game INT 8 rate |
| --- | --- | --- |
| from `1000:06AD` until the first song start | 0x438C = 17292 (see the note below) | **69.00 Hz** |
| title or intex playing | 12428 | 96.01 Hz |
| monster, alarmed or in-game playing | 9943 | **120.00 Hz** |
| after any stop: fn 7, fn 8, or FF 2F / FC inside the song | `[f:03A]` = 0x438C = 17292 | **69.00 Hz** until the next fn 4/fn 6 |

- **The game reprograms channel 0 itself (V).** The routine `1CE3:029E` writes control word 0xB4 (channel 2, mode 2) to
  port 43h but sends CX to port **40h**. Port 40h is channel 0's data port, so the write reloads channel 0 in the
  lo/hi mode it already has (I: standard 8254 behaviour).
  - At init (`1000:06AD`) CX = 0x438C, which matches fn 3. The game therefore runs at 69 Hz from start-up, before
    `7872` is even installed.
  - At exit (`1000:7B06`) CX = 0xFFFF, which restores about 18.2 Hz. The exit also calls fn 7, fn 8, then fn 3 with
    0xFFFF (`1000:7AD8`–`7AE8`). fn 3 does not touch the PIT.
  - [evidence.md](evidence.md) states that ALIEN.EXE never reprograms PIT channel 0. That statement needs correcting
    for this routine.
- Consequence for the port: `[8184]` (frame ticks and the lag threshold of 5), `[B078]` and the self-destruct accumulator
  `[AD4C]` (carry every ⌈65536/820⌉ = 80 IRQs) all count at **120 Hz** while in-game, monster or alarmed music plays.
  They count at 69 Hz in gaps after a stop.
- **I** With another music device (`[AF92]` 1 or 2) AVMFM is not loaded, nothing reprograms the PIT, and the rate stays
  18.2 Hz. Out of scope for this spec.

### 2.2 Driver tick handler f:110E (live 0x120E) — V

```
on INT 60h:
  if state == 1:
     (fade step: only when f:1C0 != f:1C1; unused)
     counter32 -= 1
     if borrow (counter was 0): processBatch()          ; on a private stack, with interrupts disabled
  acc42 += cur
  t = acc40 + cur  (16-bit, carry c)
  acc40 = t & 0xFFFF
  if c or acc40 >= sys:                          ; cur = f:03E, sys = f:03A
     do { acc40 -= sys; call far [f:012] (pushf) } while (acc40 > sys)   ; unsigned, strictly greater
  else: out 20h, 20h (EOI)
  iret
```

- One driver call = one CMF tick. The CMF header's ticks per second (96) is not read by the driver; only the game uses
  it, to choose the PIT rate.
- The BIOS is chained at about `rate × cur / sys` ≈ 69 Hz, not 18.2 Hz, because the game sets `sys` = 0x438C. This only
  matters for anything reading the BIOS tick count.

### 2.3 Ticks the music loses in-game — V for the code path, I for the effect

- Each in-game frame sets `cs:[3AEB]=0xFF` at `1000:386D` and executes `cli` at `3873`. It then calls `6874` and the
  frame-end routine `2EF5:1260`, which writes the CRTC, waits for the start of vertical retrace and executes `sti` only
  at `2EF5:12B3`. After that it waits for `[8184] != 0`. It clears `3AEB` at `1000:3898`.
- `6874`, `74B5`, `759C`, `68E7` and `6958` contain no `sti` (the first level of callees was read; deeper callees were
  not).
- **I** So per frame:
  - every IRQ that falls inside the `cli` span collapses into one IRQ, delivered at the `sti`;
  - that IRQ, and any other IRQ before `3898`, runs with `3AEB != 0` and **does not tick the music**;
  - only IRQs that land between `3898` and the next `386D` (game logic and drawing) advance the song.
- In-game tempo is therefore 120 Hz × (the share of IRQs outside the window), which depends on the machine. On a fast
  machine whose frame is mostly retrace wait, music would nearly stall. The ×1.25 applied only to the three gameplay
  songs is consistent with the authors compensating for lost ticks.
- **U** The real ratio on a reference machine. Measure it in DOSBox by counting hits at live `driver:0x120E` against hits
  at `01F5:7872` over one interval. The port must choose a model: emulate the window (recommended in strict mode), or
  run the driver at a fixed 120 Hz × measured ratio.
- **I** The same collapse hits the game's own counters, because a lost IRQ never runs `7872` at all. `[8184]`, `[B078]`
  and `[AD4C]` (the self-destruct timer) therefore also run below the nominal 120 Hz, and on a fast machine they drop
  towards one handler call per frame. The IRQs inside the window *do* still count these, since `7872` runs; they only
  skip the music. This affects the port's explicit INT 8 tick model.
- Title and intex music play from other loops. Whether those loops have a similar window is **U**.
- **V** `1CE3:029E` (the channel-0 reload) has exactly two callers: far calls at `1000:06B0` (CX=0x438C) and `1000:7B09`
  (CX=0xFFFF). There are no near calls inside segment `0CE3`, so no sound-effect path reprograms the PIT mid-game.

### 2.4 Song transitions

| Start site | Song | Stop first? |
| --- | --- | --- |
| `1000:61B7` | monster | **V** yes, `61B4` calls the stop routine `2261` |
| `1000:2649` | intex | **V** yes, `2593` (the same routine starting at `2588`) |
| `1000:2930` | in-game, after intex | **V** yes, `28B8` |
| `1000:1FBE` | in-game, at level start | **I** yes, the title is stopped at `17CF` on the game-start path (not traced end to end) |
| `1000:5FBD` | **alarmed**, at self-destruct start | **V no**: `5F9B`–`5FBD` only runs a palette routine (`5F60`) before calling `2344` |

**I** Consequence for alarmed, while in-game music is still playing:

1. The loader overwrites the CMF buffer in segment `[E338]` with ALARMED.CMF. The driver is reading from the same buffer.
2. fn 2 runs the voice reset and mode reset in the middle of the song, and switches the bank to the new file's
   instruments. The offset is the same (40).
3. fn 4 reprograms the PIT to 120 Hz, the same rate, which resets the counter phase.
4. fn 6 is **refused** (0xFFFE).
5. The driver therefore keeps interpreting ALARMED's bytes from in-game's current read offset, with running status and
   counter intact. It continues until it meets a 0x66 controller, FF 2F or FC. The game's loop check then restarts
   cleanly at ALARMED's start.

This is deterministic, so a port that runs the driver as an interpreter over the raw buffer reproduces it exactly. Bytes
past the new file's length are stale data from earlier loads.

### 2.5 Loop restart and PIT phase — V

- Every song has a CMF controller 0x66 value 0 long before its FF 2F. Controller 0x66 writes its value to the status
  byte (§3.3), so the **marker is the loop point**. Marker tick against the end-of-track tick:

| Song | Marker tick | FF 2F tick |
| --- | --- | --- |
| INGAME | 12288 | 131071 |
| ALARMED | 3456 | 98303 |
| INTEX | 3456 | 98303 |
| MONSTER | 3686 | 78642 |
| TITLE | 9216 | 65535 |

- In the same IRQ, after INT 60h returns, `796A` sees `[E33A]==0` and calls fn 7 and then fn 6:
  - fn 7 stop: state 0, PIT ← 0x438C, all notes off, status ← 0.
  - fn 6 play: PIT ← the song rate, chain accumulator 0, status ← 0xFF.
- Both writes restart the PIT count, so the first period after a loop is a full period measured from the second write
  (**I**: 8254 mode 3 behaviour).
- Events after the marker that share its delta-0 batch were already processed before the restart.
- The INT 80h dispatcher runs `sti`, so this restart runs with interrupts enabled inside the IRQ.

## 3. CMF sequencing

### 3.1 Play (fn 6, f:0C77) — V

```
if state != 0: return 0xFFFE
start = cur = DX:AX
pitchOfs[0..15] = 0                               ; f:203
owner[0..8] = 0xFF                                ; f:152 (entries 9 and 10 are not reset here)
counter32 = readVLQ()                             ; the FIRST delta, not delta - 1
age = 0
setPIT(f:03C)                                     ; f:03E = f:03C
acc40 = 0
modeReset()                                       ; §4.2: 9 voices, rhythm flag 0, BD = 0xC0
state = 1  (see below)
*status = 0xFF
return 0
```

**Self-modifying code (V).** The code at live 0xDD6 (f:0CD6) reads `mov byte [2EB],0`. The VLQ reader f:0B44 ends with
`cmp byte [101h],0 / jne / mov byte [0DDAh],1` and then `mov byte [0C73h],0C3h`. On its first call, because f:001 is 0,
it patches the immediate at f:0CDA to 1 and turns its own tail into `ret`. A port must treat play as setting state 1. A
literal reading of the static listing never ticks.

**Program table not reset.** f:1F3 is untouched by play, so programs persist across a restart. All five songs send their
program changes and controller 0x67 at tick 0, so this does not matter for them.

### 3.2 Delta times and batches — V

- **VLQ** (f:0B44): `v = 0; do { b = next(); v += b & 0x7F (32-bit); if (b & 0x80) v <<= 7; } while (b & 0x80)`. This is
  standard MIDI VLQ.
- **processBatch** (f:0D0B), entered when the counter borrows:

```
age += 1                                          ; 16-bit, once per batch
normalise cur (seg += off >> 4; off &= 15)
loop:
  b = byte at cur
  if b & 0x80: cur++; chan = b & 0x0F; type = (b >> 4) - 8     ; otherwise running status (also for F0–FF)
  handler[type]()                                 ; 8-entry word table at f:233; reads its own data bytes
  if state == 0:                                  ; the event stopped the song (FF 2F or FC)
     if loopCount != 0: play(start) again; if loopCount != 0xFFFF: loopCount--   ; never in this game
     return
  d = readVLQ()
  if d == 0: goto loop
  counter32 = d - 1
```

- Timing results:
  - The first batch runs on driver call `firstDelta + 1` after play. All songs have firstDelta = 0, so that is call 1.
  - Each later event runs exactly `delta` driver calls after the previous batch.
  - An event at song time t runs on driver call t + 1.

### 3.3 Event handlers — V

| Status | Handler f: | Action |
| --- | --- | --- |
| 8x | 0D9F | note off (key, velocity) (§4.4) |
| 9x | 0E16 | note on. Velocity 0 means note off (§4.3) |
| Ax | 1049 | skip 2 data bytes |
| Bx | 0FB6 | controller: read (c, v). Only 0x66–0x69 act, through the 4-word table at f:243. All others (0x00, 0x0A, 0x07, 0x40, …) are ignored |
| Cx | 104C | program change (§4.5) |
| Dx | 104A | skip 1 data byte |
| Ex | 1049 | **pitch bend ignored** (skip 2) |
| Fx | 10C6 | sub-dispatch on the low nibble through the 16-word table at f:24B |

Controllers:

- **0x66 marker** (f:0FCC): `*status = v` (far write). This is the loop marker (§2.5).
- **0x67 rhythm mode** (f:0FD2):
  - voice reset (§4.1), which also resets every channel's program to 0;
  - f:1F1 = v;
  - if v ≠ 0: f:1F0 = 0xE0 and f:044 (low byte) = 6;
  - otherwise: f:1F0 = 0xC0 and f:044 = 9;
  - OPL[0xBD] ← f:1F0.
- **0x68 / 0x69 pitch** (f:0FF8 / f:0FF6):
  - Set `s = sign8(v)` for 0x68, or `s = sign8((-v) & 0xFF)` for 0x69.
  - `pitchOfs[chan] = s >> 2` (arithmetic shift, so it floors: 0x69 with v=1 gives −1). The value is *set*, not added.
  - Then, for every voice < f:044 with `owner == chan` (active voices only), recompute the frequency from the stored note
    code (§4.6) and write A0, then B0 with the key-on bit set.

System events (low nibble):

| Event | Action |
| --- | --- |
| F0 | store the position, call the trap if set, then `len = readVLQ()` and skip `len` bytes (32-bit: offset carry adds 0x1000 to the segment, and the high word adds `(hi & 0xFF) << 12`) |
| F7 | same as F0 without the trap |
| F2 | skip 2 |
| F3 | skip 1 |
| F1, F4–F6, F8–FB, FD, FE | nothing |
| **FC** | stop (§3.4) |
| **FF** | meta: `t = next byte`. If t == 0x2F, stop. Then `len = readVLQ()` and skip len bytes in every case |

### 3.4 Stop and all-notes-off — V

- **stop** (f:125C): if the state ≠ 0, then:
  - state = 0;
  - setPIT(f:03A), so f:03E = 0x438C;
  - all-notes-off;
  - `*status = 0`.
- **all-notes-off** (f:0994):

```
for v = voices-1 downto 0:
   OPL[0x83] ← 0x13            ; BUG: meant 0x83+v. Always hits voice 0's carrier SR (sustain 1, release 3)
   if owner[v] <= 0x7F: OPL[A0+v] ← fnum[v] lo; OPL[B0+v] ← fnum[v] hi   (key-on bit clear)
f:1F0 &= 0xE0; OPL[0xBD] ← f:1F0
```

- The owner bytes are not marked released.
- The 0x83 write lands before voice 0's key-off, so voice 0's release at every stop and loop uses SR=0x13 until its
  instrument is next loaded.

## 4. OPL2 mapping

**OPL write** (f:096E) — V: AH = register, AL = value. Output order: index, delay loop `[f:036]` (NOP/DEC), data to
port+1, delay loop `[f:038]`. The port must preserve the order of writes; the delays are not needed.

**V** No code path writes OPL register 0x01 or the timer registers 0x02–0x04 on purpose. The waveform-select enable bit
(reg 1 bit 5) is therefore never set by the driver, although the songs' instruments use waveforms 1–3 (for example
INTEX instrument 2 has E0=3, E3=2). **U**: whether AVM_SB.DAT or the BIOS sets reg 1. On a real OPL2 with bit 5 clear,
every operator plays a sine wave. Check DOSBox's OPL state before deciding.

### 4.1 Voice reset (f:09D8) — V

```
program[0..15] = 0                     ; f:1F3
owner[0..10] = 0xFF
for v = 0..8:
   OPL[0xBD] ← 0xC0;  OPL[0x08] ← 0x00             ; rewritten on every iteration
   op = opOff[v]                                   ; f:1C7
   read 11 bytes D from f:1D0 in order:
   OPL[20+op]←D0; OPL[23+op]←D1; OPL[40+op]←D2; OPL[43+op]←D3; OPL[60+op]←D4; OPL[63+op]←D5;
   OPL[80+op]←D6; OPL[83+op]←D7; OPL[E0+op]←D8; OPL[E3+op]←D9;
   OPL[op + v] ← D10                               ; BUG: not C0+v
```

- The last write goes to registers 00, 02, 04, 0B, 0D, 0F, 16, 18, 1A, so **C0–C8 are not initialised**.
- Nothing is keyed off, and the shadow f:1F0 is not changed.
- This runs on fn 2 (every song start), fn 8 and controller 0x67.

### 4.2 Mode reset (f:0C25) — V

f:044 = 9, then a word write f:1F0 = 0x00C0 (so the rhythm flag f:1F1 becomes 0), then OPL[0xBD] ← 0xC0. This runs on
fn 2, fn 6 and fn 8.

### 4.3 Note on (f:0E16) — V

```
key = d1, vel = d2;  if vel == 0 → note off
if enable[chan] == 0: return                       ; f:223
if rhythmFlag and chan >= 11: percussionOn(); return
v = allocVoice(chan)                               ; §4.7
old = owner[v]; owner[v] = chan
if (old & 0x7F) != chan: loadInstrument(program[chan], v)      ; §4.5
i = (vel >> 3) + ((vel >> 2) & 1)                  ; 0..16
add = int16 at f:915 + 2*i                         ; 16 signed words, index 0..15
                                                   ; index 16 (vel 124–127) reads f:935, a code word = 0x1E9C (+7836)
x = sign8(vol[v]) + add;  x = clamp(x, 0, 63)      ; signed 16-bit compare
OPL[0x43 + opOff[v]] ← (63 - x) | ksl[v]           ; carrier TL only
noteFreq(v)                                        ; §4.6
OPL[A0+v] ← lo;  OPL[B0+v] ← hi | 0x20
```

- No key-off is written before a key-on on a reused or released voice. A stolen voice is keyed off inside allocVoice.
- Index 16 is common in practice (all 16 note-ons in INGAME, 29 in MONSTER, 74 in ALARMED). It gives full carrier volume
  (TL = KSL bits only).

**percussionOn** (f:0EBD), with p = chan − 5 (6–10):

```
f:1F0 |= bdBit[p]                                  ; f:1E0 + (p-6)
x = zeroext(vol[p]) + add(i as above); clamp 0..63
reg = 0x40 + percOp[p] (+3 if p == 6, the bass drum carrier)    ; f:1DB + (p-6)
OPL[reg] ← (63 - x) | ksl[p]
noteFreq(p)                                        ; pitch uses pitchOfs[chan]
OPL[A0 + percVoice[p]] ← lo;  OPL[B0 + percVoice[p]] ← hi         ; NO key-on bit; f:1E5 + (p-6)
OPL[0xBD] ← f:1F0
```

- A repeated hit without a note-off between hits sets an already-set bit, so it does not retrigger.
- SD/HH share voice 7 and TOM/CYM share voice 8, so their frequencies overwrite each other.

### 4.4 Note off (f:0D9F) — V

```
if voices(f:044) <= 6 and chan >= 11:                         ; rhythm
   f:1F0 &= ~bdBit[chan]; OPL[0xBD] ← f:1F0; return
for v in 0..voices-1, the first v with key[v] == d1 (raw key) and owner[v] == chan:
   owner[v] |= 0x80; OPL[A0+v] ← fnum[v] lo; OPL[B0+v] ← fnum[v] hi; return
```

Only the **first** matching voice is released. If a channel has the same key sounding twice, one note-off releases one of
them.

### 4.5 Program change and instrument load — V

- **Program change** (f:104C):
  - `p = d1; while p >= count: p -= count` (unsigned; count 0 would hang); program[chan] = p.
  - In rhythm mode with chan ≥ 11: loadInstrument(p, chan − 5).
  - Otherwise: every voice with owner == chan|0x80 becomes free (0xFF), and every voice with owner == chan (active) is
    reloaded immediately while it sounds.
- **loadInstrument(p, v)** (f:0A4C): if p ≥ count, do nothing. The record R is 16 bytes at far `[f:01A] + 16p`, in CMF
  instrument layout.

```
lvl = R3;  if rhythmFlag and v >= 7: lvl = R2
ksl[v] = lvl & 0xC0;  base[v] = vol[v] = 63 - (lvl & 0x3F)
if not (rhythmFlag and v > 6):                     ; two-operator voice (also the bass drum, v = 6)
   op = opOff[v]
   OPL[20+op]←R0; OPL[23+op]←R1; OPL[40+op]←R2;   (R3 is not written; carrier TL comes at note-on)
   OPL[60+op]←R4; OPL[63+op]←R5; OPL[80+op]←R6; OPL[83+op]←R7; OPL[E0+op]←R8; OPL[E3+op]←R9
   OPL[C0+v]←R10
else:                                              ; single-operator percussion 7..10
   op = percOp[v]
   OPL[20+op]←R0; OPL[60+op]←R4; OPL[80+op]←R6; OPL[E0+op]←R8
   OPL[C0+percVoice[v]]←R10                        ; level written at note-on
```

### 4.6 Frequency (f:0F31, f:0F5A) — V

```
key[v] = d1
n = clamp(sign8(d1) + transpose(f:04C, int16), 0, 127)
code = byte at f:295 + n           ; 128 bytes: (block << 4) | semitone; octaves 0 and 7 are duplicated and 120..127 saturate — read it
noteCode[v] = code
blk4 = (code & 0x70) >> 2          ; block already shifted to B0 bits 2–4
idx = (code & 0x0F) * 64 + pitchOfs[chan]          ; int16
if idx < 0:      idx += 0x300; blk4 -= 4; if blk4 < 0: blk4 = 0, idx = 0
elif idx >= 0x300: idx -= 0x300; blk4 += 4; if blk4 > 0x1C: idx = 0x2FF, blk4 = 0x1C
w = uint16 at f:315 + 2*idx        ; 768 LE words, 64 steps per semitone, 10-bit F-numbers for one octave
fnum[v] = w | (blk4 << 8);  stamp[v] = age
```

- A0 ← low byte, B0 ← high byte (bits 0–1 = F-number high bits, bits 2–4 = block). Note-on ORs 0x20 into B0.
- The block derivation and the octave-0 duplication come from the f:295 table, so read the table rather than computing
  them.

### 4.7 Voice allocation (f:0BA5) — V

All searches cover voices 0 to f:044 − 1 in ascending order.

1. If some owner == chan|0x80 (a voice this channel released), take the first one.
2. Else if some owner == 0xFF, take the first one.
3. Else if some owner > 0x7F (released by another channel), take the first one.
4. Otherwise steal:
   - For each voice compute `d = (age - stamp[v]) & 0xFFFF`.
   - Take the voice with the largest unsigned d. Ties keep the lower index, and if every d is 0 the result is voice 0.
   - Key the stolen voice off with A0 ← fnum lo, B0 ← fnum hi.

`age` counts batches, not ticks.

## 5. Integer subtleties (checklist)

- The delay counter is 32-bit with borrow detection, and the first delta is not reduced by 1 (§3.2).
- VLQ values and the F0/F7/FF skip lengths are 32-bit.
- The chain accumulator is 16-bit with carry, and repeated chaining uses a strict `>` (§2.2).
- The velocity index reaches 16 and reads code bytes (§4.3). The volume sum is a signed 16-bit value clamped to 0–63.
- 0x69 pitch uses an 8-bit negation followed by an arithmetic `>> 2` (floors). Offsets are set, not added, and the octave
  wraps once with block clamps (§4.6).
- Program numbers are reduced modulo the count by repeated subtraction.
- Voice age is compared as a wrapped unsigned 16-bit value.
- Quirks to keep: reg 0x83 ← 0x13 at every stop, the reset writes D10 to `op+v` instead of C0+v, percussion has no key-on
  bit, and controller 0x67 resets all programs.
- The loop is driven by controller 0x66 = 0 together with the game's restart (fn 7 then fn 6) inside the same IRQ (§2.5).
  FF 2F is never reached in these songs.

## 6. Open questions

- **U** The share of IRQs that tick the music in-game (§2.3) and the title loop's equivalent. Measure it in DOSBox.
- **U** Whether OPL reg 1 bit 5 (waveform enable) is ever set (§4).
- **I** That f:012 holds the BIOS vector and not `7872` (the init order).
