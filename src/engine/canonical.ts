// Canonical serialization: deterministic JSON with sorted object keys.
//
// This is the single encoding used for state hashing, command payload hashing,
// and snapshot storage. It doubles as a determinism tripwire: any non-integer
// number anywhere in game state throws, catching float leaks at the boundary.

import { hashBytes } from './hash';

export type Canonical =
  | null
  | boolean
  | number
  | string
  | Canonical[]
  | { [key: string]: Canonical };

function write(v: unknown, out: string[], path: string): void {
  if (v === null) {
    out.push('null');
    return;
  }
  switch (typeof v) {
    case 'boolean':
      out.push(v ? 'true' : 'false');
      return;
    case 'number':
      if (!Number.isSafeInteger(v)) {
        throw new Error(`canonical: non-integer number ${v} at ${path}`);
      }
      out.push(String(v === 0 ? 0 : v)); // normalize -0
      return;
    case 'string':
      out.push(JSON.stringify(v));
      return;
    case 'object': {
      if (Array.isArray(v)) {
        out.push('[');
        for (let i = 0; i < v.length; i++) {
          if (i > 0) out.push(',');
          if (v[i] === undefined) throw new Error(`canonical: undefined in array at ${path}[${i}]`);
          write(v[i], out, `${path}[${i}]`);
        }
        out.push(']');
        return;
      }
      const keys = Object.keys(v as object).sort();
      out.push('{');
      let first = true;
      for (const k of keys) {
        const val = (v as Record<string, unknown>)[k];
        if (val === undefined) continue; // absent and undefined are equivalent
        if (!first) out.push(',');
        first = false;
        out.push(JSON.stringify(k), ':');
        write(val, out, `${path}.${k}`);
      }
      out.push('}');
      return;
    }
    default:
      throw new Error(`canonical: unsupported type ${typeof v} at ${path}`);
  }
}

export function canonicalStringify(v: unknown): string {
  if (v === undefined) throw new Error('canonical: undefined at root');
  const out: string[] = [];
  write(v, out, '$');
  return out.join('');
}

const TE = new TextEncoder();

export function canonicalBytes(v: unknown): Uint8Array {
  return TE.encode(canonicalStringify(v));
}

/** 16-hex-char fingerprint of a canonical value. */
export function hashCanonical(v: unknown): string {
  return hashBytes(canonicalBytes(v));
}

/** Deep-parse canonical text back to a value (plain JSON.parse). */
export function canonicalParse(text: string): Canonical {
  return JSON.parse(text) as Canonical;
}
