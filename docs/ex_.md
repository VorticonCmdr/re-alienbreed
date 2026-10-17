# .EX_ — alternate DOS MZ executable

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified MZ container; the five-byte difference is a disabled copy-protection compare (verified 2026-10-17).

## Identification and purpose

The only file, `ALIEN.EX_`, is 183,351 bytes and begins with `MZ`. It has the same DOS header values and file length as `ALIEN.EXE`. The underscore extension does not mean this particular file is a compressed installer archive: its bytes identify a DOS executable.

The applicable container is described in [`.EXE`](exe.md) and [Microsoft's MS-DOS EXE structure](https://github.com/microsoft/MS-DOS/blob/main/v4.0/src/INC/EXE.INC).

## Verified comparison

The two files differ in exactly five bytes, at file offsets `0x0C52` through `0x0C56` inclusive (decimal 3154–3158). They are not byte-identical backups.

| File | SHA-256 |
| --- | --- |
| `ALIEN.EXE` | `0787a2ca63e712ef1e2278fd5a78d9a0ea1e9ca0197398ab9e4cb684b067e0c7` |
| `ALIEN.EX_` | `8d998048583420402d9296918d1f119eb34c40980aa31bdd2b1fbe504728ac2a` |

## What the difference is (verified 2026-10-17)

The MZ header is 0x800 bytes, so file offset `0x0C52` is image offset `0x0452` (Ghidra `1000:0452`). It lies inside the manual-lookup passcode routine (`1000:03D5`), which picks a table entry, reads three keystrokes with INT 21h AH=01h and compares them.

| File | Bytes at `0x0C52` | Meaning |
| --- | --- | --- |
| `ALIEN.EX_` | `2E 8A 87 9D 04` | `mov al, cs:[bx+049D]`: the original compare runs |
| `ALIEN.EXE` | `EB 22 90 90 90` | `jmp short` to a `ret`: any three keys pass |

So `ALIEN.EX_` is the unmodified program and `ALIEN.EXE` is the same program with the check disabled. Everything else is byte-identical, so porting work uses `ALIEN.EXE`. The passcode state is not referenced elsewhere: every direct `cs:` reference to the table, the input bytes and the chosen index (`cs:06A7`) lies in `1000:0389`–`0485`. That is a static search of direct references only.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `ALIEN.EX_` | 183,351 |
