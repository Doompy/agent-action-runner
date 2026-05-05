# @agent-action-runner/fastify

Fastify adapter for Agent Action Runner.

Experimental / pre-1.0.

## Install

```bash
npm install @agent-action-runner/core @agent-action-runner/http @agent-action-runner/fastify fastify zod
```

## Quickstart

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

The adapter exposes:

- `GET /actions`
- `POST /actions/:name/execute`
- `POST /workflows/execute`

`getUserId` is required so identity is resolved server-side. Client-supplied execution options are ignored unless `allowClientExecutionOptions` is explicitly enabled.
