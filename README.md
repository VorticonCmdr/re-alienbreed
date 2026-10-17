# Alien Breed web port

A vanilla JavaScript port of the IBM PC edition of Alien Breed (1993) that runs from your own original game files. The first level is partly playable; see [docs/port/STATUS.md](docs/port/STATUS.md) for what works, how it is verified, and what is missing. The repository also contains an asset viewer.

## Local development

Use Node.js 22.12+ (or a newer supported LTS release) and npm. Put your original game files in `game/`, keeping the `ADLIB/`, `LBMS/`, and `SAMS/` subfolders intact.

```sh
npm install
npm run dev
```

Open [game.html](http://127.0.0.1:5173/game.html) to play or [viewer.html](http://127.0.0.1:5173/viewer.html) to browse assets. The Vite development server discovers files from `game/` automatically. You can also use **Open game folder** to select that folder directly. Folder selection reads files in the browser without uploading them. Select the game folder itself, rather than its parent.

```sh
npm test          # unit tests; game-data tests skip without game/
npm run verify    # strict: needs game/, forbids skipped tests, runs a headless Chrome scenario
npm run build
npm run preview
```

`npm test` runs decoder tests and, when `game/` is present, checks all 135 supplied files and 50 independently decoded LZHUF hashes. The two original-collection checks are skipped in a checkout without game data. If using another edition or modified data, adjust those reference checks to that collection.

## Viewer coverage

| Assets | Preview |
| --- | --- |
| 18 `.256` + 14 `.VHF` | 320 × 200 indexed VGA pixels and embedded palette |
| 15 `.EHF` | Four-plane sprite sheets; selectable external palette |
| 27 `.VOC` | Original PCM samples, waveform, play/pause/seek/volume and WAV export |
| 5 `.BEP` + 5 `.ROL` | MIDI note timeline and browser synthesizer playback |
| 5 `.CMF` | MIDI-like score with embedded two-operator FM patches; approximate synthesis |
| 19 `.HUF` | LZHUF decompression, adjustable byte raster and hex inspection |
| 27 other files | Text or binary inspection, including decompressed Creative drivers |

Images can be exported as PNG. Original and decompressed bytes can be downloaded from the inspector. Arrow keys browse the filtered list, `/` focuses search, and Escape stops audio. Sounds play only after you press Play.

Music previews do **not** reproduce the original PC speaker, Roland MT-32 or OPL chip. They preserve note timing, tempo, program selection and initial channel settings; oscillator timbres, FM envelopes, rhythm mode, percussion and changes to held notes are approximate. End-of-track padding after the final note is omitted from the playback timeline. This gives a useful asset audition while hardware-accurate music remains a later porting task.

The EHF palette and color-0 transparency controls are preview choices. Sprite frame boundaries, masks and gameplay palettes still need research. HUF byte rasters show patterns in the decoded data; they are not reconstructed levels. Binary drivers contain executable code, rather than playable sound recordings.

See [docs/README.md](docs/README.md) for researched format specifications, primary sources, verified observations and unknowns. The decoders are separate from the UI in `src/formats.js` and `src/lzhuf.js`, so the game port can reuse them.

## Git and original files

`game/` is ignored by Git, along with `node_modules/`, `dist/`, environment files and operating-system metadata. No original game bytes are embedded in source code or test fixtures. The reference fixture contains only filenames, decoded lengths and SHA-256 hashes. The viewer never writes to the original files or runs the DOS programs.

## GitHub Pages later

The Vite build contains only the viewer and its code. Original files are excluded from `dist/`, even when a local `game/` folder exists. The built viewer works without a server API: users select their own local game folder.

`base: './'` keeps generated asset URLs relative so the same build works under a GitHub Pages repository path. When ready, publish `dist/` with a GitHub Pages build workflow; no deployment or remote is configured yet. The root page forwards to `viewer.html`.

References: [Vite setup](https://vite.dev/guide/), [relative base paths](https://vite.dev/config/shared-options.html#base), [GitHub Pages deployment](https://vite.dev/guide/static-deploy.html#github-pages), and [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API). The CMF instrument layout is documented by [AdPlug's CMF reader](https://github.com/adplug/adplug/blob/master/src/cmf.cpp); this viewer implements its own approximate Web Audio synthesizer.
