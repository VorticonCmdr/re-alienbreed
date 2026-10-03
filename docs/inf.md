# .INF — AVM fixed-width game identification record

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified record boundaries; final flag meaning unknown.

## Identification and purpose

`AVM.INF` is a 39-byte binary record. It combines fixed-width ASCII fields and one binary byte. `CONFIG_.EXE` contains a reference to `avm.inf`, supporting use by the configuration program.

## Observed layout

| Offset | Length | Observed content |
| --- | ---: | --- |
| `0x00` | 30 | `Alien Breed` padded with spaces |
| `0x1E` | 8 | `ALIEN` padded with three spaces |
| `0x26` | 1 | `02` |

The first field plausibly holds a display name and the second an executable basename. This is an inference from their values, not a recovered reader implementation. The purpose of the final byte is unknown.

## Reading and remaining questions

Read the first two fields as fixed-width ASCII, trim trailing spaces for presentation, and preserve the last byte. Do not interpret this file using Windows Setup INF syntax: it has no section lines or key/value text and contains a binary tail.

No public specification for this AVM record was located in searches for Alien Breed's configuration resources. [READ.ME](../game/READ.ME) is the original local reference for the configuration utility, but does not define these fields.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `AVM.INF` | 39 |
