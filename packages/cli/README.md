# @agent-action-runner/cli

CLI for Agent Action Runner local development.

The CLI starts with manifest-based commands. It does not auto-discover NestJS, Express, or Fastify applications.

## Install

```bash
npm install -D @agent-action-runner/cli
```

## Commands

```bash
agent-action-runner init
agent-action-runner actions:list
agent-action-runner actions:inspect delivery.searchJobs
agent-action-runner workflow:validate ./agent-workflows/example.workflow.json
agent-action-runner mcp:preview
agent-action-runner doctor
agent-action-runner docs:generate
```

Configuration is read from `agent-runner.config.json` by default.
