# .BIN — sound playback and effects driver binaries

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified identifiers and bytes; APIs incomplete.

## Identification and purpose

The eight files are driver-like binaries rather than one universal `.BIN` format. `AVMFM.BIN` at the root and `ADLIB/AVMFM.BIN` are byte-identical, 7,087 bytes long, and contain `FMDRV` at offset 3. Embedded text identifies a Creative Sound Blaster FM driver, version 1.30B.

`NEW_ADL.BIN`, `NEW_BEP.BIN`, and `NEW_ROL.BIN` plausibly supply music support for AdLib, PC beeper, and Roland. `SFX_ADL.BIN`, `SFX_BEP.BIN`, and `SFX_ROL.BIN` plausibly supply the corresponding effects. These roles are inferred from names, x86-looking entry sequences, and the sound modes listed in [READ.ME](../game/READ.ME); their call interfaces have not been verified.

## Observed structures

There is no common `MZ` executable header or shared four-byte length wrapper. For example:

```text
AVMFM.BIN:   50 00 18 46 4D 44 52 56 ...
NEW_ADL.BIN: 1E 53 0E 1F 80 FC 00 75 ...
NEW_BEP.BIN: 1E 53 8C CB 8E DB 80 FC ...
```

Do not strip four bytes as if these were HUF resources. The leading instruction-like bytes are part of the stored binary. `NEW_ROL.BIN` contains a programmer credit dated 1992.

## Reading and remaining questions

For analysis, preserve the entire byte sequence and inspect it as a potential 16-bit x86 code/data module. Segment assumptions, relocation rules, calling conventions, and embedded tables still need the game's loading/calling code.

Web research located [AdPlug's implementation of Creative FM playback](https://github.com/adplug/adplug/blob/master/src/cmf.cpp) as background for the CMF behavior; it does not specify Alien Breed's driver-module ABI. No public specification for the `NEW_*`/`SFX_*` wrappers was located. Distinguish these code modules from [CMF music](cmf.md), [MIDI music](rol.md), and [VOC samples](voc.md).

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `ADLIB/AVMFM.BIN` | 7,087 |
| `AVMFM.BIN` | 7,087 |
| `NEW_ADL.BIN` | 5,484 |
| `NEW_BEP.BIN` | 1,724 |
| `NEW_ROL.BIN` | 1,523 |
| `SFX_ADL.BIN` | 5,309 |
| `SFX_BEP.BIN` | 3,414 |
| `SFX_ROL.BIN` | 3,518 |
