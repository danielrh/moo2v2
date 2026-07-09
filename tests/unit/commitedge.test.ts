import { describe, expect, it } from 'vitest';
import { latchEdge, type EdgeLatch } from '@ui/commitEdge';

describe('commit edge latch (bug: opponents flash the screen by commit/uncommit cycling)', () => {
  it('escalates and never de-escalates within one planning turn', () => {
    let l: EdgeLatch = { turn: 0, level: '' };
    l = latchEdge(l, 5, 'planning', '');
    expect(l).toEqual({ turn: 5, level: '' });
    l = latchEdge(l, 5, 'planning', 'green');
    expect(l.level).toBe('green');
    // opponent uncommits: raw edge drops, latch holds
    l = latchEdge(l, 5, 'planning', '');
    expect(l.level).toBe('green');
    l = latchEdge(l, 5, 'planning', 'red');
    expect(l.level).toBe('red');
    // repeated commit/uncommit cycling can no longer change what is shown
    l = latchEdge(l, 5, 'planning', '');
    expect(l.level).toBe('red');
    l = latchEdge(l, 5, 'planning', 'green');
    expect(l.level).toBe('red');
    l = latchEdge(l, 5, 'planning', 'red');
    expect(l.level).toBe('red');
  });

  it('resets when the turn advances', () => {
    let l: EdgeLatch = { turn: 5, level: 'red' };
    l = latchEdge(l, 6, 'planning', '');
    expect(l).toEqual({ turn: 6, level: '' });
  });

  it('clears outside the planning phase (battle orders)', () => {
    let l: EdgeLatch = { turn: 5, level: 'red' };
    l = latchEdge(l, 5, 'battle_orders', '');
    expect(l).toEqual({ turn: 5, level: '' });
    // returning to planning on the same turn does not resurrect the old level
    l = latchEdge(l, 5, 'planning', '');
    expect(l.level).toBe('');
  });

  it('returns the same object when nothing changes (no re-render churn)', () => {
    const l: EdgeLatch = { turn: 5, level: 'red' };
    expect(latchEdge(l, 5, 'planning', 'green')).toBe(l);
    expect(latchEdge(l, 5, 'planning', 'red')).toBe(l);
  });
});
