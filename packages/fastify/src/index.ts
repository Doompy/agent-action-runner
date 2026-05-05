import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import type { AgentActionRunner } from '@agent-action-runner/core';
import {
  createActionListResponse,
  executeHttpAction,
  executeHttpWorkflow,
  mapAgentRunnerError,
  resolveAgentHttpRequestContext,
} from '@agent-action-runner/http';
import type { AgentHttpAdapterOptions } from '@agent-action-runner/http';

export type FastifyAgentRunnerPluginOptions =
  AgentHttpAdapterOptions<FastifyRequest> & {
    readonly runner: AgentActionRunner;
  };

export const agentRunnerFastifyPlugin: FastifyPluginAsync<FastifyAgentRunnerPluginOptions> = async (
  fastify,
  options,
) => {
  fastify.get('/actions', async () => createActionListResponse(options.runner));

  fastify.post<{ Params: { name: string } }>('/actions/:name/execute', async (request, reply) => {
    try {
      const context = await resolveAgentHttpRequestContext(request, options);
      return await executeHttpAction(options.runner, request.params.name, request.body, context);
    } catch (error) {
      sendMappedError(reply, error);
      return undefined;
    }
  });

  fastify.post('/workflows/execute', async (request, reply) => {
    try {
      const context = await resolveAgentHttpRequestContext(request, options);
      return await executeHttpWorkflow(options.runner, request.body, context);
    } catch (error) {
      sendMappedError(reply, error);
      return undefined;
    }
  });
};

function sendMappedError(reply: FastifyReply, error: unknown): void {
  const mapped = mapAgentRunnerError(error);
  reply.status(mapped.statusCode).send(mapped.response);
}
