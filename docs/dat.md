# .DAT — configuration, demo data, and compressed sound drivers

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Multiple verified storage layouts; field meanings incomplete.

## Identification and purpose

The six `.DAT` files belong to three different families. The extension does not specify a single binary structure.

## Configuration records

`SETUP.DAT`, `sb16/SETUP.DAT`, and `mt32/SETUP.DAT` are all 103 bytes. Root `SETUP.DAT` is byte-identical to the Sound Blaster preset. The MT-32 preset differs only at offset `0x06`: `00` versus `01`. [The launcher](../game/run.bat) copies the selected preset into the game directory, so that difference selects between these supplied sound configurations; its exact internal field name is unverified.

The first twelve bytes of root `SETUP.DAT` are:

```text
01 00 00 00 01 00 00 00 09 00 04 00
```

[`SETUP.M32`](m32.md) and [`REM`](extensionless.md) are byte-identical to `mt32/SETUP.DAT`. Preserve the record length and unknown fields.

## Compressed driver records

| File | Stored length | Decoded length | Decoded identifier at offset 3 |
| --- | ---: | ---: | --- |
| `AVM_DD.DAT` | 4,521 | 7,800 | `CTVDSK` |
| `AVM_SB.DAT` | 2,681 | 3,910 | `CT-VOICE` |

Both use the four-byte length plus [LZHUF stream](lzhuf.md). They decoded completely. Their output begins with an x86 jump and contains Creative Sound Blaster driver identification/copyright strings. They are driver binaries, not PCM sample data. The compression interpretation is based on [the classic LZHUF implementation](https://github.com/vonj/snippets.org/blob/master/lzhuf.c) and confirmed against these two local samples.

## Demo record

`DEMO.DAT` is 1,024 bytes, begins with five zero bytes, and then contains repeated small byte values. A recorded attract-mode input stream is a plausible interpretation, but frame timing, input bit assignments, and even the exact record structure have not been verified. Treat it as opaque binary data.

## Web research and remaining questions

No public Alien Breed specification for the setup or demo fields was located. Driver identities come from the successfully decoded binaries; their entry-point/API layout was not recovered. The original [README](../game/READ.ME) explains sound configuration and XMS requirements but provides no binary schema.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `AVM_DD.DAT` | 4,521 |
| `AVM_SB.DAT` | 2,681 |
| `DEMO.DAT` | 1,024 |
| `SETUP.DAT` | 103 |
| `mt32/SETUP.DAT` | 103 |
| `sb16/SETUP.DAT` | 103 |
