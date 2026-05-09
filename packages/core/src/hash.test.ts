import { describe, expect, it } from 'vitest';
import { createStableHash } from './hash.js';

describe('createStableHash', () => {
  it('treats undefined object properties as absent for JSON-compatible hashing', () => {
    expect(createStableHash({})).toBe(createStableHash({ optional: undefined }));
  });

  it('keeps undefined array items as null-equivalent positions', () => {
    expect(createStableHash([undefined])).toBe(createStableHash([null]));
    expect(createStableHash([undefined])).not.toBe(createStableHash([]));
  });
});
