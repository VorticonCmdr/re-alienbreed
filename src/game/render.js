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
