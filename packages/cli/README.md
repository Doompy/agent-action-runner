# @agent-action-runner/cli

CLI for Agent Action Runner local development.

The CLI supports manifest-based inspection plus compiled runner module smoke-runs. It does not auto-discover NestJS, Express, or Fastify applications.

## Install

```bash
npm install -D @agent-action-runner/cli @modelcontextprotocol/sdk
```

## Commands

```bash
agent-action-runner init
agent-action-runner actions:list
agent-action-runner actions:inspect delivery.searchJobs
agent-action-runner workflow:validate ./agent-workflows/example.workflow.json
agent-action-runner workflow:run ./agent-workflows/example.workflow.json --runner ./dist/agent-runner.js
agent-action-runner mcp:preview
agent-action-runner mcp:serve --runner ./dist/agent-runner.js
agent-action-runner doctor
agent-action-runner docs:generate
```

Configuration is read from `agent-runner.config.json` by default.

Runner commands import compiled ESM JavaScript that exports `runner` or default exports an `AgentActionRunner` instance. `workflow:run` defaults to `read`, `draft`, and `dryRun`; use `--allow-mutate` only for intentional local/dev smoke-runs where the runner's approval hook is configured.

`@modelcontextprotocol/sdk` is a peer dependency for `mcp:serve`.
