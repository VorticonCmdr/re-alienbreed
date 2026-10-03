# Extensionless REM — duplicate configuration record

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified byte identity; filename provenance unknown.

## Identification and purpose

`REM` is the only extensionless file. It is 103 bytes and is byte-identical to `SETUP.M32` and `mt32/SETUP.DAT`, including SHA-256:

```text
604e45e0e94be9fc782069375dc232e20905b0a00bdb647bf9c6e1b72ceeba42
```

This identifies its data as the same configuration record described in [`.DAT`](dat.md) and [`.M32`](m32.md). It is not a textual batch comment: `REM` here is a filename, and the file's contents are binary.

## Reading and remaining questions

The leading bytes are `01 00 00 00 01 00 01 00 09 00 04 00`. There is no independent wrapper or metadata field distinguishing this copy from the MT-32 preset.

No public game-specific description of a `REM` resource was located. Its origin, intended filename, and whether the game ever opens it remain unknown. File-content identity alone does not prove it is needed at runtime. This page records it so every file in the supplied collection has a documented category.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `REM` | 103 |
