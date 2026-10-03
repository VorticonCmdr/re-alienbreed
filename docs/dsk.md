# .DSK — Turbo C context/desktop data

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified identifying header; binary schema incomplete.

## Identification and purpose

`INSTALL.DSK` is 148 bytes. It starts with ASCII `Turbo C Context File ` followed by byte `1A` and binary data. It also contains the path `C:\ALIEN\NONAME00.CPP`.

This header identifies a Turbo C context file. Borland documents `.DSK` files as saved IDE desktop/window state in its [Turbo C++ 3.0 User's Guide](https://www.bitsavers.org/pdf/borland/turbo_c/Turbo_C%2B%2B_3.0_Users_Guide_1992.pdf), section “Configuration and project files.” That general purpose agrees with the local header and source-file path. The exact version that wrote this file was not established.

## Observed layout

| Offset | Length | Content |
| --- | ---: | --- |
| `0x00` | 21 | ASCII identification including the trailing space |
| `0x15` | 1 | `1A` marker |
| `0x16` onward | 126 | Version-dependent context data, including the path |

## Reading and remaining questions

Retain this as development-tool metadata. It is not a disk image and should not be mounted as one. The filename `INSTALL` does not imply an installer data archive.

Use a binary inspector to extract the identifier and readable strings. The remaining record fields, serializer version, and window-state structure have not been decoded. Runtime necessity was not tested; the developer-tool association is supported by the identifying header and Borland's manual.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `INSTALL.DSK` | 148 |
