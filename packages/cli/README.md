# @agent-action-runner/cli

CLI for Agent Action Runner local development.

Use the CLI to inspect registered actions, validate workflow JSON, run local read/dryRun smoke workflows, generate action docs, and preview or serve MCP tools. It is a development helper, not a production scheduler or authorization layer.

The CLI does not auto-discover NestJS decorators, Express routes, Fastify plugins, or TypeScript source. Runner-based commands import compiled ESM JavaScript that exports a core `AgentActionRunner`.

The CLI is for inspecting and smoke-running registered actions. It does not execute agent-generated TypeScript.

Experimental / pre-1.0.

## Install

```bash
npm install -D @agent-action-runner/cli @modelcontextprotocol/sdk
```

`@modelcontextprotocol/sdk` is a peer dependency used by `mcp:serve`.

Runner-based schema export uses Zod 4 JSON Schema conversion. Core can execute actions with Zod 3 or Zod 4 schemas, but CLI manifest schema serialization is Zod 4 based. If a runner exports Zod v3 schemas, CLI schema serialization may mark them as `schemaNotSerializable`.

You can also run commands with:

```bash
npx @agent-action-runner/cli --help
```

The binary name is `agent-action-runner`.

## Typical Local Loop

```txt
compile runner module
  -> export/inspect action manifest
  -> validate workflow JSON
  -> run read/dryRun workflow smoke test
  -> preview or serve MCP tools
```

## Initialize Files

```bash
agent-action-runner init
```

Creates:

```txt
agent-runner.config.json
.agent-runner/actions.json
agent-workflows/example.workflow.json
```

Use `--force` to overwrite existing generated files.

## Config

The CLI reads `agent-runner.config.json` by default.

```json
{
  "manifest": "./.agent-runner/actions.json",
  "runner": "./dist/agent-runner.js",
  "workflowsDir": "./agent-workflows",
  "mcp": {
    "exposeModes": ["read", "draft", "dryRun"],
    "exposeMutations": false
  }
}
```

Use `--config <path>` to point at a different config file. JSON config is currently supported; TypeScript config loading is intentionally out of scope.

## Manifest-Based Commands

List actions:

```bash
agent-action-runner actions:list
agent-action-runner actions:list --json
```

Inspect one action:

```bash
agent-action-runner actions:inspect delivery.searchJobs
agent-action-runner actions:inspect delivery.searchJobs --json
```

Preview MCP export from a manifest:

```bash
agent-action-runner mcp:preview
agent-action-runner mcp:preview --expose-mutations
agent-action-runner mcp:preview --json
```

Run safety checks:

```bash
agent-action-runner doctor
agent-action-runner doctor --json
```

Generate Markdown docs:

```bash
agent-action-runner docs:generate
agent-action-runner docs:generate --out docs/agent-actions.md
```

## Runner-Based Commands

Runner modules must be compiled ESM JavaScript and export either:

```ts
export const runner = createRunner();
```

or:

```ts
export default runner;
```

Export a manifest from a live runner:

```bash
agent-action-runner actions:export \
  --runner ./dist/agent-runner.js \
  --out ./.agent-runner/actions.json
```

List or inspect directly from the runner:

```bash
agent-action-runner actions:list --runner ./dist/agent-runner.js
agent-action-runner actions:inspect delivery.searchJobs --runner ./dist/agent-runner.js
```

Serializable Zod 4 schemas are written as JSON Schema. Non-serializable schemas are marked with `schemaNotSerializable`.

Generate OpenAPI 3.1 documentation from a runner:

```bash
agent-action-runner actions:openapi \
  --runner ./dist/agent-runner.js \
  --out docs/agent-actions.openapi.json
```

OpenAPI export is intended for documentation, QA, and security review. It does not create a production auth boundary.

Generated paths use the URL-encoded original action name to match the HTTP adapter route shape. For example, `math.double` becomes `/actions/math.double/execute`, while path-unsafe characters such as `/` are encoded. `operationId` remains a sanitized identifier such as `math_double`.

## Workflow Validation

Validate workflow JSON against the manifest:

```bash
agent-action-runner workflow:validate ./agent-workflows/retry.workflow.json
```

Validate against the actual compiled runner action catalog:

```bash
agent-action-runner workflow:validate ./agent-workflows/retry.workflow.json \
  --runner ./dist/agent-runner.js \
  --format json
```

Validation catches duplicate step ids, unknown actions, invalid modes, invalid previous step references, and unsupported input values.

It also validates workflow reliability controls such as `timeoutMs`, `retry.maxAttempts`, `retry.delayMs`, and `continueOnError`.

Explain a workflow:

```bash
agent-action-runner workflow:explain ./agent-workflows/retry.workflow.json \
  --runner ./dist/agent-runner.js
```

Generate a Mermaid dependency graph:

```bash
agent-action-runner workflow:graph ./agent-workflows/retry.workflow.json \
  --runner ./dist/agent-runner.js \
  --out docs/retry-workflow.mmd
```

The graph uses explicit step references only. It does not invent hidden sequential dependencies.

## Workflow Run

Run a workflow locally:

```bash
agent-action-runner workflow:run ./agent-workflows/retry.workflow.json \
  --runner ./dist/agent-runner.js
```

Defaults:

- `userId`: `AGENT_RUNNER_USER_ID` or `local_user`
- allowed modes: `read`, `draft`, `dryRun`
- output: JSON

Options:

```bash
agent-action-runner workflow:run ./agent-workflows/retry.workflow.json \
  --runner ./dist/agent-runner.js \
  --user-id operator_1 \
  --metadata-json '{"source":"local-cli"}'
```

`mutate` is blocked unless you pass `--allow-mutate`, and the core approval hook still decides whether mutation succeeds.

```bash
agent-action-runner workflow:run ./agent-workflows/retry.workflow.json \
  --runner ./dist/agent-runner.js \
  --allow-mutate
```

Use mutate mode only for intentional local/dev smoke-runs.

## MCP Commands

Preview tools from a manifest or runner:

```bash
agent-action-runner mcp:preview
agent-action-runner mcp:preview --runner ./dist/agent-runner.js --json
```

Serve the runner over MCP stdio:

```bash
agent-action-runner mcp:serve --runner ./dist/agent-runner.js
```

Use `AGENT_RUNNER_USER_ID` or `--user-id` to set the server-side user id.

```bash
AGENT_RUNNER_USER_ID=demo_user agent-action-runner mcp:serve --runner ./dist/agent-runner.js
```

Do not write normal logs to stdout from the runner module when serving over stdio. stdout is reserved for the MCP transport.

## Manifest Format

```json
{
  "version": 1,
  "actions": [
    {
      "name": "delivery.searchJobs",
      "mode": "read",
      "description": "Search delivery jobs by filters.",
      "tags": ["delivery", "operations"],
      "resourceType": "deliveryJob",
      "riskLevel": "low",
      "approvalRequired": false,
      "inputSchema": {
        "type": "object"
      },
      "outputSchema": {
        "type": "object"
      }
    }
  ]
}
```

## Commands

```txt
agent-action-runner init
agent-action-runner actions:list
agent-action-runner actions:inspect <actionName>
agent-action-runner actions:export --runner <file>
agent-action-runner actions:openapi --runner <file>
agent-action-runner workflow:validate <file>
agent-action-runner workflow:explain <file>
agent-action-runner workflow:graph <file>
agent-action-runner workflow:run <file>
agent-action-runner mcp:preview
agent-action-runner mcp:serve
agent-action-runner doctor
agent-action-runner docs:generate
```

Most read commands support `--json` or `--format json`.

## Example

See `examples/cli-basic` for a compiled runner module, a sample workflow, and MCP preview commands.

## License

Apache-2.0
