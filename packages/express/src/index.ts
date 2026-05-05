import express, { Router } from 'express';
import type { Request, Response } from 'express';
import type { AgentActionRunner } from '@agent-action-runner/core';
import {
  createActionListResponse,
  executeHttpAction,
  executeHttpWorkflow,
  mapAgentRunnerError,
  resolveAgentHttpRequestContext,
} from '@agent-action-runner/http';
import type { AgentHttpAdapterOptions } from '@agent-action-runner/http';

export type ExpressAgentRunnerAdapterOptions = AgentHttpAdapterOptions<Request>;

export function createExpressAdapter(
  runner: AgentActionRunner,
  options: ExpressAgentRunnerAdapterOptions,
): Router {
  const router = Router();

  router.use(express.json());

  router.get('/actions', (_request, response) => {
    response.json(createActionListResponse(runner));
  });

  router.post('/actions/:name/execute', async (request, response) => {
    try {
      const context = await resolveAgentHttpRequestContext(request, options);
      const result = await executeHttpAction(runner, request.params.name, request.body, context);
      response.json(result);
    } catch (error) {
      sendMappedError(response, error);
    }
  });

  router.post('/workflows/execute', async (request, response) => {
    try {
      const context = await resolveAgentHttpRequestContext(request, options);
      const result = await executeHttpWorkflow(runner, request.body, context);
      response.json(result);
    } catch (error) {
      sendMappedError(response, error);
    }
  });

  return router;
}

function sendMappedError(response: Response, error: unknown): void {
  const mapped = mapAgentRunnerError(error);
  response.status(mapped.statusCode).json(mapped.response);
}
