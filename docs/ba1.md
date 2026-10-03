# .BA1 — batch-script text under an alternate extension

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified text; appears unrelated to this game.

## Identification and purpose

`Alien Breed (1993).ba1` is an 80-byte ASCII file with CRLF endings. Its content is batch-script text, beginning with `@echo off` and three parent-directory changes.

Its final command invokes `scummvm.exe` against a `games\loom` directory and the target `loom`. That is a local observation. Despite the filename, this content does not launch `ALIEN.EXE`; its provenance and reason for being included here are unknown.

## Reading and remaining questions

`.BA1` is an alternate extension in this collection, not an independently identified binary format. Read it as text. The underlying command-script syntax is covered by [Microsoft's batch command documentation](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/windows-commands) and [`.BAT`](bat.md).

Do not assume a DOS or Windows shell automatically executes this extension. The original launcher association was not inspected. No commands from the file were run.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `Alien Breed (1993).ba1` | 80 |
