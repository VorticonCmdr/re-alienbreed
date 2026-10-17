# Alien Breed DOS file-format reference

Researched and inspected **2026-10-03**.

Scope: all **135 game/distribution files** recursively found in `/Users/valentin.pletzer/Downloads/dosgames/AlienBreed/game/`: **20 distinct extensions plus one extensionless file**. There is one document for every extension/category, including aliases and incidental launcher/development files, and a shared [LZHUF reference](lzhuf.md). macOS `.DS_Store` folder metadata is excluded.

## Format index

| Extension/category | Files | Document | Evidence status |
| --- | ---: | --- | --- |
| `.256` | 18 | [raw indexed VGA bitmap](256.md) | Verified bitmap layout |
| `.ba1` | 1 | [batch-script text under an alternate extension](ba1.md) | Verified text; appears unrelated to this game |
| `.bat` | 1 | [DOSBox-oriented batch launcher](bat.md) | Verified text and command intent; not executed |
| `.bep` | 5 | [Standard MIDI File (PC beeper music)](bep.md) | Verified MIDI container; hardware interpretation partly inferred |
| `.bin` | 8 | [sound playback and effects driver binaries](bin.md) | Verified identifiers and bytes; APIs incomplete |
| `.cmf` | 5 | [Creative Music File with FM instruments](cmf.md) | Verified CMF 1.1 header and instrument boundaries |
| `.dat` | 6 | [configuration, demo data, and compressed sound drivers](dat.md) | Multiple verified storage layouts; field meanings incomplete |
| `.doc` | 1 | [plain-text Sound Blaster compatibility note](doc.md) | Verified ASCII text |
| `.dsk` | 1 | [Turbo C context/desktop data](dsk.md) | Verified identifying header; binary schema incomplete |
| `.ehf` | 15 | [LZHUF-compressed four-plane sprite sheet](ehf.md) | Verified compression; visually verified planar interpretation |
| `.ex_` | 1 | [alternate DOS MZ executable](ex_.md) | Verified: original build; `ALIEN.EXE` differs only by a disabled passcode compare |
| `.exe` | 3 | [DOS MZ executables](exe.md) | Verified MZ headers and declared lengths |
| No extension | 1 | [REM](extensionless.md) | Verified byte identity; filename provenance unknown |
| `.huf` | 19 | [LZHUF-compressed map resources](huf.md) | Verified compression; map schema incomplete |
| `.inf` | 1 | [AVM fixed-width game identification record](inf.md) | Verified record boundaries; final flag meaning unknown |
| `.m32` | 1 | [MT-32 configuration preset](m32.md) | Verified byte identity with DAT preset |
| `.me` | 1 | [original plain-text README](me.md) | Verified ASCII text |
| `.rol` | 5 | [Standard MIDI File (Roland music)](rol.md) | Verified MIDI container; hardware interpretation partly inferred |
| `.rst` | 1 | [BRIEF editor restore-state text](rst.md) | Verified text and editor association |
| `.vhf` | 14 | [LZHUF-compressed VGA bitmap](vhf.md) | Verified compression and bitmap layout |
| `.voc` | 27 | [Creative Voice File sound samples](voc.md) | Verified headers, block boundaries, codec and rates |

## Evidence and limits

**Verified** means directly observed in the supplied bytes, checked against parsed boundaries, successfully decoded, or explicitly reviewed as a rendered image. **Inferred** means supported by naming, embedded strings, size patterns, or related files without confirming the game's consuming code. **Unknown** means a field or behavior has not been established. Each page distinguishes these cases.

Web research used primary standards, original implementation source, and vendor manuals. Links appear beside the claims they support. Game-specific observations come from the files themselves; some have no public specification. All original game files were treated as read-only. No game executable or launcher was run, and original-file SHA-256 hashes were checked before and after documentation creation.

## Findings that affect reader selection

- `.BEP` and `.ROL` files are Standard MIDI Files; this collection's `.ROL` is not AdLib Visual Composer ROL.
- `.VHF` and `.EHF` use LZHUF compression. Their decoded graphics use different pixel layouts.
- `.256` files are raw indexed bitmaps with palettes, despite being in `LBMS/`.
- `.HUF` compression is verified, while the internal map schema remains incomplete.
- `.DAT` includes setup records, opaque demo data, and two compressed Creative sound drivers.
- `.EX_` contains an MZ executable variant, rather than an installer-compressed file.
- `.DOC` and `.ME` are ordinary text; `.DSK` and `.RST` are development-tool state files.
- `REM` duplicates the MT-32 setup record. The `.BA1` file contains a launcher for Loom, despite its Alien Breed filename.

## Edition boundaries

The local [README](../game/READ.ME) identifies the IBM PC edition and credits A.V.M. for its conversion. The supplied game executable contains a Team17 1993 copyright string.

Earlier research found [OpenBreed](https://github.com/mrpetro/OpenBreed), but its MAP/SPR/BLK/EPF and Amiga Imploder resources belong to other editions. Its README explicitly distinguishes the 1991 original from its later resource families. None of those formats were added here merely because they occur elsewhere in the series.

This reference is tied to the supplied collection. It does not establish which incidental files were part of the original retail release.
