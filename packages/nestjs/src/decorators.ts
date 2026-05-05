import 'reflect-metadata';
import { Inject } from '@nestjs/common';
import type { ActionDefinition } from '@agent-action-runner/core';
import { AGENT_ACTION_METADATA, AGENT_RUNNER } from './constants.js';

export type AgentActionOptions<Input = unknown, Output = unknown> =
  Omit<ActionDefinition<Input, Output>, 'handler'>;

export function AgentAction<Input = unknown, Output = unknown>(
  options: AgentActionOptions<Input, Output>,
): MethodDecorator {
  return (_target, _propertyKey, descriptor) => {
    if (!descriptor || typeof descriptor.value !== 'function') {
      throw new TypeError('@AgentAction() can only be used on methods.');
    }

    Reflect.defineMetadata(AGENT_ACTION_METADATA, options, descriptor.value);
  };
}

export function InjectAgentRunner(): ReturnType<typeof Inject> {
  return Inject(AGENT_RUNNER);
}

export function getAgentActionMetadata(
  method: unknown,
): AgentActionOptions | undefined {
  if (typeof method !== 'function') {
    return undefined;
  }

  return Reflect.getMetadata(AGENT_ACTION_METADATA, method) as AgentActionOptions | undefined;
}
