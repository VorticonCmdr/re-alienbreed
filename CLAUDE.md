# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A vanilla JavaScript (no framework, no TypeScript) foundation for porting the IBM PC edition of Alien Breed (Team17 / A.V.M., 1993) to the browser. The current milestone is an asset viewer, not a playable game. Vite is the only dependency. Node 22.12+ or 24+.

## Commands

```sh
npm install
npm run dev       # Vite dev server on 127.0.0.1:5173, opens /viewer.html
npm test          # node --test (runs test/*.test.js)
npm run build     # outputs dist/ (index.html + viewer.html entries)
npm run preview
node --test --test-name-pattern="VOC" test/formats.test.js   # run a single test by name
```

No linter or formatter is configured.

## Original game data

- Original files live in `game/` (git-ignored) with the `ADLIB/`, `LBMS/`, `SAMS/` subfolders intact. They are **read-only**: never modify them, never run the DOS executables, and never embed original bytes in source or test fixtures. `test/lzhuf-reference.json` holds only filenames, decoded lengths and SHA-256 hashes.
- The last two tests in `test/formats.test.js` are skipped when `game/` is absent. When present, they check all 50 LZHUF hashes and assert exact per-category counts (`images:47, music:15, other:27, sounds:27, maps:19`) across all 135 files. Changing `category()` or adding files changes these counts.
- `dist/` must never contain game files (`publicDir: false`). The built viewer has no server API; users pick their own folder.

## Architecture

Decoders are deliberately kept separate from the UI so the future game port can reuse them:

- `src/lzhuf.js`: `decompressLzhuf()` (used for `.VHF`, `.EHF`, `.HUF` and the two compressed Creative drivers `AVM_DD.DAT` / `AVM_SB.DAT`).
- `src/formats.js`: pure, DOM-free decoders. `category(path)` maps extensions to viewer categories; `decodeAsset(path, bytes)` is the single dispatch point that decompresses where needed and attaches `image` / `sound` / `music` / `text` to the result. Decoders validate with `check()` and throw descriptive errors on malformed or truncated input instead of reading past buffers (tests assert on those messages).
  - `.256` and decompressed `.VHF`: 320×200 row-major indexed pixels plus 768-byte 6-bit VGA palette (64,768 bytes).
  - Decompressed `.EHF`: four 8,000-byte bit planes, MSB-first, no palette (the viewer applies a selectable external palette, default `PANEL.VHF`).
  - `.BEP` / `.ROL` are Standard MIDI Files (not AdLib ROL); `.CMF` is Creative Music File with FM patches. Both go through the shared `readEvents()` reader into `decodeMusic()`.
- `src/audio.js`: `AssetPlayer` (Web Audio playback for PCM and an approximate synth for music) and `wavFile()` export. Music playback is intentionally approximate, not hardware-accurate.
- `src/viewer.js`: DOM UI for `viewer.html`. Assets come from two sources: in dev, the `/__game_catalog` middleware in `vite.config.js` lists `game/` and files are fetched from `./game/...`; otherwise via the "Open game folder" `webkitdirectory` input (`asset.file`). Decoded results are cached per path; `selectionVersion` / `libraryVersion` / `paletteVersion` counters guard against stale async renders.
- `index.html` only redirects to `viewer.html`. `base: './'` keeps the build relocatable for a future GitHub Pages deploy.

## Code style

Code is intentionally compact: terse one-line functions, multiple statements per line, minimal comments, and minified single-line CSS in `src/viewer.css`. Match that density when editing.

## Format documentation

`docs/` has one researched spec per extension (index in `docs/README.md`), each separating **Verified**, **Inferred** and **Unknown** claims. Keep that distinction when adding findings. Known open questions: EHF sprite frame boundaries, masks and gameplay palettes; the `.HUF` map schema (the viewer shows only byte rasters); `.DAT` field meanings. Formats from other Alien Breed editions (e.g. OpenBreed's MAP/SPR/BLK) do not apply to this edition.
