# @agent-action-runner/express

Express adapter for Agent Action Runner.

Experimental / pre-1.0.

## Install

```bash
npm install @agent-action-runner/core @agent-action-runner/http @agent-action-runner/express express zod
```

## Quickstart

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

The adapter exposes:

- `GET /actions`
- `POST /actions/:name/execute`
- `POST /workflows/execute`

`getUserId` is required so identity is resolved server-side. Client-supplied execution options are ignored unless `allowClientExecutionOptions` is explicitly enabled.
