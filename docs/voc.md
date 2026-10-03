# .VOC — Creative Voice File sound samples

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified headers, block boundaries, codec and rates.

## Identification and purpose

There are 27 files: `AVM.VOC` and 26 effects in `SAMS/`. Every file starts with `Creative Voice File` followed by byte `1A`. Every header reports version `0x010A` (1.10), a first-block offset of 26, and checksum `0x1129`.

The header fields agree with [FFmpeg's VOC reader](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/vocdec.c). Codec tag zero is unsigned eight-bit PCM in [FFmpeg's codec table](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/voc.c).

## Verified layout in this collection

| Offset | Length | Content |
| --- | ---: | --- |
| `0x00` | 20 | Signature including `1A` |
| `0x14` | 2 | First block offset, unsigned little-endian |
| `0x16` | 2 | Version, little-endian |
| `0x18` | 2 | Version checksum, little-endian |
| `0x1A` | 1 | Block type `01` |
| `0x1B` | 3 | Block payload length, little-endian 24-bit |
| `0x1E` | 1 | Time constant |
| `0x1F` | 1 | Codec `00` |
| `0x20` | Variable | Unsigned eight-bit mono sample bytes |
| Last byte | 1 | Block type `00`, terminator |

All files have one type-1 block and a terminator, with exact file-length coverage. Header checksum is `((~version) + 0x1234) & 0xFFFF`.

For type 1, `rate = 1000000 / (256-time_constant)`, as implemented by [FFmpeg's block parser](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/voc_packet.c). In this collection 25 files use `A6` (approximately 11,111.11 Hz), `LAZER1.VOC` uses `B5` (approximately 13,333.33 Hz), and `PICKUP2.VOC` uses `CB` (approximately 18,867.92 Hz). Sample count is block length minus two.

## Reading and remaining questions

Parse the header and block lengths; do not strip a fixed prefix for arbitrary VOC files, which can contain other block types. In this collection the sample data starts at byte 32, and duration is `sample_count / rate`.

FFmpeg has a VOC demuxer and can export these to WAV. Playback was not auditioned; trigger timing and in-game resampling remain unverified.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `AVM.VOC` | 60,160 |
| `SAMS/ACID.VOC` | 3,469 |
| `SAMS/ALIENKL1.VOC` | 2,849 |
| `SAMS/AMMOSOUN.VOC` | 6,378 |
| `SAMS/CLOCKTIC.VOC` | 1,079 |
| `SAMS/COMPUTER.VOC` | 4,402 |
| `SAMS/DANGER.VOC` | 6,098 |
| `SAMS/DOORS.VOC` | 6,747 |
| `SAMS/EGGCRACK.VOC` | 5,526 |
| `SAMS/EMPTY.VOC` | 2,146 |
| `SAMS/EXPLOSN1.VOC` | 14,936 |
| `SAMS/EXPLOSN2.VOC` | 11,035 |
| `SAMS/GAMEOVER.VOC` | 8,665 |
| `SAMS/IMMINENT.VOC` | 18,634 |
| `SAMS/INTEXSYS.VOC` | 12,540 |
| `SAMS/IN_CLICK.VOC` | 453 |
| `SAMS/LAZER1.VOC` | 5,371 |
| `SAMS/LAZER4.VOC` | 6,509 |
| `SAMS/LAZER5.VOC` | 5,072 |
| `SAMS/LAZER6.VOC` | 5,248 |
| `SAMS/MACHINEG.VOC` | 1,650 |
| `SAMS/NEWLAZER.VOC` | 9,104 |
| `SAMS/NOISE2.VOC` | 3,472 |
| `SAMS/PICKUP.VOC` | 2,147 |
| `SAMS/PICKUP2.VOC` | 3,180 |
| `SAMS/SCORPIEN.VOC` | 5,442 |
| `SAMS/URRGH1.VOC` | 2,029 |
