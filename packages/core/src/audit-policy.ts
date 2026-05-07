import { createStableHash } from './hash.js';
import type {
  AuditPayloadPolicy,
  ExecutableActionDefinition,
  JsonPointer,
} from './types.js';

const REDACTED = '[REDACTED]';

type ResolvedAuditPayloadPolicy = {
  readonly input: NonNullable<AuditPayloadPolicy['input']>;
  readonly output: NonNullable<AuditPayloadPolicy['output']>;
  readonly error: NonNullable<AuditPayloadPolicy['error']>;
  readonly redactPaths: readonly JsonPointer[];
};

export type AuditPayloadTransformInput = {
  readonly action: ExecutableActionDefinition;
  readonly auditDefaults?: AuditPayloadPolicy;
  readonly error?: unknown;
  readonly input: unknown;
  readonly output?: unknown;
  readonly summarizeOutput?: (output: unknown) => string | undefined;
};

export type AuditPayloadTransformResult = {
  readonly input: unknown;
  readonly output?: unknown;
  readonly outputSummary?: string;
  readonly error?: unknown;
};

export function transformAuditPayload(
  input: AuditPayloadTransformInput,
): AuditPayloadTransformResult {
  const policy = resolveAuditPayloadPolicy(input.auditDefaults, input.action.auditPolicy);
  const redactedInput = redactJsonPointers(input.input, policy.redactPaths);
  const result: AuditPayloadTransformResult = {
    input: applyPayloadMode(redactedInput, policy.input),
  };

  if ('output' in input) {
    const redactedOutput = redactJsonPointers(input.output, policy.redactPaths);
    const transformedOutput = applyPayloadMode(redactedOutput, policy.output);
    if (policy.output === 'summary') {
      return {
        ...result,
        outputSummary: input.summarizeOutput?.(redactedOutput) ?? defaultAuditSummary(redactedOutput),
      };
    }
    if (policy.output === 'omit') {
      return result;
    }
    return {
      ...result,
      output: transformedOutput,
      ...(policy.output === 'full' && input.summarizeOutput
        ? { outputSummary: input.summarizeOutput(redactedOutput) }
        : {}),
    };
  }

  if ('error' in input) {
    const redactedError = redactJsonPointers(input.error, policy.redactPaths);
    if (policy.error === 'summary') {
      return {
        ...result,
        error: summarizeError(redactedError),
      };
    }
    if (policy.error === 'omit') {
      return result;
    }
    return {
      ...result,
      error: applyPayloadMode(redactedError, policy.error),
    };
  }

  return result;
}

function resolveAuditPayloadPolicy(
  defaults: AuditPayloadPolicy | undefined,
  actionPolicy: AuditPayloadPolicy | undefined,
): ResolvedAuditPayloadPolicy {
  return {
    input: actionPolicy?.input ?? defaults?.input ?? 'full',
    output: actionPolicy?.output ?? defaults?.output ?? 'full',
    error: actionPolicy?.error ?? defaults?.error ?? 'full',
    redactPaths: uniqueJsonPointers([
      ...(defaults?.redactPaths ?? []),
      ...(actionPolicy?.redactPaths ?? []),
    ]),
  };
}

function uniqueJsonPointers(paths: readonly JsonPointer[]): readonly JsonPointer[] {
  return [...new Set(paths)];
}

function applyPayloadMode(value: unknown, mode: AuditPayloadPolicy['output']): unknown {
  if (mode === 'omit') {
    return undefined;
  }

  if (mode === 'redacted') {
    return REDACTED;
  }

  if (mode === 'hash') {
    return {
      hash: createStableHash(value),
    };
  }

  return value;
}

function redactJsonPointers(value: unknown, paths: readonly JsonPointer[]): unknown {
  if (paths.length === 0) {
    return value;
  }

  if (paths.includes('')) {
    return REDACTED;
  }

  const cloned = cloneForRedaction(value, new WeakMap());
  for (const path of paths) {
    redactJsonPointer(cloned, path);
  }
  return cloned;
}

function redactJsonPointer(value: unknown, pointer: JsonPointer): void {
  const segments = pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cursor = value;
  for (let index = 0; index < segments.length - 1; index += 1) {
    cursor = getContainerValue(cursor, segments[index]);
    if (cursor === undefined) {
      return;
    }
  }

  const target = segments.at(-1);
  if (target === undefined) {
    return;
  }

  setContainerValue(cursor, target, REDACTED);
}

function getContainerValue(container: unknown, key: string): unknown {
  if (Array.isArray(container)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < container.length) {
      return container[index];
    }
    return undefined;
  }

  if (isRecord(container) && Object.prototype.hasOwnProperty.call(container, key)) {
    return container[key];
  }

  return undefined;
}

function setContainerValue(container: unknown, key: string, value: unknown): void {
  if (Array.isArray(container)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < container.length) {
      container[index] = value;
    }
    return;
  }

  if (isRecord(container) && Object.prototype.hasOwnProperty.call(container, key)) {
    container[key] = value;
  }
}

function cloneForRedaction(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'undefined'
  ) {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value);
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, cloneForRedaction(entry, seen)]),
      ),
    };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return seen.get(value);
    }
    const cloned: unknown[] = [];
    seen.set(value, cloned);
    cloned.push(...value.map((item) => cloneForRedaction(item, seen)));
    return cloned;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return seen.get(value);
    }
    const cloned: Record<string, unknown> = {};
    seen.set(value, cloned);
    for (const [key, entry] of Object.entries(value)) {
      cloned[key] = cloneForRedaction(entry, seen);
    }
    return cloned;
  }

  return String(value);
}

function summarizeError(error: unknown): { readonly name?: string; readonly message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  if (isRecord(error) && typeof error.message === 'string') {
    return {
      ...(typeof error.name === 'string' ? { name: error.name } : {}),
      message: error.message,
    };
  }

  return {
    message: String(error),
  };
}

function defaultAuditSummary(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
