# LZHUF — shared compression layer

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** decoded successfully against all 50 applicable local files.

## Format and parameters

The compatible reference is [Haruyasu Yoshizaki's classic LZHUF source, with portability updates](https://github.com/vonj/snippets.org/blob/master/lzhuf.c). It combines LZSS with adaptive Huffman coding. For these files:

| Parameter | Value |
| --- | ---: |
| Ring buffer `N` | 4096 |
| Maximum match `F` | 60 |
| Match threshold | 2 |
| Huffman symbols | 314 |
| Frequency rebuild threshold | `0x8000` |
| Initial ring position | `N-F` = 4036 |
| Initial history bytes before that position | `0x20` |
| Bit order | Most significant bit first |

The file starts with a four-byte unsigned little-endian decoded length. The compressed bitstream follows immediately. There is no filename, archive directory, checksum, or end symbol in this wrapper. Output length determines termination.

## Implementation outline

Initialize the Huffman tree and history as in the reference. Decode a symbol and update the adaptive tree. Values below 256 are literal bytes. Values 256–313 encode match lengths of 3–60 (`symbol-253`); decode their distance using the reference's static upper-position code table and six low bits. Copy overlapping matches through the ring buffer.

Check input bounds and output size. Read the stored length as exactly four bytes: old C implementations using the host width of `unsigned long` may read eight bytes on modern systems. In a complete file, only unused bits in the final compressed byte should remain.

## Local verification

| Resource family | Files | Decoded bytes per file |
| --- | ---: | ---: |
| [HUF maps](huf.md) | 19 | 26,228 |
| [EHF graphics](ehf.md) | 15 | 32,000 |
| [VHF graphics](vhf.md) | 14 | 64,768 |
| [DAT driver `AVM_DD.DAT`](dat.md) | 1 | 7,800 |
| [DAT driver `AVM_SB.DAT`](dat.md) | 1 | 3,910 |

All 50 reached the declared size without reading past the compressed stream. Every stream's consumed bit count rounded up to its file size. Rendered VHF graphics and an EHF player sheet were recognizable, and the DAT output contained coherent Creative driver identifiers.

A decoder with a `0x4000` frequency threshold failed on `AB_END1.VHF`; using the classic `0x8000` threshold decoded that file completely. This is a useful compatibility discriminator. Do not assume all LZHUF-derived implementations share the same parameters.

These results verify decoding and container boundaries. They do not establish all gameplay semantics or byte-identical recompression, neither of which was tested.

## Scope

This is a raw LZHUF stream wrapper, not an LHA/LZH archive, ZIP file, or Amiga Imploder stream. Once decompressed, select the appropriate resource parser; decompression does not establish a map schema or sprite frame table.
