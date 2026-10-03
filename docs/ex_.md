# .EX_ — alternate DOS MZ executable

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified MZ container; variant difference observed.

## Identification and purpose

The only file, `ALIEN.EX_`, is 183,351 bytes and begins with `MZ`. It has the same DOS header values and file length as `ALIEN.EXE`. The underscore extension does not mean this particular file is a compressed installer archive: its bytes identify a DOS executable.

The applicable container is described in [`.EXE`](exe.md) and [Microsoft's MS-DOS EXE structure](https://github.com/microsoft/MS-DOS/blob/main/v4.0/src/INC/EXE.INC).

## Verified comparison

The two files differ in exactly five bytes, at file offsets `0x0C52` through `0x0C56` inclusive (decimal 3154–3158). They are not byte-identical backups.

| File | SHA-256 |
| --- | --- |
| `ALIEN.EXE` | `0787a2ca63e712ef1e2278fd5a78d9a0ea1e9ca0197398ab9e4cb684b067e0c7` |
| `ALIEN.EX_` | `8d998048583420402d9296918d1f119eb34c40980aa31bdd2b1fbe504728ac2a` |

## Reading and remaining questions

Use an MZ-aware reader. Preserve both variants when comparing program logic. The reason for the five-byte difference, original-file provenance, and whether either variant contains a gameplay or loader patch were not determined. Renaming is unnecessary for inspection, and neither file was executed.

No Alien Breed-specific public explanation of this `.EX_` variant was located; this identification is based on the local header and byte comparison.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `ALIEN.EX_` | 183,351 |
