// Commit-urgency edge with a one-way latch. Within a planning turn the edge
// may only escalate ('' -> green -> red); it never steps back down, so an
// opponent cycling commit/uncommit cannot flash the screen. The latch resets
// when the turn number changes or the game leaves the planning phase.

export type EdgeLevel = '' | 'green' | 'red';

export interface EdgeLatch {
  turn: number;
  level: EdgeLevel;
}

const RANK: Record<EdgeLevel, number> = { '': 0, green: 1, red: 2 };

export function latchEdge(prev: EdgeLatch, turn: number, phase: string, edge: EdgeLevel): EdgeLatch {
  if (phase !== 'planning') {
    return prev.turn === turn && prev.level === '' ? prev : { turn, level: '' };
  }
  if (prev.turn !== turn) return { turn, level: edge };
  return RANK[edge] > RANK[prev.level] ? { turn, level: edge } : prev;
}
