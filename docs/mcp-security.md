# MCP Security

`@agent-action-runner/mcp` exports registered actions as MCP tools. The exporter should be treated as another exposure surface for your backend action boundary.

## Defaults

- `read`, `draft`, and `dryRun` actions are exportable by default.
- `mutate` actions are not exported by default.
- `mutate` actions can be exported only with explicit opt-in and approval gating.
- Tool descriptions include mode, approval, risk, resource, tag, and deprecation metadata when available.

## STDIO Transport

STDIO MCP servers are best suited for local trusted development or controlled internal environments. Do not write regular logs to stdout because stdout is reserved for MCP messages. Use stderr for diagnostics.

Credentials for STDIO servers usually come from the local environment. Treat environment variables and local config files as sensitive.

## HTTP Transport

When exposing MCP over HTTP, put the MCP server behind your application authentication and authorization boundary. The MCP exporter does not replace OAuth, session auth, API gateway policy, or network controls.

Use server-side resolvers for:

- user id
- allowed modes
- approval token
- approval context
- request metadata

Do not accept these values from model-controlled tool input.

## Mutation Tools

Keep mutation export rare. A mutation tool should be:

- `mode: 'mutate'`
- `approvalRequired: true`
- protected by application policy
- audited with minimized payloads
- implemented by an idempotent or transaction-safe service method

If a mutation cannot be safely retried or audited, keep it out of MCP.

## Schema Serialization

MCP JSON Schema serialization is based on Zod 4. Core can execute Zod 3 schemas for runtime validation, but MCP-exported tools should use Zod 4-compatible schemas.

Use `createMcpToolReport()` or the CLI `mcp:preview` command to see why an action was skipped.
