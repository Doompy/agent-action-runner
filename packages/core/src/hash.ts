import { createHash } from 'node:crypto';

export function createStableHash(value: unknown): string {
  return createHash('sha256')
    .update(stableStringify(value))
    .digest('hex');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value, new WeakSet()));
}

function normalizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value;
  }

  if (value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      throw new TypeError('Cannot hash circular input values.');
    }

    seen.add(value);
    const normalized = Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeValue(entryValue, seen)]),
    );
    seen.delete(value);

    return normalized;
  }

  return String(value);
}
