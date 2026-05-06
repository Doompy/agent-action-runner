# MCP Stdio Example

Runnable MCP stdio server example for Agent Action Runner.

## Run

```bash
npm install
npm run build --workspace agent-action-runner-mcp-stdio-example
node examples/mcp-stdio/dist/index.js
```

The server speaks MCP over stdio. It does not write normal logs to stdout.

## Example MCP Client Config

```json
{
  "mcpServers": {
    "agent-action-runner-stdio": {
      "command": "node",
      "args": ["C:/dev/agent-action-runner/examples/mcp-stdio/dist/index.js"],
      "env": {
        "AGENT_RUNNER_USER_ID": "demo_user"
      }
    }
  }
}
```

## Exported Tools

- `math_double`
- `delivery_searchJobs`
- `delivery_dryRunRetry`

The tools are backed by registered Agent Action Runner actions and still run through core schema validation, mode checks, policy, approval, and audit hooks.
