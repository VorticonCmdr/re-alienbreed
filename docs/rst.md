# .RST — BRIEF editor restore-state text

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified text and editor association.

## Identification and purpose

`STATE.RST` is a 195-byte ASCII file with CRLF line endings. Its extension stands for editor restore state in this context. Borland's [BRIEF for DOS and OS/2 User's Guide](https://www.bitsavers.org/pdf/borland/BRIEF_for_DOS_and_OS2_Version_3.1_Users_Guide_1992.pdf), “Restore,” documents `.rst` state files that preserve files, windows, cursor positions, and search settings.

## Observed syntax

The file uses section markers and key/value lines. Sections are `[edit-]`, `[brief]`, and `[shared-]`; keys include `screen`, `toggles`, `srch`, `file`, and `pmark`. It records `screen=80 50` and references `d:\alien\state.rst` with numeric position/window information.

This is editor-session metadata, not an Alien Breed savegame or a reStructuredText document. The file's `[brief]` section and the exact restore-state filename agree with the original editor manual.

## Reading and remaining questions

Read as ASCII text and preserve section order, spaces, and CRLF if round-tripping. Numeric tuple meanings have not been mapped field by field. No BRIEF session was restored, and runtime necessity was not tested.

The web reference establishes the editor's restore-state mechanism; the specific sections and values above were observed in this local file.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `STATE.RST` | 195 |
