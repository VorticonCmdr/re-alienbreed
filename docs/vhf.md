# .VHF — LZHUF-compressed VGA bitmap

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified compression and bitmap layout.

## Identification and purpose

There are 14 compressed graphics files, including the title, logos, interface, and ending artwork. Every file begins with `00 FD 00 00`: a little-endian output length of 64,768. This is a length field, not a unique format signature.

## Verified layout

| File offset | Length | Content |
| --- | ---: | --- |
| `0x00` | 4 | Unsigned little-endian decoded length, 64,768 |
| `0x04` | Rest of file | [LZHUF stream](lzhuf.md) |

The decoded layout is identical to [`.256`](256.md): 64,000 row-major pixels at 320 × 200, followed by 768 bytes of RGB palette data. All 14 decoded palettes have components no greater than 63. Visual inspection of `TITLE.VHF` and `COMPUTER.VHF` confirmed the row order and palette placement; interpreting the bytes as a sequence of small tiles scrambled the images.

All 14 files decoded to their declared length, consuming the compressed file through its final byte (allowing unused bits in that byte). The codec parameters follow [the classic LZHUF implementation](https://github.com/vonj/snippets.org/blob/master/lzhuf.c); the bitmap interpretation follows [VGA addressing](https://delorie.com/djgpp/doc/brennan/brennan_access_vga.html) and the local render results.

## Reading and remaining questions

Apply LZHUF to the bytes after the four-byte length, then parse the decoded bitmap. Feeding the compressed file directly to an image viewer will not work. Do not use the Amiga Imploder decoder or a Tower Assault EPF reader for these files.

This page describes the stored image. Exact screen placement, clipping, transitions, and font glyph boundaries still require examination of the game's graphics routines.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `AB_END1.VHF` | 35,531 |
| `AB_END2.VHF` | 21,725 |
| `AL_LOGO.VHF` | 8,284 |
| `ARMDISPL.VHF` | 3,982 |
| `AVM256.VHF` | 13,045 |
| `CARGOBAY.VHF` | 23,748 |
| `COMPUTER.VHF` | 16,756 |
| `DECKLIFT.VHF` | 14,578 |
| `FONT.VHF` | 2,319 |
| `GAMEOVER.VHF` | 18,093 |
| `MOONPIC.VHF` | 10,382 |
| `PANEL.VHF` | 3,130 |
| `TEAM_17.VHF` | 20,933 |
| `TITLE.VHF` | 5,935 |
