// DOM-free renderer: everything draws into a 320x200 indexed framebuffer, so tests and the canvas share one output.
import { MAP_WIDTH, MAP_HEIGHT, TILE } from './level.js';
export const SCREEN_WIDTH = 320, SCREEN_HEIGHT = 200;

export function createFramebuffer() { return new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT); }

// Draws map tiles for a camera whose top-left pixel is (cameraX, cameraY) into rows [top, top + height).
export function drawMap(frame, map, tileStore, cameraX, cameraY, top = 0, height = SCREEN_HEIGHT) {
  for (let y = 0; y < height; y++) {
    const worldY = cameraY + y, row = worldY >> 4, py = worldY & 15, out = (top + y) * SCREEN_WIDTH;
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const worldX = cameraX + x, column = worldX >> 4;
      const inside = row >= 0 && row < MAP_HEIGHT && column >= 0 && column < MAP_WIDTH;
      frame[out + x] = inside ? tileStore[map.tiles[row * MAP_WIDTH + column] * 256 + py * TILE + (worldX & 15)] : 0;
    }
  }
}

export function toRgba(frame, palette, target = new Uint8ClampedArray(frame.length * 4)) {
  for (let i = 0; i < frame.length; i++) {
    const c = frame[i] * 3; target[i * 4] = palette[c]; target[i * 4 + 1] = palette[c + 1]; target[i * 4 + 2] = palette[c + 2]; target[i * 4 + 3] = 255;
  }
  return target;
}

// 1000:6808 for the draw list, then 1000:568E for shots (drawn after the objects). `sheets` maps a descriptor's
// sheet variable (DS address) to its loaded 4-bit sheets; `descriptor(n)` reads frame n from the executable.
export function drawObjects(frame, view, sheets, descriptor, drawSprite, clipBottom) {
  const cam = view.spriteCamera;
  for (const o of view.objects) {
    if (!o.frame) continue;
    const base = descriptor(o.frame), bank = view.frameBanks?.[o.frame], banked = bank === undefined ? base : { ...base, bank };
    const d = o.player2 ? { ...banked, slotIndex: banked.slotIndex + 2 } : banked, sheet = sheets[d.sheetVariable]; // 1000:684A: [9E40] = 1 takes the next sheet
    if (!sheet) throw new Error(`No sprite sheet loaded for frame 0x${o.frame.toString(16)} (variable ${d.sheetVariable.toString(16)})`);
    const x = o.x - d.width / 2 - cam.x + (o.flip ? -d.adjustX : d.adjustX), y = o.y - o.z - d.height - cam.y + d.adjustY;
    drawSprite(frame, d, sheet, x, y, !!o.flip, 0, clipBottom);
  }
}
export function shotFrame(tables, shot, frameCounter, phase) {
  if (shot.type === 1) return 0;
  if (shot.type === 3) return 0xbd + ((frameCounter >> 1) & 7);
  if (shot.type === 5) return tables.fadingShotFrames[shot.counter >> 2];
  const row = shot.type === 6 ? tables.shotPhaseFrames[phase] : tables.shotFrames[shot.type - 2];
  const f = row[shot.direction & 15]; return f === 0xffff ? 0 : f;
}
export function drawShots(frame, view, tables, sheets, descriptor, drawSprite, clipBottom) {
  for (const shot of view.shots) {
    const f = shotFrame(tables, shot, view.frameCounter, view.shotPhase || 0); if (!f) continue;
    const d = descriptor(f), sheet = sheets[d.sheetVariable];
    if (!sheet) throw new Error(`No sprite sheet loaded for shot frame 0x${f.toString(16)}`);
    drawSprite(frame, d, sheet, shot.x - 8 - view.spriteCamera.x + d.adjustX, shot.y - 8 - view.spriteCamera.y + d.adjustY, false, 0, clipBottom);
  }
}
