# Agent Action Runner

A TypeScript backend action layer for AI agent tool-calling.

Instead of rewriting the same service logic as separate agent tools, MCP handlers, HTTP endpoints, workflow steps, and local smoke-test scripts, register existing service methods once as actions and reuse them across surfaces.

Expose existing service logic as agent-callable actions with schema validation, policy guards, dry-run, human approval, and audit logging without giving agents direct database, internal API, or arbitrary code execution access.

Agent Action Runner is about controlled API reuse. It does not run agent-generated TypeScript or arbitrary code; agents can only call actions your application has registered.

## Status

Experimental / pre-1.0. Public APIs may change while the action, workflow, and approval contracts settle.

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

Contributor tooling in this repository expects Node.js `>=20`. Published packages target consumer runtimes on Node.js `>=18.18`.

This repository starts with a framework-agnostic core package and first-party framework adapters:

- Action registry
- Sequential JSON workflow runner
- Zod input and output validation
- Action mode enforcement
- Policy, approval, and audit hooks
- Audit payload minimization for input, output, and error data
- Restricted step output references
- Action metadata for API reuse documentation and MCP descriptions
- Workflow retry, timeout, and continue-on-error controls
- Idempotency key propagation for retry-safe mutation handlers
- NestJS `@AgentAction()` provider discovery
- Express and Fastify HTTP adapters

## Packages

| Package | Purpose |
|---|---|
| `@agent-action-runner/core` | Framework-agnostic action registry, JSON workflow runner, validation, policy, approval, audit, and workflow builder. |
| `@agent-action-runner/nestjs` | NestJS `@AgentAction()` decorator, provider discovery, and shared runner injection. |
| `@agent-action-runner/http` | Shared HTTP request handling, response shapes, and error mapping for adapter authors. |
| `@agent-action-runner/express` | Express routes for listing actions and executing actions or workflows. |
| `@agent-action-runner/fastify` | Fastify plugin for listing actions and executing actions or workflows. |
| `@agent-action-runner/mcp` | MCP exporter that turns eligible registered actions into MCP tools. |
| `@agent-action-runner/cli` | Local development CLI for manifests, workflow validation, runner smoke-runs, docs generation, and MCP previews. |

## API Reuse Boundary

The recommended shape is:

```txt
existing service method
  -> registered Agent Action
  -> JSON Workflow
  -> policy / approval / audit
  -> HTTP, CLI, or MCP exposure
```

Your backend remains responsible for authentication, authorization, transactions, and side effects. The runner gives agents a narrow boundary for calling existing business logic safely.

See [API Reuse Guide](./docs/api-reuse.md) for the recommended service wrapping pattern.

Core action execution supports Zod 3 and Zod 4 schemas. MCP and CLI JSON Schema serialization are based on Zod 4; use Zod 4 for actions you want to export as MCP tools or manifest schemas.

For production approval/audit persistence direction, see [Prisma Approval And Audit Pattern](./docs/prisma-approval-audit.md).

For audit minimization and security guidance, see [Audit Redaction](./docs/audit-redaction.md) and [Security Model](./docs/security.md).

## Core Quickstart

```bash
npm install @agent-action-runner/core zod
```

## Example

```ts
import { createRunner, fromStep } from '@agent-action-runner/core';
import { z } from 'zod';

const runner = createRunner({
  audit: async (event) => {
    console.log(event.actionName, event.status);
  },
});

runner.registerAction({
  name: 'delivery.searchJobs',
  mode: 'read',
  description: 'Search delivery jobs by filters.',
  inputSchema: z.object({
    status: z.array(z.string()).optional(),
    campaignId: z.string().optional(),
    from: z.string(),
    to: z.string(),
  }),
  outputSchema: z.object({
    jobIds: z.array(z.string()),
  }),
  handler: async (input) => {
    return { jobIds: ['job_1', 'job_2'] };
  },
});

runner.registerAction({
  name: 'delivery.dryRunRetry',
  mode: 'dryRun',
  inputSchema: z.object({
    jobIds: z.array(z.string()),
  }),
  handler: async (input) => {
    return { retryable: input.jobIds, blocked: [] };
  },
});

const result = await runner.executeWorkflow({
  userId: 'user_1',
  workflow: {
    workflowName: 'retry-failed-delivery-jobs',
    steps: [
      {
        id: 'jobs',
        action: 'delivery.searchJobs',
        input: {
          status: ['FAILED'],
          from: '2026-05-01',
          to: '2026-05-06',
        },
        timeoutMs: 1000,
        retry: {
          maxAttempts: 2,
          delayMs: 50,
        },
      },
      {
        id: 'dryRun',
        action: 'delivery.dryRunRetry',
        input: {
          jobIds: fromStep('jobs', '/jobIds'),
        },
      },
    ],
  },
});
```

`timeoutMs` marks an attempt as failed; it does not cancel work that already started in Node.js. For `mutate` actions with retry, design the underlying service around idempotency keys, transactions, and single-use approval consumption.

## Idempotency For Mutations

`idempotencyKey` is passed to the handler context and is intended for your service or transaction layer. The runner does not generate keys, store keys, lock resources, or replay results because those rules are domain-specific.

```ts
await runner.executeAction({
  userId: 'operator_1',
  action: 'delivery.executeRetry',
  input: { jobIds: ['job_1'] },
  allowedModes: ['mutate'],
  approvalToken,
  approvalContext,
  idempotencyKey: `retry:job_1:${dryRunHash}`,
});

runner.registerAction({
  name: 'delivery.executeRetry',
  mode: 'mutate',
  approvalRequired: true,
  handler: async (input, ctx) => {
    ctx.requireApproval();
    return deliveryService.retryWithIdempotency(input.jobIds, {
      operatorId: ctx.userId,
      idempotencyKey: ctx.idempotencyKey,
    });
  },
});
```

Audit events never store the raw `idempotencyKey`; when present, they include `idempotencyKeyHash` as a redacted fingerprint for correlation.

## Audit Data Minimization

By default, audit payload behavior remains compatible with earlier releases:

```ts
createRunner({
  auditDefaults: {
    input: 'full',
    output: 'full',
    error: 'full',
  },
});
```

For production systems, configure audit defaults to store less data:

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

Individual actions can override the runner defaults:

```ts
runner.registerAction({
  name: 'admin.disableUser',
  mode: 'mutate',
  approvalRequired: true,
  auditPolicy: {
    input: 'hash',
    output: 'summary',
    error: 'summary',
    redactPaths: ['/reason', '/email'],
  },
  handler: async (input, ctx) => {
    ctx.requireApproval();
    return adminService.disableUser(input.userId, input.reason);
  },
});
```

`redactPaths` uses exact JSON Pointer paths only. Wildcards, globs, and regex paths are intentionally out of scope for now.

## Workflow Builder Quickstart

Use the builder when you want TypeScript to check action inputs and previous step references while still producing the same JSON workflow definition.

```ts
import {
  createRunner,
  defineAction,
  defineActionCatalog,
  defineWorkflow,
  registerActionCatalog,
} from '@agent-action-runner/core';
import { z } from 'zod';

const runner = createRunner();
const actions = defineActionCatalog({
  searchJobs: defineAction({
    name: 'delivery.searchJobs',
    mode: 'read',
    inputSchema: z.object({ status: z.array(z.string()) }),
    outputSchema: z.object({ jobIds: z.array(z.string()) }),
    handler: () => ({ jobIds: ['job_1'] }),
  }),
  dryRunRetry: defineAction({
    name: 'delivery.dryRunRetry',
    mode: 'dryRun',
    inputSchema: z.object({ jobIds: z.array(z.string()) }),
    handler: (input) => ({ retryable: input.jobIds }),
  }),
});

registerActionCatalog(runner, actions);

const workflow = defineWorkflow('retry-failed-jobs')
  .step('jobs', actions.searchJobs, { status: ['FAILED'] })
  .step('dryRun', actions.dryRunRetry, ({ fromStep }) => ({
    jobIds: fromStep('jobs', '/jobIds'),
  }))
  .build();
```

The builder does not execute TypeScript. It only creates a `WorkflowDefinition` for the existing JSON workflow runner.

## Workflow Reliability

Workflow steps can define simple execution controls:

```json
{
  "id": "jobs",
  "action": "delivery.searchJobs",
  "input": {
    "status": ["FAILED"]
  },
  "timeoutMs": 1000,
  "retry": {
    "maxAttempts": 2,
    "delayMs": 50
  },
  "continueOnError": false
}
```

`retry.maxAttempts` includes the first attempt. `timeoutMs` marks an attempt as failed after the duration, but it does not forcibly cancel underlying Node.js work that has already started.

## CLI Quickstart

The CLI is for local development: inspect action manifests, validate workflow JSON, preview MCP exports, and generate action docs.

```bash
npx @agent-action-runner/cli init
npx @agent-action-runner/cli actions:list
npx @agent-action-runner/cli workflow:validate ./agent-workflows/example.workflow.json
npx @agent-action-runner/cli workflow:validate ./agent-workflows/example.workflow.json --runner ./dist/agent-runner.js --format json
npx @agent-action-runner/cli workflow:run ./agent-workflows/example.workflow.json --runner ./dist/agent-runner.js
npx @agent-action-runner/cli mcp:preview
npx @agent-action-runner/cli mcp:serve --runner ./dist/agent-runner.js
npx @agent-action-runner/cli actions:export --runner ./dist/agent-runner.js --out ./.agent-runner/actions.json
npx @agent-action-runner/cli doctor
```

The CLI reads `agent-runner.config.json` and `.agent-runner/actions.json`. Runner module commands use compiled ESM JavaScript and expect the module to export `runner` or default export an `AgentActionRunner` instance. It does not auto-discover NestJS decorators, Express routes, Fastify plugins, or TypeScript source.

See [examples/cli-basic](./examples/cli-basic) for a local runner module, sample workflow, and MCP preview flow.

The intended local loop is: compile a dev runner module, export/inspect actions, validate workflow JSON, run read/dryRun smoke workflows, then preview or serve MCP tools.

## NestJS Quickstart

```bash
npm install @agent-action-runner/core @agent-action-runner/nestjs zod
```

```ts
import { Injectable, Module } from '@nestjs/common';
import { AgentAction, AgentRunnerModule } from '@agent-action-runner/nestjs';
import { z } from 'zod';

@Injectable()
class DeliveryAgentActions {
  @AgentAction({
    name: 'delivery.searchJobs',
    mode: 'read',
    inputSchema: z.object({
      status: z.array(z.string()),
    }),
  })
  searchJobs(input: { status: string[] }) {
    return { jobIds: ['job_1', 'job_2'] };
  }
}

@Module({
  imports: [
    AgentRunnerModule.forRoot({
      audit: async (event) => {
        console.log(event.actionName, event.status);
      },
    }),
  ],
  providers: [DeliveryAgentActions],
})
export class AppModule {}
```

Decorated provider methods are registered into the shared core runner during NestJS module initialization. Use `InjectAgentRunner()` or the `AGENT_RUNNER` token when you need to execute actions or workflows from another NestJS provider.

## Express Quickstart

```bash
npm install @agent-action-runner/core @agent-action-runner/http @agent-action-runner/express express zod
```

```ts
import express from 'express';
import { createRunner } from '@agent-action-runner/core';
import { createExpressAdapter } from '@agent-action-runner/express';

const app = express();
const runner = createRunner();

app.use('/agent-runner', createExpressAdapter(runner, {
  getUserId: (req) => req.header('x-user-id') ?? 'user_1',
}));
```

## Fastify Quickstart

```bash
npm install @agent-action-runner/core @agent-action-runner/http @agent-action-runner/fastify fastify zod
```

```ts
import Fastify from 'fastify';
import { createRunner } from '@agent-action-runner/core';
import { agentRunnerFastifyPlugin } from '@agent-action-runner/fastify';

const app = Fastify();
const runner = createRunner();

await app.register(agentRunnerFastifyPlugin, {
  prefix: '/agent-runner',
  runner,
  getUserId: async (request) => request.headers['x-user-id']?.toString() ?? 'user_1',
});
```

The HTTP adapters expose `GET /actions`, `POST /actions/:name/execute`, and `POST /workflows/execute`. Server-side resolver hooks control user identity, allowed modes, approval tokens, approval context, and metadata.

## MCP Quickstart

```bash
npm install @agent-action-runner/core @agent-action-runner/mcp @modelcontextprotocol/sdk zod
```

```ts
import { createRunner } from '@agent-action-runner/core';
import { createMcpExporter } from '@agent-action-runner/mcp';
import { z } from 'zod';

const runner = createRunner();

runner.registerAction({
  name: 'delivery.searchJobs',
  mode: 'read',
  inputSchema: z.object({
    status: z.array(z.string()),
  }),
  handler: async (input) => {
    return { jobIds: [`job_${input.status[0]}`] };
  },
});

const mcpServer = createMcpExporter(runner, {
  getUserId: () => 'user_1',
});
```

The MCP exporter registers eligible actions as MCP tools. By default, only `read`, `draft`, and `dryRun` actions are exported. `mutate` actions require explicit opt-in and still go through core mode checks, approval hooks, and audit hooks.

## MCP Examples

- [MCP Stdio](./examples/mcp-stdio) shows a runnable stdio MCP server with simple read and dry-run actions.
- [MCP Admin Ops](./examples/mcp-admin-ops) shows the shared admin ops actions exported as MCP tools while keeping `admin.disableUser` hidden by default.

Both examples use server-side user id resolution and avoid writing normal logs to stdout because stdout is reserved for the MCP stdio transport.

## Operational Examples

The admin ops examples show the intended safety model for operational mutations:

```txt
read -> dryRun -> approve -> mutate -> audit
```

- [Express Admin Ops](./examples/express-admin-ops) shows the HTTP adapter wiring.
- [NestJS Admin Ops](./examples/nestjs-admin-ops) shows NestJS DI and `@AgentAction()` discovery.
- [Fastify Admin Ops](./examples/fastify-admin-ops) shows the Fastify plugin wiring.
- [Persistent Admin Ops](./examples/persistent-admin-ops) shows the same flow with file-backed approval records and append-only audit JSONL.
- [Delivery Ops](./examples/delivery-ops) shows the domain workflow for retrying failed delivery jobs through search, dry-run, approval, retry execution, and audit.

The adapter examples demonstrate `admin.searchUsers`, `admin.dryRunDisableUser`, and `admin.disableUser` with an HMAC-bound approval token and an in-memory audit trail.

The persistent example uses the same actions with file-backed approval/audit storage. It stores approval token hashes instead of raw tokens, binds approvals to `userId`, `actionName`, `inputHash`, `resourceIds`, `dryRunHash`, and `expiresAt`, and persists `started`, `succeeded`, and `failed` audit events without storing the raw approval token.

The delivery example also includes a CLI config, action manifest, generated-style action docs, and a JSON workflow for local workflow validation and read/dryRun smoke-runs.

## Mutate Approval Model

`mutate` actions are blocked by default unless the execution explicitly allows `mutate` mode and the configured approval hook approves the request.

The approval hook receives:

```ts
{
  approvalToken?: string;
  approvalContext: {
    userId: string;
    actionName: string;
    mode: 'read' | 'draft' | 'dryRun' | 'mutate';
    inputHash: string;
    resourceIds?: readonly string[];
    dryRunHash?: string;
    expiresAt?: string;
    workflowId?: string;
    stepId?: string;
  };
}
```

Core does not issue or sign approval tokens. Applications should bind approval tokens to the approval context fields they care about, especially `userId`, `actionName`, `mode`, `inputHash`, `resourceIds`, `dryRunHash`, and `expiresAt`.

Audit `approvalTokenHash` values are redacted fingerprints for correlation, not secure approval token storage. Approval stores should use secret-backed HMACs or sufficiently random approval tokens.

## License

Licensed under the Apache License, Version 2.0.
