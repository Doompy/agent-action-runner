# MCP Admin Ops Example

Runnable MCP stdio server example using the shared admin ops domain.

## Run

```bash
npm install
npm run build --workspace agent-action-runner-mcp-admin-ops-example
node examples/mcp-admin-ops/dist/index.js
```

The server speaks MCP over stdio. It does not write normal logs to stdout.

## Example MCP Client Config

```json
{
  "mcpServers": {
    "agent-action-runner-admin-ops": {
      "command": "node",
      "args": ["C:/dev/agent-action-runner/examples/mcp-admin-ops/dist/index.js"],
      "env": {
        "AGENT_RUNNER_USER_ID": "demo_admin"
      }
    }
  }
}
```

## Safety Defaults

Exported by default:

- `admin_searchUsers`
- `admin_dryRunDisableUser`

Not exported by default:

- `admin.disableUser`

`admin.disableUser` is a `mutate` action, so the MCP exporter keeps it hidden unless mutation export is explicitly enabled and the action remains approval-gated.
