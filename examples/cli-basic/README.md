# CLI Basic Example

This example shows the CLI workflow for a compiled local runner module.

```bash
npm run build --workspace agent-action-runner-cli-basic-example
npx @agent-action-runner/cli actions:list --config examples/cli-basic/agent-runner.config.json
npx @agent-action-runner/cli workflow:validate examples/cli-basic/workflows/retry-failed.workflow.json --config examples/cli-basic/agent-runner.config.json
npx @agent-action-runner/cli workflow:validate examples/cli-basic/workflows/retry-failed.workflow.json --config examples/cli-basic/agent-runner.config.json --runner examples/cli-basic/dist/agent-runner.js --format json
npx @agent-action-runner/cli workflow:run examples/cli-basic/workflows/retry-failed.workflow.json --config examples/cli-basic/agent-runner.config.json --runner examples/cli-basic/dist/agent-runner.js
npx @agent-action-runner/cli mcp:preview --config examples/cli-basic/agent-runner.config.json --runner examples/cli-basic/dist/agent-runner.js
```

`workflow:run` defaults to `read`, `draft`, and `dryRun` modes. `mutate` requires `--allow-mutate`, and core approval hooks still decide whether the action can execute.

To serve the runner over MCP stdio for local inspection:

```bash
npx @agent-action-runner/cli mcp:serve --config examples/cli-basic/agent-runner.config.json --runner examples/cli-basic/dist/agent-runner.js
```
