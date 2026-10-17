// Read-only access to tables inside the user's ALIEN.EXE, addressed as in the Ghidra project
// (image loaded at segment 0x1000). No bytes from the executable are copied into this repository.
export const KNOWN_BUILDS = {
  '0787a2ca63e712ef1e2278fd5a78d9a0ea1e9ca0197398ab9e4cb684b067e0c7': 'ALIEN.EXE (passcode compare skipped)',
  '8d998048583420402d9296918d1f119eb34c40980aa31bdd2b1fbe504728ac2a': 'ALIEN.EX_ (original)',
};
const HEADER_BYTES = 0x800, IMAGE_SEGMENT = 0x1000;

export async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(v => v.toString(16).padStart(2, '0')).join('');
}

export async function openExe(bytes) {
  const hash = await sha256(bytes);
  if (!KNOWN_BUILDS[hash]) throw new Error(`Unsupported executable (SHA-256 ${hash}). Supply the IBM PC ALIEN.EXE this port was verified against.`);
  return exeView(bytes, KNOWN_BUILDS[hash]);
}

// Synchronous view for callers that already verified the hash.
export function exeView(bytes, build = 'unverified') {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (seg, off) => {
    const position = HEADER_BYTES + (seg - IMAGE_SEGMENT) * 16 + off;
    if (seg < IMAGE_SEGMENT || position < HEADER_BYTES || position >= bytes.length) throw new Error(`Address ${seg.toString(16)}:${off.toString(16)} is outside the executable image`);
    return position;
  };
  return {
    build,
    u8: (seg, off) => bytes[at(seg, off)],
    u16: (seg, off) => view.getUint16(at(seg, off), true),
    s16: (seg, off) => view.getInt16(at(seg, off), true),
    bytes: (seg, off, length) => bytes.slice(at(seg, off), at(seg, off) + length),
    string(seg, off) { let p = at(seg, off), s = ''; while (bytes[p]) s += String.fromCharCode(bytes[p++]); return s; },
  };
}
