# .BAT — DOSBox-oriented batch launcher

[Format index](README.md) · Researched and inspected 2026-10-03

**Evidence status:** Verified text and command intent; not executed.

## Identification and purpose

`run.bat` is a 450-byte ASCII command script. Most line endings are CRLF, with a final LF. It presents Sound Blaster, MT-32, and quit choices, then uses `choice`, `if errorlevel`, labels, and `goto` to select a path.

Batch files are command text interpreted by a command shell, as described in [Microsoft's command documentation](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/windows-commands). This launcher's `CONFIG -set` commands specifically target DOSBox-style emulator configuration, so modern Windows command documentation is background rather than proof that the script runs in Windows CMD.

## Verified command behavior by inspection

The Sound Blaster branch sets `mididevice=default`, copies `sb16/*.*` into the current directory, and invokes `ALIEN`. The MT-32 branch sets `mididevice=mt32`, copies `mt32/*.*`, and invokes the same game basename. The script exits after either branch.

These operations explain why [the `.DAT` presets](dat.md) differ. The script was read, not executed, so its compatibility with a particular DOSBox version remains unverified.

## Reading and remaining questions

Treat it as text, keep labels and quoting, and preserve the relative directory assumptions. Its copy commands overwrite the active preset if run. The installed emulator version and its accepted `choice`/`CONFIG` syntax were not checked.

## Files inspected

Paths are relative to `game/`.

| File | Stored bytes |
| --- | ---: |
| `run.bat` | 450 |
