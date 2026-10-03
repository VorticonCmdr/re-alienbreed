# .HUF — LZHUF-compressed map resources

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified compression; map schema incomplete.

## Identification and purpose

The collection contains 19 map-named files: `L0MZ.HUF` through level letter variants, and `PCMAP1.HUF` through `PCMAP6.HUF`. `ALIEN.EXE` contains references to these names. The resource role is strongly supported by the names and executable references; the complete decoded map schema has not been recovered.

## Verified storage layout

| File offset | Length | Content |
| --- | ---: | --- |
| `0x00` | 4 | Little-endian output length, `74 66 00 00` = 26,228 |
| `0x04` | Rest of file | [LZHUF stream](lzhuf.md) |

All 19 decoded to exactly 26,228 bytes. Each decoder run consumed the file through its final byte. This confirms the compression identification against every available HUF sample, using the parameters of [the classic LZHUF source](https://github.com/vonj/snippets.org/blob/master/lzhuf.c).

The decoded bytes do not start with the four-character chunk structure used by the later OpenBreed MAP reader. For example, decoded `L1MZ.HUF` begins with repeated `04 00`, while `L2MZ.HUF` begins `04 04 04 08 04 08 04 09`. Several resources also contain code-like byte sequences near the tail. Their purpose is unknown; do not discard them.

## Reading and remaining questions

Implement the decompression layer independently of map interpretation, retain every decoded byte, and compare tile rendering against the game before assigning fields.

Map width/height, record boundaries, cell byte order, tile/action bit assignments, spawn records, and trailing-data meaning remain unverified. In particular, dividing the output length into a plausible grid does not establish its dimensions.

[OpenBreed](https://github.com/mrpetro/OpenBreed) explicitly distinguishes its later classic-game resources from the 1991 original. Its MAP/SPR/BLK readers are useful background, but are not specifications for this DOS collection.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `L0MZ.HUF` | 8,694 |
| `L1MZ.HUF` | 5,146 |
| `L2MZ.HUF` | 10,220 |
| `L3MZ.HUF` | 8,197 |
| `L4MZ.HUF` | 5,952 |
| `L5MZ.HUF` | 9,456 |
| `L6MZ.HUF` | 9,718 |
| `L7MZ.HUF` | 10,578 |
| `L8MZ.HUF` | 9,976 |
| `L9MZ.HUF` | 4,407 |
| `LAMZ.HUF` | 11,373 |
| `LBMZ.HUF` | 8,053 |
| `LZMZ.HUF` | 5,082 |
| `PCMAP1.HUF` | 2,685 |
| `PCMAP2.HUF` | 4,931 |
| `PCMAP3.HUF` | 7,004 |
| `PCMAP4.HUF` | 10,376 |
| `PCMAP5.HUF` | 4,627 |
| `PCMAP6.HUF` | 2,283 |
