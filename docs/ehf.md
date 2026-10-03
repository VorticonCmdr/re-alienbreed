# .EHF — LZHUF-compressed four-plane sprite sheet

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified compression; visually verified planar interpretation.

## Identification and purpose

The 15 files include players, aliens, bosses, explosions, and weapons. Every file begins with `00 7D 00 00`, the little-endian value 32,000. All 15 decoded with [LZHUF](lzhuf.md) to exactly 32,000 bytes and used the compressed stream through the final byte.

## Decoded graphics layout

A 320 × 200 four-plane bitmap accounts for the entire payload:

| Decoded offset | Length | Content |
| --- | ---: | --- |
| `0x0000` | 8,000 | Plane 0 |
| `0x1F40` | 8,000 | Plane 1 |
| `0x3E80` | 8,000 | Plane 2 |
| `0x5DC0` | 8,000 | Plane 3 |

Each plane has 200 rows of 40 bytes. Bits run from most significant to least significant within each byte. The reconstructed index is:

```text
index(x,y) = sum((((decoded[p*8000 + y*40 + x//8]
                    >> (7-x%8)) & 1) << p) for p in 0..3)
```

This interpretation rendered `PLAYER1.EHF` as a coherent gallery of player animation frames. Using the first 16 colors from decoded `PANEL.VHF` provided a readable preview; that palette association is a preview choice, not a verified rule of the game.

The compression layer is based on [the classic LZHUF source](https://github.com/vonj/snippets.org/blob/master/lzhuf.c); the plane offsets and visual result are local observations.

## Reading and remaining questions

There is no room for an embedded 768-byte palette in this observed 32,000-byte layout. Preserve palette selection as an external dependency. A decoded EHF is not an eight-bit-per-pixel image: reading one byte as one pixel produces the wrong result.

Sprite rectangles, frame order, masks, transparent color, and gameplay palette selection were not established. The planar layout was visually checked on the player sheet; each other sheet's contents have not been individually reviewed.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `0BIGBAD.EHF` | 4,640 |
| `1BIGBAD.EHF` | 5,973 |
| `2BIGBAD.EHF` | 7,330 |
| `3BIGBAD.EHF` | 7,232 |
| `ALIEN00.EHF` | 14,644 |
| `ALIEN01.EHF` | 12,568 |
| `ALIEN02.EHF` | 13,547 |
| `ALIEN03.EHF` | 13,066 |
| `ALIEN1.EHF` | 14,857 |
| `BOOM_NEW.EHF` | 12,940 |
| `DECKMAN1.EHF` | 3,427 |
| `DECKMAN2.EHF` | 3,422 |
| `PLAYER1.EHF` | 10,575 |
| `PLAYER2.EHF` | 9,650 |
| `WEAPONCL.EHF` | 17,435 |
