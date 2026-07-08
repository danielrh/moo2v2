import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from './index';

describe('engine scaffold', () => {
  it('exports a semver version', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
