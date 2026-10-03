# .ME — original plain-text README

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified ASCII text.

## Identification and purpose

`READ.ME` is a 6,054-byte ASCII text file. Most line endings are CRLF; the final ending includes LF-only blank lines. It describes the IBM PC edition, specifications, memory requirements, speed settings, and sound troubleshooting.

The text credits Team17 and A.V.M. for the conversion. It reports 256-color VGA graphics, PC beeper/AdLib/Roland/Sound Blaster music, and XMS requirements for sampled effects. These statements establish the local game's platform and explain the resource families; they are historical documentation rather than results of runtime testing.

## Reading and remaining questions

No wrapper, signature, or structured binary header is present. Read the bytes as ASCII; a DOS-compatible single-byte encoding is also appropriate for preserving original text. `.ME` is simply the second part of the traditional `READ.ME` filename.

[The supplied README](../game/READ.ME) is the primary source for this file. Web research did not identify an independent `.ME` binary format applicable to this collection. It must not be classified from generic extension databases.

The document's historical contact details and system recommendations were not checked for present-day applicability. No executable was launched to verify its reported behavior.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `READ.ME` | 6,054 |
