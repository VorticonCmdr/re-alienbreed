# Scenario: boot to level 1

Reproducible route from a fresh DOSBox instance to the first playable level of the original.
It is the only complete machine checkpoint available (the MCP tools have no save-state).

## Environment

- Engine: `dosbox-automation 0.84.0-vc1 (f6d9b)` via `dosbox-mcp` bridge 0.1.1, protocol 1.14.
- CPU cycles: whatever the bridge's human-edited config sets (not visible through MCP). Timing
  measurements must state this.
- `C:` = disposable copy of `game/` at `.work/dos` (created with `cp -R game .work/dos`), read-write.
- Expected identities: `ALIEN.EXE` SHA-256 `0787a2ca…e0c7`, `SETUP.DAT` `cfd218f4…3c0c`.

## Steps

1. `bridge_stop`, `bridge_start` (fresh instance), `drive_mount C .work/dos`.
2. Optional breakpoints: `debug_pause`, add them, `debug_continue` (breakpoints arm only on resume).
3. `input_type "C:\nALIEN\n"`. The image loads at live segment `01F5` (check: PSP `01E5`).
4. Passcode prompt (`Table-C Row-nn Column-x`, entry varies per boot): `input_type "000"`. Any three
   keys pass in this build.
5. Intro runs by itself, then the title (`title.vhf`). Press Enter about every 2.5 s until the level
   starts (title, two story pages, `moonpic.vhf`).
6. Level 1 is running when `[2041:B0B2]` (*live* `1236:B0B2`) = 2 and `cs:[8716]` (*live*
   `01F5:8716`) = 0.

## Checkpoints available

- `01F5:1BB7`: return from the level initialiser `CALLF 2EF5:0000` (map transformed, before the first
  frame).
- `20EA:12BC`: end of every game frame (after the timer-tick wait).

## Caveats

- Leaving the game idle in a level eventually returns to the title and attract cycle. Re-entering a
  level from there does not pass `01F5:1BB7` in the run observed so far, so capture init state from a
  fresh boot.
- Esc in game returns to the intro/attract sequence. No DOS exit has been found yet. Restart the
  instance instead.
