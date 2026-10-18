# Intex terminals and the map screen

Spec for a bit-exact JavaScript port of the Intex computer system (terminal cell, menu, shops, information screens,
return to play) and of the map screen opened with **M**. The original bytes are not reproduced here: every text,
price, picture and table is named by address, size and type, and the port reads it from the user's `ALIEN.EXE` and
asset files at runtime.

**Addresses.** Ghidra addresses in program `ALIEN.EXE`: `1000:XXXX` is the main code segment (`cs:XXXX` means the
same segment as data), `2041:XXXX` (or `[XXXX]`) is DS. Live = Ghidra − 0x0E0B for the segment. `3B1B:XXXX` is a
relocated segment near the end of the image (live 2D10). **V** = Verified (read in the disassembly at the given
address). **I** = Inferred. **U** = Unknown. Player records: player 1 at `2041:BE1C`, player 2 at `2041:BE88`; `+NN`
is a byte offset into the record. Input bits (the word an input pointer points at): 1 right, 2 left, 4 down, 8 up,
0x10 fire, 0x20 action (as `INPUT` in `src/game/sim.js`).

## 0. Overview

```
frame N (1000:37D6) ── player update 5B44: action held and +40 == 0xFFFF ──► [B45E]=0xFF, cs:2B13=player,
                                                                             [817E]=[817C], sound 0
main loop 34E6 ── 35E0: [B45E]==0xFF ──► [B45E]=0, 21A6 (player save), 2588 (Intex session) ──► 35F2 (loop goes on)

2588  set-up: stop music, fade out, COMPUTER.VHF on both pages, WEAPONCL.EHF sheet, INTEX.CMF, fade in, sound 6
2670  boot text (typewriter), up to 250 passes or fire/action
26C3  main menu loop, 8 items (cs:137C 0..7):
        0 weapon shop 2940    1 tool shop 2F9C     2 radar map 328C     3 mission text 31AB
        4 "inaccessible" text 285B   5 statistics 2B16   6 info pages 2D9A   7 leave → 28B3
28B3  exit: fade out, stop music, restore display/HUD/tiles, 2 game frames, fade in to the game palette,
      in-game music restarted, return
```

- **V** The level is **resumed, not re-initialised**: `2588` is a near call from the main loop and returns to `35F2`,
  which falls through to the next pass `JMP 34E6`. No level loader (`1937`) and no restore of the save (`1E15`) runs.
- **V** All purchases write the live player record. Nothing written by `21A6` is read back on the way out (§8).

## 1. Entry

### 1.1 Trigger — V

- `1000:61BB` (probe effects, already ported as `probeEffects`): cell code 0x17 sets word `+40` = 0xFFFF. The player
  update clears `+40` to 0 every frame before its probes (as `onIntex` in `sim.js`; not re-read for this spec), so the
  flag tested is the one left by the previous frame's probes.
- `1000:5BD6`–`5BFC`, inside the player update `5B44`, right after the fire handling and before the direction table
  lookup at `5BFC`:

```
if (word [B423] & 0x20) and word +40 == 0xFFFF:      ; [B423] = this player's input word for the frame
    byte [B45E] = 0xFF
    word [817E] = word [817C]                          ; pointer to this player's input word (see 1.2)
    word cs:[2B13] = SI                                ; the player record
    sound 0                                            ; 1000:72B0, AX = 0
```

- The rest of the frame (other player, aliens, drawing, frame end) completes normally.
- **V** Main loop `1000:35E0`–`35EF`, after `37D6` and the level-over tests (exit `[B427]`, nobody alive `[B09A]=0`,
  end sequence `[92F2] >= 0x8C`, each of which leaves the loop first): if byte `[B45E]` == 0xFF it is cleared, `21A6`
  is called, then `2588`.
- **V** Two players: `5B44` runs for player 1 (`3908`) then player 2 (`39D8`). If both trigger in the same frame, the
  second write wins: player 2 owns the session (`cs:2B13`, `[817E]`) and sound 0 is requested twice.
- **V** `[817C]` is set before each `5B44` call to the player's input pointer (`[B092]` at `3913`, `[B094]` at `39E3`;
  these point to `2041:B428` keyboard, `B42A` or `B42C` joysticks per SETUP.DAT, `1000:1779`–`17AA`). In demo playback
  it points into the demo buffer at the current frame (`39A4`).
- **I** In demo playback the Intex would read a frozen word from the demo buffer. The attract demo never opens a
  terminal (the port replays it to the end), so this case is not needed.

### 1.2 Input inside the Intex and the map — V

- Every read is `BX = [817E]; BX = word [BX]`, the live input word of the owning player only. The other player has no
  input and is frozen (no game frames run).
- Many reads also store the word in `[B423]`; some do not (noted per screen). Decisions later in the same pass often
  test the stale `[B423]`.
- **Edge detection** is by busy-waiting: `wait release of bit b` = loop `while (word [[817E]] & b)`. No page flip, no
  drawing, no sound happens inside these loops (INT 8 and music continue). `1000:319E` is the shared "wait until fire
  (0x10) is released". There is no key repeat anywhere: one action per press, applied after release.
- Keyboard scancodes in `[B086]` are seen only by the main-menu cheat matcher (§5.3).

## 2. Session set-up, 1000:2588–266C — V

In order:

1. DS = 2041. `cs:[37D3]` = 0xFF (freezes the self-destruct countdown in INT 8, §9.2).
2. `2261`: stop music (FM: `cs:[0F0C]`=0, INT 80h fn 7, which also sets the PIT to 0x438C, 69 Hz; see
   [avmfm.md](avmfm.md)).
3. `D779` fade out (§3.5).
4. Push `[B432]` (camera x) and `[B43E]` (CRTC fine offset); set both to 0. Text and sprite blitters add
   `[B432] & 0xF` / `[B43E]`, so all Intex drawing is unshifted.
5. `3000:02A7`: after a retrace, CRTC line compare = 0x190 and offset = 0x2A (84-byte rows). Same call as the title
   and intermission (`0841`, `411C`, `44FE`). **I** Full-screen 336-pixel-wide pages, no split-screen panel.
6. Load COMPUTER.VHF (file record `2041:9AF2`, name at `9AFA`) with `D076` into `[B411]:0000` (open, `FF85` with
   AX = 1, close; **I** `FF85` is the LZHUF decoder, giving 320×200 pixels + the 768-byte palette at `+FA00`).
7. Picture → page `[B014]` (`D924`: planar copy, 80 bytes per plane row, row stride 84), flip (`767D`), picture → the
   other page, flip.
8. `D9C2` (VGA write-mode-1 latch copy of 0x41A0 bytes) from page `[B014]` to the background buffer at VGA offset
   0x8340. Pages are 0x41A0 bytes (84×200): `[B014]`/`[B016]` hold 0 and 0x41A0 (set at `0752`), swapped by every flip.
9. Copy 768 palette bytes `[B411]:FA00` → `2041:B0F9`.
10. Load WEAPONCL.EHF (record `2041:9A77`) to `[B411]:8000`; `666C` converts the 4 bit planes to 4-bit packed pixels
    (160 bytes per row, the format `src/game/sprites.js` uses); copy 0x3E80 words `[B411]:8000` → `[B411]:0000`.
    The weapon pictures are sprite descriptors 0xCD–0xD2 (§3.4) whose sheet variable is `[B411]`.
11. `24C0`: start INTEX.CMF (record `2041:AF4F`): fn 2, fn 4 with `0x1234DC / hdr[0Ch]` (96 Hz), `cs:[0F0C]`=0xFF
    (loop), fn 6.
12. `D863` fade in to `B0F9` (§3.5).
13. Sound 6.
14. Text state: opaque `cs:[1126]` = 0, line height `cs:[1124]` = 0x0D, typewriter `cs:[13B0]` = 0xFF.

## 3. Shared machinery

### 3.1 Page model — V

- Draw page = `[B014]`, shown page = `[B016]`. `1000:767D` (flip): CRTC start = `[B014] + [B43E]`, wait until not
  in retrace then until retrace starts, pel panning = `([B432] & 3) << 1`, then swap `[B014]`/`[B016]`. One flip =
  one 70 Hz retrace.
- `1000:2576` = **restore**: latch-copy the clean background (VGA 0x8340) to the draw page. Almost every screen pass
  is `restore; draw; flip`. "restore+flip ×2" below means `2576, 767D, 2576, 767D` (both pages clean).
- Port model: two 336×200 indexed pages plus one background page; the displayed image is columns 0–319.

### 3.2 Text, 1000:13B2 — V

Record (pointed to by ES:SI): word x, word y, then a byte stream:

| byte | meaning |
| --- | --- |
| 0xFF | end |
| 0xFE c | colour `cs:[1121]` = c |
| 0xFD w | space width `cs:[2E8C]` = w (word, high byte 0) |
| 0x00 | new line: x = line start x, y += `cs:[1124]` |
| 0x20 | transparent mode: x += `cs:[2E8C]`, or 9 if it is 0; nothing drawn, no typewriter step. Opaque mode: draw glyph 0x2A |
| other | glyph (below), then x += 9 |

- State kept in `cs` between calls: x `cs:1119`, line start `cs:1122`, y `cs:111B`, colour `1121`, line height
  `1124`, opaque `1126`, space width `2E8C`. Texts that start without a colour code use the colour left by the
  previous text (checked: `2041:7E92`, `7D07`, `7B69` have none). The port must carry these exactly.
- Glyph index: `A`–`Z` → 0–25, `,` → 26, `0`–`9` → 27–36, `.` 37, `!` 38, `?` 39, `:` 40, `$` 41; any other byte is
  used as the index unchanged. The range tests are **signed** byte compares (`JL`/`JG`), so bytes ≥ 0x80 fall through
  to "unchanged". Glyphs are 8×11, 88 bytes each (8 bytes per row) at `[BD65]:g·88`, cut from FONT.VHF at
  `0787`–`0826` (`cutFont` in `src/game/screens.js`).
- `151A` (transparent, `cs:[1126]` = 0): non-zero font bytes are written as colour `cs:[1121]`, zero bytes skipped.
  `1629` (opaque, `1126` ≠ 0): zero bytes are written as colour 0. Both write to the draw page `[B014]`, row stride 84,
  no clipping. The Intex and the map always use transparent mode (`1126` = 0 at `265A`, `3455` and every sub-screen
  exit); opaque mode is used by the title (`0B97`).
- **Typewriter** (`149A`–`150C`), when `cs:[13B0]` ≠ 0 and the character is not a space: after drawing the glyph on
  `[B014]`, draw it again on `[B016]` (by temporarily setting `[B014]` = `[B016]`), flip (`767D`), sound 0x18, then:
  if `cs:[1517] & 0x10` (fire in the previous sample) and the live word `[[817E]] & 0x10` is now clear → `13B0` = 0
  (the rest of the text, and later texts, print at once). Finally `cs:[1517]` = live word `[[817E]]`. `cs:1517`
  persists across texts and sessions (image value read at runtime). So one character per retrace, and a fire
  **release** skips.
- Each screen sets `13B0` = 0xFF on entry and clears it after its first draw, so a screen types out once, then
  redraws instantly every pass.

### 3.3 Selection markers and colour cycling — V

- INT 8 increments `cs:[13AD]` and sets `cs:[13AF]` = `cs:[138D + ((13AD & 0x3F) >> 1)]` (32-byte table, `78C6`–`78DA`)
  on every tick that is not inside a file load (§9.1). Colours `0xF0 + cs:[13AF]` are used for the animated cursors.
- Markers are bytes poked into text records before or after drawing: `0x24` (`$`, glyph 41) for the selected line,
  `0x20` (space, not drawn) otherwise.

### 3.4 Sprites, 1000:D0E6 — V

AX = descriptor number n (0 → return), BX = x, CX = y, DX bit 0 = mirror. Descriptor = 16 bytes at
`2041:9E47 + (n−1)·16`, the same layout as `frameDescriptor` in `src/game/sprites.js`. x += descriptor `+8` (minus
when mirrored), y += `+A`, x += `[B432] & 0xF` (0 here). Clipped to rows 0–199 (`D15F`–`D1A4`) and horizontally against `[B432]&0xF` and
`+0x140` in 4-pixel steps (`D1A5`–`D27B`; never reached by the weapon pictures, **I**). Pixels are 4-bit (high nibble first) at `sheet + sourceY·160 + (sourceX>>2)·2 + [9E41 + 2·slot]`, sheet
segment = word at the descriptor's `+E` pointer; non-zero pixels are written as `pixel | (bank << 4)` to the draw
page. Weapon descriptors 0xCD–0xD2 (`2041:AB07`–`AB66`) use slot 0, bank 0 and sheet variable `[B411]`.

### 3.5 Palette fades — V

- `D779` → `D7D8` (fade out): one retrace wait, read the 256 DAC entries into `2041:BA5F`, then 64 steps of
  (retrace wait; every component with `value & 0x3F` ≠ 0 decrements). Already ported as `fadeOut`.
- `D863` → `D867` (fade in to the 768 bytes at DS:SI): one retrace wait, read the DAC into `BA5F`, 64 steps of
  (retrace wait; per component signed compare target vs stored, ±1). Output quirk already ported as `fadeIn`: the red
  value written to the DAC also receives the green and blue steps, green and blue are output from before their step.
- **V** Read quirk in `D867`: the DAC read loop writes `BL` to port 3C7 on every entry without incrementing it, so all
  256 stored entries are copies of entry `BL`. **I** Harmless here: every fade-in in this spec follows a complete fade
  out, so the DAC is all zero and the start state is black either way.

### 3.6 Sounds — V

Through `1000:72B0` (AX = id; priority rules in [evidence.md](evidence.md)): 0 on activation (`5BF9`) and for two cheat
confirmations (`7FCA`); 6 after the set-up fade-in (`2657`); 0x18 per typewriter character (`14DA`); 1 for some cheat
words (`8020`). Purchases, menu moves and the map have **no** sound.

## 4. Boot text, 1000:266D–26A7 — V

```
repeat up to 250 (0xFA) times:
    cs:[128A] = 0xF0 + cs:[13AF]            ; colour byte of the cursor at the end of text cs:11BA
    draw text cs:11BA (ES = CS); flip
    13B0 = 0                                ; so only the first pass types out
    [B423] = live word; if [B423] & 0x30: wait fire release (319E); break
```

- No restore between passes: the text is redrawn over itself on alternating pages (only the cursor colour changes).
- Then restore+flip ×2, line height 0x10, `13B0` = 0xFF.

## 5. Main menu, 1000:26C3–28B0

### 5.1 One pass — V

1. restore.
2. `7DF2` cheat matcher (§5.3).
3. For the 8 word pointers at `cs:137D` (into the menu text `cs:128E`): byte at pointer = 0xF0 (colour), next byte =
   0x20. For the selected index `cs:[137C]`: colour 0xF0 + `cs:[13AF]`, character 0x24.
4. Draw `cs:128E` (types out on the first pass after entry or after returning from an item, since every item exit sets
   `13B0` = 0xFF); `13B0` = 0.
5. If word `cs:[118D]` ≠ 0: decrement, draw the message record `cs:118F` (36 text bytes at `cs:1195`).
6. Flip.
7. Read live → `[B423]`; if bit 8 (up): wait release (storing each read in `[B423]`), `137C` = (`137C` − 1) & 7.
8. Read live → `[B423]`; if bit 4 (down): wait release, `137C` = (`137C` + 1) & 7.
9. Item checks in this order: 0, 1, 2, 3, 5, 6, 4, 7. Each: `if 137C == k`, read live → `[B423]`, `if & 0x30`
   (fire or action) → run item k. Items 0–6 first wait for fire release (`319E`; an action-only press does not wait).
10. Item 7 with fire or action → exit (§8) **without** waiting for release. Otherwise back to step 1.

- `cs:[137C]` is not reset on entry: the cursor starts where the previous session left it (image value at first use).
- **I** Because the checks after an item re-read the input and use a different index, an item runs at most once per
  pass; holding the button re-enters it on the next pass after it returns.

### 5.2 Items — V

| k | routine | summary |
| --- | --- | --- |
| 0 | `2940` | weapon shop (§6.1) |
| 1 | `2F9C` | tool shop (§6.2) |
| 2 | `328C` | radar map (§7.1), then restore+flip ×2 |
| 3 | `31AB` | mission objective text (§6.4) |
| 4 | `285B` | loop { restore; draw `2041:7B69` (no typewriter: `13B0` is 0); flip; read → `[B423]` } until `& 0x30`; wait release of 0x30; restore+flip ×2. No state change |
| 5 | `2B16` | statistics (§6.3) |
| 6 | `2D9A` | info pages (§6.5) |
| 7 | `28B3` | leave (§8) |

### 5.3 Cheat and level-code matcher, 1000:7DF2 — V

Called once per main-menu pass (its only caller, `26C6`).

```
AX = word [B086]                               ; last INT 9 scancode
if AX & 0x80: return                           ; break codes are left alone
[B086] = 0                                     ; every make code is consumed, matched or not
look AL&0x7F up in the byte-pair table 2041:818C {scancode, ASCII}, 0xFF-terminated (letters and space); none → return
cs:[7E74 + cs:[7E72]] = ASCII; cs:[7E72] = (cs:[7E72] + 1) & 0x7F          ; 128-byte ring
for each entry {word string, word handler} at cs:7EF4 until string == 0xFFFF:
    for start = 127 down to 0:
        if the 0xFF-terminated string at cs:string equals ring[(start + j) & 0x7F] for all j:
            call handler; clear the ring (cs:7E74, 128 bytes) and cs:[7E72] = 0 (7FB4); return
```

- 47 entries. Handlers (all **V**):
  - `7FD1`: `cs:[7FD9]` = 0xFF (enables the `=`/`-` level keys of the main loop), sound 0.
  - `7FDA`: `cs:[7FE2]` = 0xFF (enables demo recording with R), sound 0.
  - `7FE3` / `7FEC`: player 1 / player 2 keys `+2C` = 0xFFFF.
  - `801B`, `8027`: nothing (the ring is still cleared). `801C`: jump to `7ABF`, the program exit. `8020`: sound 1.
  - `8028`–`8059` (step 7): `8000` with SI = a 36-byte text in `cs` → copied to `cs:1195`; `cs:[118D]` = 100, so the
    menu shows it for 100 passes.
  - `8060`–`8186` (15 handlers, step 0x15), strings `cs:82A6 + 10·k` (the intermission codes): `[B0B2]` = k+1
    (imm16 at handler+4), `[B427]` = 0xFF (exit taken), then `819B`: for **both** player records, credits
    `+5E`/`+60` = 0 and `5FDC` adds the BCD value CX:BX (imm16 at handler+0xF : handler+0xC).
- **I** After a level code the player still has to leave the Intex. The main loop then sees `[B427]` (`35B5`), saves
  (`21A6`) and the level sequence loads index `[B0B2]` + 1 (`1FEE`–`2011`): code k leads to level index k+2 with the
  set credits, overwriting the current level's progress. Player 2's credits are set even in a 1-player game.
- **I** The matcher sees at most one key per pass (one retrace); a second key within the same pass is lost. Keyboard
  typematic repeats arrive as further make codes.

## 6. Shop and information screens

Common exit sequence ("leave screen"), **V** at `2AEA`, `2CDA`, `2E5C`, `311B`: wait fire release, restore+flip ×2,
colour `cs:[1121]` = 0xFD, opaque 0, line height 0x0D, `13B0` = 0xFF, return to the menu. `31AB` ends slightly
differently (§6.4).

Digit formatting used below, **V**: "BCD n bytes at +o to DS:d" = for i in 0..n−1, byte b = `[player + o + i]`:
`[d − 2i]` = `'0' + (b & 0xF)`, `[d − 2i − 1]` = `'0' + (b >> 4)` (rightmost digit at d).

### 6.1 Weapon shop, 1000:2940–2B12 — V

State: weapon index `cs:[3242]` (word, 0–5, **not** reset: persists across visits and sessions); choice `cs:[2B15]`
(byte, 0 = NO, 1 = YES; set 0 on entry). Line height 0x0C, `13B0` = 0xFF on entry.

Pass (`295F`):

1. restore.
2. BCD 4 bytes at `+5E` to `2041:7F18` (credits, 8 digits).
3. Draw `2041:7E92` (header, purchase prompt, credits); `13B0` = 0.
4. i = `cs:[3242]`: draw text record at word `cs:[3262 + 8i]` (DS); sprite `cs:[325C + 8i]` at x `cs:[325E + 8i]`,
   y `cs:[3260 + 8i]`, DX = 0 (§3.4).
5. Flip.
6. Read live → `[B423]`. The following use the stored `[B423]`; their release waits do not update it:
   - bit 1 (right): wait release; i += 1; if i ≥ 6 (signed) → 0.
   - bit 2 (left): wait release; i −= 1; if i < 0 (signed) → 5.
   - bit 8 (up): wait release; `2B15` = (`2B15` + 1) & 1. bit 4 (down): wait release; `2B15` = (`2B15` − 1) & 1.
7. Markers: `2041:7EE5` (next to YES) = 0x24 if `2B15` = 1 else 0x20; `2041:7F08` (next to NO) = the other. Written
   **after** the draw, so they show from the next pass; the first pass of a visit shows the markers left by the
   previous visit (image values the first time).
8. If `[B423] & 0x10` (fire):
   - `2B15` = 0 → leave screen.
   - weapon bit w = `1 << (i+1)`; if `+3E & w` (already owned) → next pass (no charge, no sound).
   - price = BCD dword CX:BX with BX = `cs:[3244 + 4i]`, CX = `cs:[3246 + 4i]`; `3164` (§9.3): if credits < price →
     next pass.
   - `6001`: credits −= price. `+5A` = i + 2 (the new weapon is selected), `+3E |= w`, word `+42` += 0x80 (16-bit
     wrap). Leave screen.
- **I** While fire is held on a refused purchase the check repeats every pass with no effect.
- Shop index i sells weapon i+2 (weapons 2–7); weapon 1 is never sold.

### 6.2 Tool shop, 1000:2F9C–3143 — V

State: selection `cs:[2B15]` (byte, set 0 on entry; 0–4 items, 5 = exit). Line height 0x10, `13B0` = 0xFF on entry.

Pass (`2FBB`):

1. restore; BCD 4 bytes at `+5E` to `2041:7D01`; draw `2041:7C04`; `13B0` = 0; flip.
2. Read live → `[B423]`; bit 4 (down): wait release, `2B15` += 1, if > 5 (signed byte) → 0. bit 8 (up): wait release,
   `2B15` −= 1, if < 0 (signed byte) → 5.
3. Markers: the six bytes at the word pointers `cs:3158 + 2k` (DS) = 0x20, then the selected one = 0x24 (after the
   draw: visible next pass, stale on the first pass of a visit).
4. If `[B423] & 0x10`: selection 5 → leave screen. Otherwise wait fire release **first**, then price CX:BX with
   BX = `cs:[3144 + 4s]`, CX = `cs:[3146 + 4s]`; `3164`: insufficient → next pass. Else `6001` (subtract) and:

| s | effect |
| --- | --- |
| 0 | `+62 |= 1` (map owned; charged again if already owned) |
| 1 | word `+42` += 0x80 |
| 2 | word `+2E` = 0x40 (energy set, not added) |
| 3 | word `+2C` += 6 |
| 4 | **word** `+5B` += 1 (`INC word`: a carry out of the lives byte reaches `+5C`) |

   then the next pass (the screen stays open; no cap on any purchase).

### 6.3 Statistics, 1000:2B16–2D02 — V

Line height 0x0C, `13B0` = 0xFF on entry. Pass (`2B35`):

1. restore.
2. Clips: AX = word `+42` >> 7. If AX = 0: `[7DB7]` = `'0'` (`[7DB6]` keeps its previous content). Otherwise DX = AX
   div 10, AX = AX mod 10 (repeated subtraction, signed `JL`); `[7DB6]` = `'0'` + AX, `[7DB7]` = `'0'` + DX. The
   units digit is written **before** the tens digit (e.g. 12 clips shows "21", 5 shows "50"), and tens ≥ 10 produce
   characters past `'9'`.
3. BCD 4 bytes at `+5E` to `7D7D` (credits); 2 bytes at `+63` to `7D5A` (shots); 2 bytes at `+65` to `7D3E` (kills);
   2 bytes at `+67` to `7D9B` (doors). The overlapping tallies are as in [evidence.md](evidence.md).
4. Energy word `+2E` (signed): ≥ 0x2A → 7 bytes from `cs:2D73`, ≥ 0x15 → `cs:2D7A`, else `cs:2D81`, copied to `7DD1`.
5. Weapon name: 13 bytes from `cs:2D03 + 16·((byte +5A − 1) & 0xFF)` to `7DEA`.
6. For bit k = 0..5 of `+3E`: 3 bytes from `cs:2D88` (set) or `cs:2D8B` (clear) to the address in word `cs:[2D8E + 2k]`.
   Bit 6 (weapon 7) is never shown. **I** The six labels in the text are not in weapon order, so the last two lines
   show the bits of weapons 5 and 6 under other weapons' names.
7. Draw `2041:7D07`; `13B0` = 0; flip.
8. Live word & 0x10 → leave screen; otherwise next pass.

### 6.4 Mission objective, 1000:31AB–3241 — V

Restore+flip ×2, colour 0xFD, opaque 0, line height 0x0C, `13B0` = 0xFF. Pass: restore; index = 0x13 if `[B0B2]` = 0
and byte `[B427]` ≠ 0, else `[B0B2]`; draw the record at word `2041:[5BDE + 2·index]` (the intermission text table);
`13B0` = 0; flip; read → `[B423]`; until `& 0x10`. Then wait fire release (storing `[B423]`), line height 0x0D,
`13B0` = 0xFF, restore+flip ×2, return. (Colour stays 0xFD; nothing else reset.)

### 6.5 Info pages, 1000:2D9A–2E8B — V

On entry: restore+flip ×2, space width `cs:[2E8C]` = 6, page `cs:[2E8E]` = 0, line height 0x0C, `13B0` = 0xFF.
Pass (`2DC1`):

1. restore; draw the record at word `3B1B:[2·page]` (ES = 3B1B; 19 pages, the table ends with 0xFFFF at `3B1B:0026`).
2. Footer (ES = CS): page 0 → `cs:2E90`, page 0x12 → `cs:2F46`, else `cs:2EE7`. `13B0` = 0; flip. (The first pass
   types both page and footer; `2E8C` = 6 also narrows the footer's spaces; `0xFD` codes in a page change it.)
3. Read → `[B423]`. bit 1: wait release; if page < 0x12 (signed) page += 1. bit 2: wait release; if page > 0 page −= 1.
4. A fresh live read & 0x10 → leave screen, plus `2E8C` = 0.

## 7. Map

### 7.1 Map drawing, 1000:328C–3316 (Intex item 2 and the M screen) — V

```
restore, flip, restore, flip
3317 on the draw page, flip; 3317 on the other page, flip
3317: 333C(type 1, colour 0xFE); 333C(type 3, colour 0xF4)
333C: SI = 2041:0000 (cell type words, 120×96, written by the level initialiser)
      for row r 0..95, col c 0..119: if word [SI] != 0 and == type → 2×2 block at x = 0x28 + 2c, y = 3 + 2r
336E: 2×2 pixels at (BX, DX) on page [B014] (rows DX and DX+1, columns BX and BX+1)
loop:
    BX = (word +0) >> 3 + 0x25, DX = (word +2) >> 3        ; owning player's world x, y, logical shifts
    colour 0xF0 + cs:[13AF]; 2×2 blocks at (BX+2,DX), (BX,DX+2), (BX+2,DX+2), (BX,DX)   ; a 4×4 marker
    flip
    read → [B423]; until & 0x30
wait release of 0x30 (storing [B423]); 13B0 = 0xFF; return
```

- Only cells whose current type is exactly 1 or 3 are drawn. Cell types changed during play (opened doors, destroyed
  walls) show their current value.
- No restore inside the marker loop: the marker is redrawn on alternating pages; it does not move (the player is
  frozen).

### 7.2 M key screen, 1000:33C6–34E5 — V

Opened from the main loop (`35F2`–`3648`) when `[B086]` = 0x32 (M make code; it is cleared to 0 first) and the end
sequence `[92F2]` = 0: player 1 if `[B096]` ≠ 0 and `+62 & 1`, else player 2 if `[B098]` ≠ 0 and its `+62 & 1`.
`cs:[2B13]` = that record, `[817E]` = `[B092]` or `[B094]`. Player 1 has priority when both own the map. No sound.

Same as the Intex set-up and exit, except:

- The music is **not** stopped or changed (in-game music keeps playing at 120 Hz). No sound 6, no boot text, no menu.
- The background is ARMDISPL.VHF (record `2041:9A9D`); no WEAPONCL sheet; fade in to its palette (`B0F9`) right after
  the background is saved; then opaque 0, line height 0x10, `328C`.
- Exit (`3465`): fade out, pop `[B43E]`/`[B432]`, `209E`, `A316`, `A31A`, `2177`, `3000:0274`, `3000:01B0`, tile
  redraw, `37D6` ×2, fade in to `B45F`, `cs:[37D3]` = 0. No music call; `13B0` is left 0xFF from `328C`.

## 8. Leaving the Intex and resuming, 1000:28B3–293F — V

1. `D779` fade out (INTEX.CMF still playing).
2. `2261` stop music (PIT back to 69 Hz).
3. Pop `[B43E]`, `[B432]`.
4. `3000:0274`: the CRTC set-up also used at level start (`1CD0`; offset 0x2E = 92-byte rows).
5. `209E`: reload PANEL.VHF into `[B411]` and rebuild the HUD graphics (as `src/game/hud.js`, `20C3`–`2175`).
6. `A316`, `A31A`: redraw the HUD of player 1 and of player 2. **V** Both are called unconditionally (the per-frame
   `A2D9` checks `[B096]`/`[B098]` first). **U** Whether player 2's panel area shows anything in a 1-player game.
7. `2177`: reset six words in segment `18B2` (offsets 0, 2, 4, 0x326, 0x328, 0x32A). **U** their role (I: draw-list
   heads, as at level start `1C0A`).
8. `3000:01B0`: the game's frame end (CRTC start, retrace, pel panning, wait for `[8184]` ≠ 0, reset it, lag flag
   `[818A]` = (ticks ≥ 5), forced 0 in demo mode).
9. Redraw the tile window: for 15 rows from `[B434] >> 4` and 23 columns from `[B432] >> 4`, set `[B03C]`=`[B044]` =
   column, `[B040]`=`[B048]` = row, far call `2000:F3D7`.
10. `37D6` twice: two complete game frames (input, players, aliens, RNG, timers, drawing, frame end) while the
    palette is black.
11. `D863` fade in to the game palette `2041:B45F` (the palette as last built or transformed: red if the self-destruct
    palette was applied).
12. `2402`: start INGAME.CMF from its beginning (120 Hz), **unconditionally**.
13. `cs:[37D3]` = 0, `13B0` = 0; return to `35F2`.

What is kept and what is not:

- **V** `21A6` (called at entry) copies energy, lives, keys, ammo, weapon, owned weapons, credits, map flag and the
  tallies of both players to the carry area (`BDFF`–`BE19`, `7B51`–`7B67`). Nothing on the exit path reads it back.
  **I** The call has no effect on play: the carry area is rewritten by the next `21A6` before any level start reads it.
- **V** Changed by the Intex: the owning player's `+5E`–`+61` (credits), `+5A`, `+3E`, `+42`, `+62`, `+2E`, `+2C`,
  `+5B`/`+5C`; through cheats `+2C` of either player, both players' credits, `[B0B2]`, `[B427]`, `cs:7FD9`, `cs:7FE2`.
  Persisting Intex variables: `cs:137C`, `cs:3242`, `cs:1517`, `cs:118D`, the marker bytes in the DS texts, the cheat
  ring `cs:7E74`/`7E72`, the text state in `cs:1119`–`1126`, `2E8C`.
- **V** Not touched: map, objects, aliens, doors, camera (`[B432]`/`[B43E]` restored), RNG, frame counter `[AF84]`
  (until the two frames).
- **V** Music after the Intex is always in-game music: monster or alarmed music playing before the terminal is
  replaced (the M screen keeps it).
- **I** If action is still held when the Intex is left (item 7 does not wait for release) and the player still
  stands on the terminal, `+40` is 0xFFFF again from the last probes, so the Intex reopens: frame 1 of step 10 sets
  `[B45E]`, and the main loop enters `2588` again after its next frame. With fire held, the player shoots in those
  frames.

## 9. Timer, RNG and integer details

### 9.1 INT 8 during the Intex and the map — V (code), I (consequences)

The game's INT 8 (`1000:7872`) keeps running throughout. Per IRQ:

- Always: `[AF86]`++, `[8184]`++.
- If byte `[7B4A]` ≠ 0 (set by the file loaders `D01F` and `D076` while a file is read): skip everything below and
  chain/EOI. **V** This contradicts [avmfm.md](avmfm.md) §2.1 ("only ever written 0"): `D024` and `D085` write 0xFF.
- Every 4th tick (`[B425]`) when `cs:[3AEB]` = 0 and `cs:[7871]` = 0 (both 0 here): `782E` polls the joysticks into
  `[B42A]`/`[B42C]`. Then `[B42E]` = OR of the three input words; `13AD`/`13AF` (§3.3); `[B078]` 32-bit ++.
- `[AD4C]` += 0x334; on carry: `cs:[7969]` −= 1 (below 0 → 10); the self-destruct countdown (`[AF8A]`, `[AF8B]`, sounds
  0xB/0x16, `[92F2]`) is skipped while `cs:[37D3]` ≠ 0; `[7B4F]` −= 1 **still runs**.
- `796A` (music tick and loop restart) every IRQ, since `cs:[3AEB]` = 0.

Consequences for the port (**I**):

- The countdown is frozen in the Intex and on the M screen, but the level-10 timer `[7B4F]` (`levelTenTimer` in
  `sim.js`, checked at `37E3`) and the second phase `cs:7969`/`[AD4C]` advance by the time spent there, in PIT ticks:
  69 Hz during the entry fade and loads, 96 Hz while INTEX.CMF plays, 120 Hz on the M screen.
- `[8184]` is not reset during the session, so the frame end at step 8 of §8 sees a large count and sets the lag flag
  `[818A]` = 1 (unless in demo mode): the first frame after the Intex (step 10) moves with the fast movement table.
  The fade-in (64 retraces) also lands between two frame ends, so the first main-loop frame after the return ends with
  ticks ≥ 5 and the frame after it is again a lag frame. The port currently fixes the lag flag at 0 (STATUS.md).
- The music is never in a `cli` window during these loops except the short DAC writes inside the fades, so the Intex
  song advances on every IRQ (answers the open question in [avmfm.md](avmfm.md) §2.3 for the Intex).

### 9.2 RNG — V

No call to the random generator `1000:75B5` in `2588`–`2B12`, `2B16`–`336D`, `33C6`–`34E5`, `13B2`–`1628`, `7DF2`–
`81C7`. The only RNG use during a session is inside the two `37D6` frames at the exit. **I** `209E`, `A316`/`A31A` and
`2000:F3D7` were not traced for RNG calls (their in-game use suggests none).

### 9.3 BCD and integer subtleties — V

- Credits are 8 packed-BCD digits, little-endian bytes `+5E` (lowest two digits) to `+61`.
- `3164` (affordability): copies `+5E`/`+60` to `cs:319A`–`319D`, then `SUB/DAS`, `SBB/DAS`, `SBB/DAS` on bytes 0–2
  (stored back into the scratch copy) and a final `SBB AL, CH` **without** DAS; returns with CF = borrow. For valid
  BCD, CF = 1 exactly when credits < price. The player record is not changed.
- `6001` (subtract): the same chain on `+5E`–`+61` with `DAS` after every byte, stored. `5FDC` (add, used by the level
  codes) is the `ADD/DAA`, `ADC/DAA` chain.
- Signed compares: weapon index (`JL 6`, `JGE 0`), tool selection (byte `JLE 5`, `JGE 0`), info page (`JGE 0x12`,
  `JLE 0`), energy class (`JGE 0x2A`, `JGE 0x15`), glyph ranges (byte `JL`/`JG`), fade compare (byte `JL`).
- 8-bit wraps: menu index `& 7`, YES/NO `& 1`, weapon name index `(+5A − 1) & 0xFF`.
- 16-bit wraps: `+42` += 0x80, `+2C` += 6, word `+5B` += 1 (into `+5C`).

## 10. Tables and texts (addresses only)

| Address | Size / type | Content |
| --- | --- | --- |
| `cs:11BA` | text record | boot text; its cursor colour byte is `cs:128A` |
| `cs:128E` | text record | main menu, 8 lines |
| `cs:137D` | 8 words | pointers to the colour byte of each menu marker (the character follows) |
| `cs:138D` | 32 bytes | cursor colour phase per `(13AD & 0x3F) >> 1` |
| `cs:118D` / `cs:118F` / `cs:1195` | word / text record / 36 bytes | message counter, message record, message text |
| `2041:7E92` | text record | weapon shop page; credit digits end at `7F18`; markers `7EE5`, `7F08` |
| `cs:3244` | 6 × (word BX, word CX) | weapon prices, BCD CX:BX |
| `cs:325C` | 6 × 8 bytes | per weapon: word sprite number, word x, word y, word DS pointer to its text record |
| `2041:AB07` | 6 × 16 bytes | sprite descriptors 0xCD–0xD2 (weapon pictures) |
| `2041:7C04` | text record | tool shop page; credit digits end at `7D01` |
| `cs:3144` | 5 × (word BX, word CX) | tool prices, BCD CX:BX |
| `cs:3158` | 6 words | DS addresses of the tool markers |
| `2041:7D07` | text record | statistics page; fields at `7DB6`/`7DB7`, `7D7D`, `7D5A`, `7D3E`, `7D9B`, `7DD1` (7 b), `7DEA` (13 b) |
| `cs:2D03` | 7 × 16 bytes | weapon names (13 used) |
| `cs:2D73`, `2D7A`, `2D81` | 7 bytes each | energy class words |
| `cs:2D88`, `2D8B` | 3 bytes each | owned / not owned |
| `cs:2D8E` | 6 words | DS addresses of the owned flags |
| `2041:5BDE` | 20 words | mission text records per level index (index 0x13: level 0 after the exit) |
| `2041:7B69` | text record | item 4 page |
| `3B1B:0000` | 19 words + 0xFFFF | info page records (segment 3B1B) |
| `cs:2E90`, `2EE7`, `2F46` | text records | info page footers: first, middle, last |
| `cs:7EF4` | 47 × (word string, word handler) + 0xFFFF | cheat words and level codes (strings in `cs`, 0xFF-terminated) |
| `2041:818C` | byte pairs, 0xFF-terminated | scancode → ASCII for the matcher |
| `2041:9AF2`, `9A77`, `9A9D`, `9B1C` | file records | COMPUTER.VHF, WEAPONCL.EHF, ARMDISPL.VHF, PANEL.VHF |
| `2041:AF4F`, `AF36` | file records | ADLIB\INTEX.CMF, ADLIB\INGAME.CMF |

File record layout (**V**, `D076`): word name offset, word name segment, word destination offset, word destination
segment (the last two filled by the caller).

## 11. Open points

- **U** Live confirmation of any of the above (no DOSBox run was made for this spec). Suggested checks: the
  typewriter rate and skip, the reversed clip digits, the lag flag after the exit, `[7B4F]` during a session.
- **U** The role of `2177`'s six words and whether `A31A` draws visible player-2 HUD elements in a 1-player game.
- **U** The CRTC effect of `3000:0274` beyond the row offset (it writes register 0x12 = 0x87 and unlocks register 3).
- **I** All on-screen layout (positions, colours) comes from the text records and descriptors named above; nothing is
  computed except the map, the marker and the digit fields described here.
