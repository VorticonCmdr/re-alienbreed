# .EXE — DOS MZ executables

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified MZ headers and declared lengths.

## Identification and purpose

`ALIEN.EXE`, `CONFIG_.EXE`, and `SBCOMP.EXE` all begin with `MZ`. These are DOS executables, not graphics or archive files. [Microsoft's original MS-DOS EXE structure](https://github.com/microsoft/MS-DOS/blob/main/v4.0/src/INC/EXE.INC) defines the header; [DOSBox Staging's loader](https://github.com/dosbox-staging/dosbox-staging/blob/main/src/dos/dos_execute.cpp) provides a working implementation.

## Header fields

All fields below are unsigned little-endian 16-bit values.

| Offset | Meaning |
| --- | --- |
| `0x00` | Signature `0x5A4D` |
| `0x02` | Bytes used in the final 512-byte page |
| `0x04` | Count of file pages |
| `0x06` | Relocation count |
| `0x08` | Header length in 16-byte paragraphs |
| `0x0A`, `0x0C` | Minimum/maximum extra memory paragraphs |
| `0x0E`, `0x10` | Initial SS/SP |
| `0x12` | Checksum |
| `0x14`, `0x16` | Initial IP/CS |
| `0x18` | Relocation-table byte offset |
| `0x1A` | Overlay number |

Stored length is `(pages-1)*512 + (last_page_bytes or 512)`. Load-image offset is `header_paragraphs*16`. The measured header-derived file lengths match all three file sizes.

| File | Length | Header bytes | Relocations |
| --- | ---: | ---: | ---: |
| `ALIEN.EXE` | 183,351 | 2,048 | 447 |
| `CONFIG_.EXE` | 16,582 | 160 | 1 |
| `SBCOMP.EXE` | 3,457 | 32 | 0 |

## Local findings and remaining questions

`CONFIG_.EXE` contains a `PKLITE` marker. This indicates packing, but its unpacked code was not analyzed. `ALIEN.EXE` contains many asset filenames and a Team17 1993 copyright string. [SBCOMP.DOC](../game/SBCOMP.DOC) describes its compatibility utility.

MZ header validity does not prove runtime correctness. No executable was launched. Loading resources, code packing, entry-point behavior, and asset parsing routines remain outside this structural inspection.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `ALIEN.EXE` | 183,351 |
| `CONFIG_.EXE` | 16,582 |
| `SBCOMP.EXE` | 3,457 |
