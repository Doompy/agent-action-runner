# Audit Redaction

Audit events are useful only when they are safe to keep. Agent Action Runner gives applications control over how much action `input`, `output`, and `error` data is written to audit hooks.

`v0.6.2` keeps the previous default behavior for patch compatibility:

```ts
createRunner({
  auditDefaults: {
    input: 'full',
    output: 'full',
    error: 'full',
  },
});
```

For production systems, prefer explicit minimization:

```ts
const runner = createRunner({
  auditDefaults: {
    input: 'hash',
    output: 'summary',
    error: 'summary',
    redactPaths: ['/password', '/token', '/secret'],
  },
  audit: createAuditHook(auditStore),
});
```

## Action Overrides

Use `auditPolicy` when one action needs stricter handling than the runner default:

```ts
runner.registerAction({
  name: 'admin.disableUser',
  mode: 'mutate',
  approvalRequired: true,
  auditPolicy: {
    input: 'hash',
    output: 'summary',
    error: 'summary',
    redactPaths: ['/reason', '/profile/email'],
  },
  handler: async (input, ctx) => {
    ctx.requireApproval();
    return adminService.disableUser(input.userId, input.reason);
  },
});
```

Action-level modes override runner defaults field by field. Runner and action `redactPaths` are merged and de-duplicated.

## Modes

| Field | Supported Modes |
|---|---|
| `input` | `full`, `redacted`, `hash`, `omit` |
| `output` | `full`, `redacted`, `summary`, `hash`, `omit` |
| `error` | `full`, `redacted`, `summary`, `omit` |

Mode behavior:

- `full`: store the payload after path redaction.
- `redacted`: store the fixed string `"[REDACTED]"`.
- `hash`: store `{ hash }` after path redaction using `createStableHash()`.
- `summary`: for `output`, store only `outputSummary`; for `error`, store `{ name, message }`.
- `omit`: leave the field undefined so JSON serialization omits it.

`output: 'summary'` uses the runner `summarizeOutput` hook when supplied. If the hook returns no summary, core falls back to a simple JSON/string summary.

## JSON Pointer Redaction

`redactPaths` supports exact JSON Pointer paths:

```ts
redactPaths: [
  '/password',
  '/profile/email',
  '/items/0/token',
]
```

Missing paths are ignored. Wildcards, globs, and regex paths are not supported in `v0.6.2`.

Redaction happens before mode handling. For example, `input: 'hash'` hashes the redacted payload, not the raw payload.

## Approval Tokens

Audit events never include the raw `approvalToken`. When a token is present, events include `approvalTokenHash`.

`approvalTokenHash` is a redacted audit correlation fingerprint. It is not a secure token storage scheme by itself. Approval stores should use secret-backed HMACs or sufficiently random tokens, plus expiry and single-use consumption where mutations are involved.

## Recommended Production Baseline

```ts
createRunner({
  auditDefaults: {
    input: 'hash',
    output: 'summary',
    error: 'summary',
    redactPaths: [
      '/password',
      '/token',
      '/secret',
      '/authorization',
      '/profile/email',
      '/profile/phone',
    ],
  },
});
```

Adjust paths to your domain. The runner cannot know which business fields are sensitive.
