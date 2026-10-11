// Sanity test — Vitest запускается, всё на месте.

import { describe, it, expect } from 'vitest';

describe('oilgame Phase 0', () => {
  it('vitest is alive', () => {
    expect(1 + 1).toBe(2);
  });
});
