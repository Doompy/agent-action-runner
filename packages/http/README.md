# @agent-action-runner/http

Shared HTTP adapter utilities for Agent Action Runner.

Experimental / pre-1.0. This package is intended for framework adapter authors and powers the official Express and Fastify adapters.

## Contract

- `GET /actions`
- `POST /actions/:name/execute`
- `POST /workflows/execute`

HTTP adapters should resolve `userId` on the server. Client-supplied execution options such as `allowedModes`, `approvalToken`, and `approvalContext` are ignored unless the adapter explicitly enables client execution options.
