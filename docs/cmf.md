# .CMF — Creative Music File with FM instruments

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified CMF 1.1 header and instrument boundaries.

## Identification and purpose

The five music resources in `ADLIB/` start with `CTMF` and version bytes `01 01`, identifying Creative Music File version 1.1. CMF packages FM instrument data with a MIDI-like music event stream. [AdPlug's CMF player](https://github.com/adplug/adplug/blob/master/src/cmf.cpp) implements this format.

## Verified header

All multibyte fields in this header are little-endian. Offsets are measured from the start of the file.

| Offset | Length | Content measured here |
| --- | ---: | --- |
| `0x00` | 4 | `CTMF` |
| `0x04` | 2 | Version `0x0101` |
| `0x06` | 2 | Instrument offset, 40 |
| `0x08` | 2 | Music offset, varies by instrument count |
| `0x0A` | 2 | Ticks per quarter, 48 |
| `0x0C` | 2 | Ticks per second, 96 |
| `0x0E` | 6 | Title/composer/remarks offsets, all zero |
| `0x14` | 16 | Channel-use flags |
| `0x24` | 2 | Instrument count |
| `0x26` | 2 | Basic tempo, 120 |

Each observed instrument record occupies 16 bytes, including its FM register parameters and reserved bytes. Music starts at `40 + 16*instrument_count` in every sample.

| File | Instruments | Music offset |
| --- | ---: | ---: |
| `ALARMED.CMF` | 4 | 104 |
| `INGAME.CMF` | 4 | 104 |
| `INTEX.CMF` | 5 | 120 |
| `MONSTER.CMF` | 6 | 136 |
| `TITLE.CMF` | 7 | 152 |

## Reading and remaining questions

Validate offsets against file size, load the FM instruments, and parse events from the music offset. This is not a full `MThd`/`MTrk` MIDI container; simply renaming it `.mid` is insufficient. CMF playback needs its instrument data and CMF controller interpretation.

Only header and instrument boundaries were validated locally. Event validity, custom controller use, and exact equivalence with Alien Breed's FM driver remain unverified.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `ADLIB/ALARMED.CMF` | 898 |
| `ADLIB/INGAME.CMF` | 277 |
| `ADLIB/INTEX.CMF` | 1,116 |
| `ADLIB/MONSTER.CMF` | 408 |
| `ADLIB/TITLE.CMF` | 12,998 |
