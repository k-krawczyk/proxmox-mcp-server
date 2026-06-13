import { describe, expect, it } from 'vitest';
import { nodeField, vmidField } from './helpers.js';

describe('shared zod fields', () => {
  it('accepts a positive integer vmid', () => {
    expect(vmidField.parse(100)).toBe(100);
  });

  it('rejects non-positive or fractional vmids', () => {
    expect(vmidField.safeParse(0).success).toBe(false);
    expect(vmidField.safeParse(-1).success).toBe(false);
    expect(vmidField.safeParse(10.5).success).toBe(false);
  });

  it('rejects an empty node name', () => {
    expect(nodeField.safeParse('').success).toBe(false);
    expect(nodeField.safeParse('pve1').success).toBe(true);
  });
});
