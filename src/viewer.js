import { category, extension, decodeAsset, rgba, grayscale, hexDump } from './formats.js';
import { AssetPlayer, wavFile } from './audio.js';

const $ = id => document.getElementById(id);
const labels = { all: 'All assets', images: 'Images', sounds: 'Sounds', music: 'Music', maps: 'Maps', other: 'Other files' };
const cache = new Map();
let assets = [], visible = [], filter = 'all', selected = null, current = null, selectionVersion = 0, libraryVersion = 0;
let palette = grayscale, palettePath = 'PANEL.VHF', paletteVersion = 0, thumbnailObserver;
const sizeLabel = size => size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
const timeLabel = time => `${Math.floor(time / 60)}:${Math.floor(time % 60).toString().padStart(2, '0')}`;
const player = new AssetPlayer(state => {
  $('play').textContent = state.playing ? 'Ⅱ Pause' : '▶ Play';
  $('elapsed').textContent = timeLabel(state.position); $('duration').textContent = timeLabel(state.duration);
  $('seek').max = state.duration || 1; $('seek').value = state.position;
  const head = document.querySelector('.playhead'); if (head) head.style.left = `${state.duration ? state.position / state.duration * 100 : 0}%`;
});

function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
function download(blob, name) {
  const link = document.createElement('a'), url = URL.createObjectURL(blob); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function read(asset) {
  if (asset.file) return new Uint8Array(await asset.file.arrayBuffer());
  const response = await fetch(`./game/${asset.path.split('/').map(encodeURIComponent).join('/')}`);
  if (!response.ok) throw new Error(`Could not read ${asset.path} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}
async function decode(asset) {
  if (!cache.has(asset.path)) cache.set(asset.path, read(asset).then(bytes => decodeAsset(asset.path, bytes)));
  return cache.get(asset.path);
}
function makeCanvas(image, colors, transparent = false) {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d').putImageData(new ImageData(rgba(image, colors, transparent), image.width, image.height), 0, 0);
  return canvas;
}
function categories() {
  $('categories').replaceChildren();
  for (const [key, label] of Object.entries(labels)) {
    const count = key === 'all' ? assets.length : assets.filter(asset => asset.kind === key).length;
    const button = document.createElement('button'); button.className = `category${filter === key ? ' active' : ''}`;
    button.setAttribute('aria-pressed', filter === key); button.append(document.createTextNode(label));
    const badge = document.createElement('span'); badge.textContent = count; button.append(badge);
    button.onclick = () => { filter = key; categories(); renderList(); }; $('categories').append(button);
  }
}
function renderList() {
  thumbnailObserver?.disconnect();
  visible = assets.filter(asset => (filter === 'all' || asset.kind === filter) && asset.path.toLowerCase().includes($('search').value.toLowerCase()));
  $('list-label').textContent = labels[filter].toUpperCase(); $('list-count').textContent = visible.length;
  $('asset-list').replaceChildren();
  const generation = libraryVersion;
  thumbnailObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      thumbnailObserver.unobserve(entry.target);
      const asset = assets.find(asset => asset.path === entry.target.dataset.path);
      decode(asset).then(result => {
        if (generation !== libraryVersion) return;
        const icon = entry.target.querySelector('.file-icon'); icon.replaceChildren(makeCanvas(result.image, result.image.palette || palette));
      }).catch(() => { /* Selection shows decoding errors in full. */ });
    }
  }, { root: $('asset-list'), rootMargin: '80px' });
  for (const asset of visible) {
    const button = document.createElement('button'); button.className = `asset-row${selected?.path === asset.path ? ' selected' : ''}`;
    button.dataset.path = asset.path; button.setAttribute('aria-label', asset.path); button.setAttribute('aria-pressed', selected?.path === asset.path);
    const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = asset.kind === 'sounds' ? '♫' : asset.kind === 'music' ? '♪' : (asset.ext || 'RAW').toUpperCase();
    const info = document.createElement('span'); info.className = 'file-info';
    const name = document.createElement('strong'); name.textContent = asset.path.split('/').pop();
    const details = document.createElement('small'); const folder = asset.path.includes('/') ? asset.path.slice(0, asset.path.lastIndexOf('/')) : 'game';
    details.textContent = `${folder} / ${sizeLabel(asset.size)}`; info.append(name, details);
    const dot = document.createElement('span'); dot.className = 'row-dot'; dot.textContent = '↗'; button.append(icon, info, dot);
    button.onclick = () => selectAsset(asset); $('asset-list').append(button); if (asset.kind === 'images') thumbnailObserver.observe(button);
  }
  if (!visible.length) { const message = document.createElement('p'); message.className = 'no-results'; message.textContent = assets.length ? 'No files match your search.' : 'Open your game folder to browse the archive.'; $('asset-list').append(message); }
}
function updateSelectedRow() {
  for (const row of document.querySelectorAll('.asset-row')) {
    const active = row.dataset.path === selected?.path; row.classList.toggle('selected', active); row.setAttribute('aria-pressed', active);
  }
}
async function loadPalette() {
  const generation = libraryVersion, version = ++paletteVersion;
  const source = assets.find(asset => asset.path === palettePath);
  const result = source ? (await decode(source)).image?.palette : grayscale;
  if (generation !== libraryVersion || version !== paletteVersion) return;
  palette = result || grayscale;
  if (current?.ext === 'ehf') renderImage(current);
  renderList();
}
function paletteOptions() {
  $('palette-select').replaceChildren();
  for (const asset of assets.filter(asset => ['vhf', '256'].includes(asset.ext))) {
    const option = document.createElement('option'); option.value = asset.path; option.textContent = asset.path; $('palette-select').append(option);
  }
  const option = document.createElement('option'); option.value = 'grayscale'; option.textContent = 'Grayscale'; $('palette-select').append(option);
  palettePath = assets.find(asset => asset.path.toUpperCase().endsWith('PANEL.VHF'))?.path || 'grayscale';
  $('palette-select').value = palettePath;
}
async function setLibrary(files, source) {
  libraryVersion++; selectionVersion++; cache.clear(); player.load(null); current = null; selected = null; palette = grayscale;
  assets = files.filter(asset => !asset.path.split('/').some(part => part.startsWith('.'))).map(asset => ({ ...asset, kind: category(asset.path), ext: extension(asset.path) }));
  assets.sort((a, b) => a.path.localeCompare(b.path)); $('source-label').textContent = `${source} / ${assets.length} FILES`;
  $('catalog-status').textContent = `${assets.length} original files · read only`; filter = 'all'; $('search').value = ''; categories(); paletteOptions(); renderList();
  try { await loadPalette(); } catch (error) { notice(`Could not load the default palette: ${error.message}. Grayscale is available.`); }
  const requested = new URL(location.href).searchParams.get('asset');
  const first = assets.find(asset => asset.path === requested) || assets.find(asset => asset.path.toUpperCase().endsWith('TITLE.VHF')) || assets[0];
  if (first) await selectAsset(first); else resetPreview();
}
function resetPreview() {
  for (const id of ['toolbar', 'image-controls', 'palette', 'palette-controls', 'playback', 'preview-note', 'byte-inspector', 'download-preview', 'download-decoded']) $(id).hidden = true;
  $('metadata').replaceChildren(); $('preview').className = 'preview'; $('preview').replaceChildren();
}
function meta(entries) {
  $('metadata').replaceChildren();
  for (const [term, value] of entries) {
    const div = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = term; dd.textContent = value; div.append(dt, dd); $('metadata').append(div);
  }
}
function note(message) { $('preview-note').textContent = message; $('preview-note').hidden = !message; }
async function selectAsset(asset) {
  const version = ++selectionVersion; selected = asset; current = null; player.load(null); updateSelectedRow(); resetPreview();
  $('asset-name').textContent = asset.path.split('/').pop(); $('asset-path').textContent = `game / ${asset.path}`;
  $('asset-kind').textContent = `${labels[asset.kind].toUpperCase()} / ORIGINAL ASSET`; $('format-badge').textContent = (asset.ext || 'RAW').toUpperCase();
  const loading = document.createElement('p'); loading.className = 'muted'; loading.textContent = 'Reading original file…'; $('preview').append(loading);
  const url = new URL(location.href); url.searchParams.set('asset', asset.path); history.replaceState(null, '', url);
  try {
    const result = await decode(asset); if (version !== selectionVersion) return;
    current = result; $('toolbar').hidden = false; $('byte-inspector').hidden = false;
    $('hex-offset').value = 0; $('byte-source').value = result.decoded !== result.raw ? 'decoded' : 'raw';
    $('byte-source').querySelector('[value=decoded]').disabled = result.decoded === result.raw;
    $('download-decoded').hidden = result.decoded === result.raw;
    const entries = [['Original size', sizeLabel(result.raw.length)], ['Storage', result.decoded === result.raw ? 'Uncompressed' : 'LZHUF compressed']];
    if (result.decoded !== result.raw) entries.push(['Decoded size', sizeLabel(result.decoded.length)]);
    if (result.image) {
      $('image-controls').hidden = false; $('download-preview').hidden = false; $('download-preview').textContent = '↓ Save PNG';
      renderImage(result); entries.push(['Dimensions', '320 × 200 px'], ['Color depth', result.ext === 'ehf' ? '4-bit / 16 colors' : '8-bit / 256 colors']);
      note(result.ext === 'ehf' ? 'Four planar sprite planes reconstructed into a sheet. Palette and color-0 transparency are preview choices; frame boundaries are not yet identified.' : 'Original indexed pixels and embedded VGA palette. The grid is an optional guide, not a verified frame layout.');
    } else if (result.sound || result.music) {
      renderChart(result); $('playback').hidden = false; player.load(result);
      if (result.sound) {
        $('download-preview').hidden = false; $('download-preview').textContent = '↓ Save WAV';
        entries.push(['Audio', '8-bit PCM / mono'], ['Sample rate', `${result.sound.sampleRate.toFixed(2)} Hz`], ['Duration', `${result.sound.duration.toFixed(2)} s`]);
        note('Original VOC sample decoded to PCM. Playback and WAV export use the stored sample rate.');
      } else {
        entries.push(['Tracks', result.music.trackCount], ['Notes', result.music.notes.length], ['Duration', `${result.music.duration.toFixed(2)} s`], ['Clock', result.music.ticksPerSecond ? `${result.music.ticksPerSecond} ticks/s` : `${result.music.ticksPerQuarter} ticks/quarter`]);
        if (result.ext === 'cmf') entries.push(['FM instruments', result.music.patches.length]);
        note((result.ext === 'cmf' ? 'Synth preview: two-operator FM uses the file’s instrument patches, with approximate envelopes and percussion. This is not an OPL emulator.' : result.ext === 'bep' ? 'Synth preview: square-wave voices play the original MIDI score. PC-speaker voice arbitration is not emulated.' : 'Synth preview: browser oscillator voices play the original MIDI score. Roland MT-32 instruments are not emulated.') + (result.music.warnings.length ? ` ${result.music.warnings.join('. ')}.` : ''));
      }
    } else if (result.text) {
      const pre = document.createElement('pre'); pre.className = 'text-preview'; pre.textContent = result.text; $('preview').replaceChildren(pre); entries.push(['Contents', 'Plain text']);
    } else if (result.kind === 'maps') {
      renderMap(result); entries.push(['Contents', 'Map resource / schema unknown']);
      note('Exploratory byte raster: each decoded byte is a grayscale pixel. This is not a decoded level. Change the row width or offset to inspect patterns.');
    } else {
      const card = document.createElement('div'); card.className = 'binary-card';
      const title = document.createElement('p'); title.className = 'binary-title'; title.textContent = result.raw[0] === 77 && result.raw[1] === 90 ? 'DOS EXECUTABLE / MZ HEADER' : 'BINARY DATA / INSPECTION PREVIEW';
      const pre = document.createElement('pre'); pre.textContent = hexDump(result.decoded, 0, 256); card.append(title, pre); $('preview').replaceChildren(card);
      entries.push(['Contents', 'Binary data']); note('Inspect the full file below. Binary drivers and programs contain code and are not playable audio assets.');
    }
    meta(entries); renderHex();
  } catch (error) {
    if (version !== selectionVersion) return;
    const card = document.createElement('div'); card.className = 'empty-state'; const title = document.createElement('h3'); title.textContent = 'Unable to decode this file';
    const message = document.createElement('p'); message.textContent = error.message; card.append(title, message); $('preview').replaceChildren(card);
    // Preserve a useful binary view when an unfamiliar or damaged file cannot be decoded.
    try {
      const raw = await read(asset); if (version !== selectionVersion) return;
      current = { ...asset, raw, decoded: raw }; $('toolbar').hidden = false; $('byte-inspector').hidden = false; $('byte-source').value = 'raw';
      $('byte-source').querySelector('[value=decoded]').disabled = true; $('hex-offset').value = 0; meta([['Original size', sizeLabel(raw.length)], ['Preview', 'Raw bytes only']]); renderHex();
    } catch { /* The read error is already visible. */ }
  }
}
function renderImage(result) {
  const colors = result.image.palette || palette, shell = document.createElement('div'); shell.className = 'image-shell';
  const canvas = makeCanvas(result.image, colors, $('transparent').checked); canvas.setAttribute('aria-label', `${result.path} image preview`); shell.append(canvas);
  const overlay = document.createElement('div'); overlay.className = 'grid-overlay'; overlay.hidden = !$('grid').checked; shell.append(overlay);
  $('preview').className = 'preview image-preview'; $('preview').replaceChildren(shell); resizeImage();
  $('palette').hidden = false; $('palette').replaceChildren();
  for (let index = 0; index < (result.ext === 'ehf' ? 16 : 256); index++) {
    const swatch = document.createElement('span'); swatch.className = 'swatch'; const rgb = colors.slice(index * 3, index * 3 + 3);
    swatch.style.backgroundColor = `rgb(${rgb.join(',')})`; swatch.title = `${index}: RGB ${rgb.join(', ')}`; $('palette').append(swatch);
  }
  $('palette-controls').hidden = result.ext !== 'ehf';
}
function resizeImage() {
  const shell = document.querySelector('.image-shell'); if (!shell) return;
  const available = Math.max(160, $('preview').clientWidth - 50), zoom = $('zoom').value;
  const width = zoom === 'fit' ? Math.min(960, available) : 320 * Number(zoom); shell.style.width = `${width}px`; shell.style.height = `${width * 200 / 320}px`;
  shell.querySelector('.grid-overlay').style.backgroundSize = `${width / 20}px ${width / 20}px`;
}
new ResizeObserver(resizeImage).observe($('preview'));
function renderChart(result) {
  const shell = document.createElement('div'); shell.className = 'chart-shell';
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 250; const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#121a16'; ctx.fillRect(0, 0, 960, 250); ctx.strokeStyle = '#283626'; ctx.lineWidth = 1;
  for (let x = 0; x <= 960; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 250); ctx.stroke(); }
  for (let y = 0; y <= 250; y += 25) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(960, y); ctx.stroke(); }
  if (result.sound) {
    const samples = result.sound.samples; ctx.strokeStyle = '#b7eb7b';
    for (let x = 0; x < 960; x++) {
      const start = Math.floor(x * samples.length / 960), end = Math.max(start + 1, Math.floor((x + 1) * samples.length / 960)); let low = 0, high = 0;
      for (let i = start; i < Math.min(end, samples.length); i++) { low = Math.min(low, samples[i]); high = Math.max(high, samples[i]); }
      ctx.beginPath(); ctx.moveTo(x + 0.5, 125 + low * 110); ctx.lineTo(x + 0.5, 125 + high * 110); ctx.stroke();
    }
  } else {
    const { notes, duration } = result.music, low = Math.min(36, ...notes.map(n => n.midi)), high = Math.max(84, ...notes.map(n => n.midi));
    for (const note of notes) {
      ctx.fillStyle = `hsl(${80 + note.channel * 17} 55% ${40 + note.velocity * 25}%)`;
      ctx.fillRect(note.time / duration * 960, 235 - (note.midi - low) / (high - low + 1) * 220, Math.max(2, note.duration / duration * 960), Math.max(2, 200 / (high - low + 1)));
    }
  }
  const head = document.createElement('div'); head.className = 'playhead'; shell.append(canvas, head);
  shell.onclick = event => { const bounds = shell.getBoundingClientRect(); player.seek((event.clientX - bounds.left) / bounds.width * player.duration).catch(showPlaybackError); };
  const caption = document.createElement('div'); caption.className = 'chart-labels'; caption.append(document.createTextNode(result.sound ? 'PCM WAVEFORM / MONO' : 'NOTE EVENTS / PIANO ROLL'));
  const end = document.createElement('span'); end.textContent = timeLabel(result.sound?.duration || result.music.duration); caption.append(end);
  $('preview').className = 'preview chart-preview'; $('preview').replaceChildren(shell, caption);
}
function renderMap(result) {
  const content = document.createElement('div'); content.className = 'map-content'; const controls = document.createElement('div'); controls.className = 'map-controls';
  function number(label, value, max) {
    const wrapper = document.createElement('label'), input = document.createElement('input'); input.type = 'number'; input.min = 1; input.max = max; input.value = value; wrapper.append(document.createTextNode(label), input); controls.append(wrapper); return input;
  }
  const width = number('Row width', 128, 1024), offset = number('Offset', 0, result.decoded.length - 1); offset.min = 0;
  const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', 'Exploratory map byte raster');
  function draw() {
    const w = Math.max(1, Math.min(1024, Number(width.value) || 128)), start = Math.max(0, Math.min(result.decoded.length - 1, Number(offset.value) || 0));
    const h = Math.ceil((result.decoded.length - start) / w); canvas.width = w; canvas.height = h;
    const pixels = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { const value = result.decoded[start + i] || 0; pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = value; pixels[i * 4 + 3] = 255; }
    canvas.getContext('2d').putImageData(new ImageData(pixels, w, h), 0, 0); canvas.style.width = `${Math.min(640, w * 3)}px`;
  }
  width.oninput = offset.oninput = draw; content.append(controls, canvas); $('preview').replaceChildren(content); draw();
}
function renderHex() {
  if (!current) return;
  const bytes = current[$('byte-source').value], max = Math.max(0, Math.floor((bytes.length - 1) / 16) * 16);
  const offset = Math.max(0, Math.min(max, Math.floor((Number($('hex-offset').value) || 0) / 16) * 16));
  $('hex-offset').value = offset; $('hex-offset').max = max; $('hex-output').textContent = hexDump(bytes, offset);
  $('hex-prev').disabled = offset === 0; $('hex-next').disabled = offset + 512 >= bytes.length;
}
function showPlaybackError(error) { note(`Playback could not start: ${error.message}`); }
$('play').onclick = () => player.playing ? player.pause() : player.play().catch(showPlaybackError);
$('stop').onclick = () => player.stop(); $('volume').oninput = () => player.setVolume(Number($('volume').value));
$('seek').oninput = () => player.seek(Number($('seek').value)).catch(showPlaybackError);
$('search').oninput = renderList;
$('choose-folder').onclick = () => $('folder-input').click(); $('empty-open').onclick = () => $('folder-input').click();
$('folder-input').onchange = async event => {
  const files = [...event.target.files].map(file => ({ file, path: file.webkitRelativePath.split('/').slice(1).join('/') || file.name, size: file.size }));
  if (!files.length) return; notice(''); await setLibrary(files, 'LOCAL FOLDER'); event.target.value = '';
};
$('palette-select').onchange = async () => { palettePath = $('palette-select').value; try { await loadPalette(); } catch (error) { notice(error.message); } };
$('zoom').onchange = resizeImage;
$('grid').onchange = () => { const overlay = document.querySelector('.grid-overlay'); if (overlay) overlay.hidden = !$('grid').checked; };
$('transparent').onchange = () => { if (current?.image) renderImage(current); };
$('byte-source').onchange = () => { $('hex-offset').value = 0; renderHex(); }; $('hex-offset').onchange = renderHex;
$('hex-prev').onclick = () => { $('hex-offset').value = Number($('hex-offset').value) - 512; renderHex(); };
$('hex-next').onclick = () => { $('hex-offset').value = Number($('hex-offset').value) + 512; renderHex(); };
$('download-original').onclick = () => { if (current) download(new Blob([current.raw]), current.path.split('/').pop()); };
$('download-decoded').onclick = () => { if (current) download(new Blob([current.decoded]), `${current.path.split('/').pop()}.decoded`); };
$('download-preview').onclick = () => {
  if (current?.sound) download(wavFile(current.sound), `${current.path.split('/').pop().replace(/\.voc$/i, '')}.wav`);
  else if (current?.image) { const selectedAsset = current; const canvas = makeCanvas(current.image, current.image.palette || palette, $('transparent').checked); canvas.toBlob(blob => { if (blob) download(blob, `${selectedAsset.path.split('/').pop()}.png`); }); }
};
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { player.stop(); $('search').blur(); return; }
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
  if (event.key === '/') { event.preventDefault(); $('search').focus(); }
  if (['ArrowDown', 'ArrowUp'].includes(event.key) && visible.length) {
    event.preventDefault(); const index = visible.findIndex(asset => asset.path === selected?.path);
    selectAsset(visible[(index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length]);
    document.querySelector('.asset-row.selected')?.scrollIntoView({ block: 'nearest' });
  }
});
window.addEventListener('pagehide', () => player.stop());

categories(); renderList();
if (import.meta.env.DEV) {
  try {
    const response = await fetch('./__game_catalog'); if (!response.ok) throw new Error('Local asset catalog is unavailable');
    const files = await response.json(); if (!Array.isArray(files)) throw new Error('Invalid local asset catalog');
    if (files.length) await setLibrary(files, 'GAME FOLDER');
    else { $('source-label').textContent = 'NO GAME FILES'; notice('Place your original files in game/ or use Open game folder.'); }
  } catch (error) { $('source-label').textContent = 'OPEN A LOCAL FOLDER'; notice(error.message + '. Use Open game folder to load your files.'); }
} else {
  $('source-label').textContent = 'LOCAL FILES ONLY'; notice('Open your original game folder to start. Files are read in your browser and are not uploaded.');
}
