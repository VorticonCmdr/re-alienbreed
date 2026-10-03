# .ROL — Standard MIDI File (Roland music)

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified MIDI container; hardware interpretation partly inferred.

## Identification and purpose

All five `.ROL` files start with `MThd`, and their track chunks are `MTrk`. Their contents are Standard MIDI Files despite the game-specific extension. The Roland role is inferred from matching `NEW_ROL.BIN`/`SFX_ROL.BIN` names and the sound modes described in [the original README](../game/READ.ME).

## Verified structure

| Offset | Length | Content |
| --- | ---: | --- |
| `0x00` | 4 | `MThd` |
| `0x04` | 4 | Big-endian header length, 6 |
| `0x08` | 2 | Big-endian format number |
| `0x0A` | 2 | Big-endian track count |
| `0x0C` | 2 | Big-endian division, 192 ticks per quarter note |
| `0x0E` onward | Variable | `MTrk`, big-endian track length, event bytes |

Four files are format 0 with one track. `TITLE.ROL` is format 1 with seven tracks. All track counts and lengths account for the complete files.

The [MIDI Association's Standard MIDI Files specification](https://midi.org/standard-midi-files) is the applicable standard. Decode variable-length delta times and event payloads, and honor running status, tempo meta-events, and end-of-track markers. Header and track boundaries were checked here; a full event-by-event validation was not performed.

## Reading and remaining questions

A copy with a `.mid` extension can be given to a MIDI-capable reader without changing its bytes. Preserve the originals and every track. The game's instrument/program mapping and playback-driver behavior have not been verified; a General MIDI synthesizer may sound different.

These files are not AdLib Visual Composer ROL files. Selecting a Visual Composer decoder from the extension alone would be incorrect.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `ADLIB/ALARMED.ROL` | 457 |
| `ADLIB/INGAME.ROL` | 209 |
| `ADLIB/INTEX.ROL` | 1,119 |
| `ADLIB/MONSTER.ROL` | 326 |
| `ADLIB/TITLE.ROL` | 13,238 |
