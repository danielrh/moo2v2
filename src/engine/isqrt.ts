// Exact integer square root. Math.sqrt on doubles is correctly rounded per
// IEEE 754 (unlike the transcendental functions), so it is a safe fast first
// guess; the correction loop guarantees exactness for all inputs we allow.

const MAX_INPUT = 2 ** 48;

export function isqrt(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`isqrt: bad input ${n}`);
  if (n >= MAX_INPUT) throw new Error(`isqrt: input too large ${n}`);
  if (n === 0) return 0;
  let x = Math.floor(Math.sqrt(n)); // boundaries-allow: Math.sqrt is correctly rounded (IEEE 754)
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

/** Integer distance between two points in fixed-point units. */
export function idist(dx: number, dy: number): number {
  return isqrt(dx * dx + dy * dy);
}
