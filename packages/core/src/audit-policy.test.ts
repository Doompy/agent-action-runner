import { describe, expect, it } from 'vitest';
import { InvalidAuditPolicyError } from './errors.js';
import { transformAuditPayload } from './audit-policy.js';
import type { ExecutableActionDefinition } from './types.js';

const baseAction: ExecutableActionDefinition = {
  name: 'audit.test',
  mode: 'read',
  handler: () => undefined,
};

describe('audit payload policy', () => {
  it('keeps full payloads by default', () => {
    const result = transformAuditPayload({
      action: baseAction,
      input: { visible: true },
      output: { ok: true },
    });

    expect(result).toEqual({
      input: { visible: true },
      output: { ok: true },
    });
  });

  it('redacts exact object, array, and escaped JSON Pointer paths', () => {
    const result = transformAuditPayload({
      action: baseAction,
      auditDefaults: {
        redactPaths: [
          '/password',
          '/items/0/token',
          '/a~1b',
          '/a~0b',
          '/missing/path',
        ],
      },
      input: {
        password: 'secret-password',
        items: [
          {
            token: 'secret-token',
          },
        ],
        'a/b': 'slash-secret',
        'a~b': 'tilde-secret',
        visible: 'kept',
      },
    });

    expect(result.input).toEqual({
      password: '[REDACTED]',
      items: [
        {
          token: '[REDACTED]',
        },
      ],
      'a/b': '[REDACTED]',
      'a~b': '[REDACTED]',
      visible: 'kept',
    });
  });

  it('merges and de-duplicates runner and action redact paths', () => {
    const result = transformAuditPayload({
      action: {
        ...baseAction,
        auditPolicy: {
          redactPaths: ['/actionSecret', '/globalSecret'],
        },
      },
      auditDefaults: {
        redactPaths: ['/globalSecret', '/defaultSecret'],
      },
      input: {
        actionSecret: 'action',
        defaultSecret: 'default',
        globalSecret: 'global',
      },
    });

    expect(result.input).toEqual({
      actionSecret: '[REDACTED]',
      defaultSecret: '[REDACTED]',
      globalSecret: '[REDACTED]',
    });
  });

  it('supports redacted, hash, summary, and omit modes', () => {
    const hashResult = transformAuditPayload({
      action: baseAction,
      auditDefaults: {
        input: 'hash',
        output: 'hash',
      },
      input: { token: 'input-token' },
      output: { token: 'output-token' },
    });
    expect(hashResult.input).toEqual({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(hashResult.output).toEqual({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(hashResult)).not.toContain('input-token');
    expect(JSON.stringify(hashResult)).not.toContain('output-token');

    const redactedResult = transformAuditPayload({
      action: baseAction,
      auditDefaults: {
        input: 'redacted',
      },
      input: { token: 'input-token' },
    });
    expect(redactedResult.input).toBe('[REDACTED]');

    const omittedResult = transformAuditPayload({
      action: baseAction,
      auditDefaults: {
        input: 'omit',
        output: 'omit',
      },
      input: { token: 'input-token' },
      output: { token: 'output-token' },
    });
    expect(omittedResult).toEqual({
      input: undefined,
    });
  });

  it('does not serialize full output in default summary fallback', () => {
    const result = transformAuditPayload({
      action: baseAction,
      auditDefaults: {
        output: 'summary',
      },
      input: {},
      output: {
        token: 'secret-output-token',
        nested: {
          password: 'secret-output-password',
        },
      },
    });

    expect(result).toEqual({
      input: {},
      outputSummary: 'object',
    });
    expect(JSON.stringify(result)).not.toContain('secret-output-token');
    expect(JSON.stringify(result)).not.toContain('secret-output-password');
  });

  it('summarizes arrays and primitive outputs without exposing values', () => {
    expect(transformAuditPayload({
      action: baseAction,
      auditDefaults: { output: 'summary' },
      input: {},
      output: ['secret-1', 'secret-2'],
    }).outputSummary).toBe('array(length=2)');
    expect(transformAuditPayload({
      action: baseAction,
      auditDefaults: { output: 'summary' },
      input: {},
      output: 'secret-string',
    }).outputSummary).toBe('string');
    expect(transformAuditPayload({
      action: baseAction,
      auditDefaults: { output: 'summary' },
      input: {},
      output: null,
    }).outputSummary).toBe('null');
  });

  it('uses custom summarizeOutput when configured', () => {
    const result = transformAuditPayload({
      action: baseAction,
      auditDefaults: {
        output: 'summary',
      },
      input: {},
      output: { token: 'secret-output-token' },
      summarizeOutput: () => 'custom summary',
    });

    expect(result.outputSummary).toBe('custom summary');
    expect(JSON.stringify(result)).not.toContain('secret-output-token');
  });

  it('summarizes errors without stack or cause fields', () => {
    const cause = new Error('root cause secret');
    const error = Object.assign(new Error('public failure'), {
      cause,
      detail: {
        token: 'secret-error-token',
      },
    });

    const result = transformAuditPayload({
      action: baseAction,
      auditDefaults: {
        error: 'summary',
        redactPaths: ['/detail/token'],
      },
      input: {},
      error,
    });

    expect(result.error).toEqual({
      name: 'Error',
      message: 'public failure',
    });
    expect(JSON.stringify(result)).not.toContain('secret-error-token');
    expect(JSON.stringify(result)).not.toContain('root cause secret');
    expect(JSON.stringify(result)).not.toContain('stack');
  });

  it('clones Error objects for full redaction, including serializable stack fields', () => {
    const error = Object.assign(new Error('failed with token'), {
      detail: {
        token: 'secret-error-token',
      },
    });

    const result = transformAuditPayload({
      action: baseAction,
      auditDefaults: {
        error: 'full',
        redactPaths: ['/detail/token'],
      },
      input: {},
      error,
    });

    expect(result.error).toEqual(expect.objectContaining({
      name: 'Error',
      message: 'failed with token',
      stack: expect.any(String),
      detail: {
        token: '[REDACTED]',
      },
    }));
    expect(JSON.stringify(result)).not.toContain('secret-error-token');
  });

  it('preserves Date values when cloning for redaction', () => {
    const createdAt = new Date('2026-05-09T00:00:00.000Z');
    const result = transformAuditPayload({
      action: baseAction,
      auditDefaults: {
        redactPaths: ['/token'],
      },
      input: {
        createdAt,
        token: 'secret-token',
      },
    });

    expect((result.input as { createdAt: Date }).createdAt).toBeInstanceOf(Date);
    expect((result.input as { createdAt: Date }).createdAt).not.toBe(createdAt);
    expect(result.input).toEqual({
      createdAt,
      token: '[REDACTED]',
    });
  });

  it('supports empty JSON Pointer as full payload redaction', () => {
    const result = transformAuditPayload({
      action: baseAction,
      auditDefaults: {
        redactPaths: [''],
      },
      input: {
        token: 'secret-token',
      },
    });

    expect(result.input).toBe('[REDACTED]');
  });

  it('handles circular objects during redaction without recursing forever', () => {
    const input: { token: string; self?: unknown } = {
      token: 'secret-token',
    };
    input.self = input;

    const result = transformAuditPayload({
      action: baseAction,
      auditDefaults: {
        redactPaths: ['/token'],
      },
      input,
    });
    const redactedInput = result.input as { token: string; self: unknown };

    expect(redactedInput.token).toBe('[REDACTED]');
    expect(redactedInput.self).toBe(redactedInput);
  });

  it('throws for invalid redact paths', () => {
    expect(() => transformAuditPayload({
      action: baseAction,
      auditDefaults: {
        redactPaths: ['password'] as never,
      },
      input: {},
    })).toThrow(InvalidAuditPolicyError);
  });
});
