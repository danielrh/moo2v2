// Pure-TS xxHash32 plus helpers. Used for state hashing (desync detection),
// DATA_VERSION fingerprints, and RNG stream derivation. Only u32 integer ops.

const P1 = 0x9e3779b1;
const P2 = 0x85ebca77;
const P3 = 0xc2b2ae3d;
const P4 = 0x27d4eb2f;
const P5 = 0x165667b1;

function rotl(x: number, r: number): number {
  return ((x << r) | (x >>> (32 - r))) >>> 0;
}

function readU32LE(b: Uint8Array, i: number): number {
  return (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
}

export function xxhash32(data: Uint8Array, seed: number): number {
  const len = data.length;
  seed = seed >>> 0;
  let h: number;
  let i = 0;

  if (len >= 16) {
    let a1 = (seed + P1 + P2) >>> 0;
    let a2 = (seed + P2) >>> 0;
    let a3 = seed >>> 0;
    let a4 = (seed - P1) >>> 0;
    const limit = len - 16;
    while (i <= limit) {
      a1 = (Math.imul(rotl((a1 + Math.imul(readU32LE(data, i), P2)) >>> 0, 13), P1)) >>> 0;
      a2 = (Math.imul(rotl((a2 + Math.imul(readU32LE(data, i + 4), P2)) >>> 0, 13), P1)) >>> 0;
      a3 = (Math.imul(rotl((a3 + Math.imul(readU32LE(data, i + 8), P2)) >>> 0, 13), P1)) >>> 0;
      a4 = (Math.imul(rotl((a4 + Math.imul(readU32LE(data, i + 12), P2)) >>> 0, 13), P1)) >>> 0;
      i += 16;
    }
    h = (rotl(a1, 1) + rotl(a2, 7) + rotl(a3, 12) + rotl(a4, 18)) >>> 0;
  } else {
    h = (seed + P5) >>> 0;
  }

  h = (h + len) >>> 0;

  while (i + 4 <= len) {
    h = (Math.imul(rotl((h + Math.imul(readU32LE(data, i), P3)) >>> 0, 17), P4)) >>> 0;
    i += 4;
  }
  while (i < len) {
    h = (Math.imul(rotl((h + Math.imul(data[i]!, P5)) >>> 0, 11), P1)) >>> 0;
    i++;
  }

  h ^= h >>> 15;
  h = Math.imul(h, P2) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, P3) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

/** 64-bit-strength fingerprint as 16 hex chars (two independent xxhash32 lanes). */
export function hashBytes(data: Uint8Array): string {
  return hex8(xxhash32(data, 0)) + hex8(xxhash32(data, P1));
}

const TE = new TextEncoder();

export function hashString(s: string): string {
  return hashBytes(TE.encode(s));
}
