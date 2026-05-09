import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type {
  ActionDefinition,
  AgentActionRunner,
  AgentExecutionContext,
} from '@agent-action-runner/core';
import { ActionAlreadyRegisteredError } from '@agent-action-runner/core';
import { AGENT_RUNNER } from './constants.js';
import { getAgentActionMetadata } from './decorators.js';

@Injectable()
export class AgentActionExplorer implements OnModuleInit {
  constructor(
    @Inject(AGENT_RUNNER)
    private readonly runner: AgentActionRunner,
    private readonly discoveryService: DiscoveryService,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discoveryService.getProviders()) {
      const instance = wrapper.instance;
      if (!instance || typeof instance !== 'object') {
        continue;
      }

      for (const methodName of getMethodNames(instance)) {
        const method = instance[methodName as keyof typeof instance];
        const metadata = getAgentActionMetadata(method);
        if (!metadata) {
          continue;
        }

        this.registerDiscoveredAction({
          ...metadata,
          handler: (input: unknown, context: AgentExecutionContext) => {
            const handler = instance[methodName as keyof typeof instance];
            if (typeof handler !== 'function') {
              throw new TypeError(`Agent action method "${methodName}" is not callable.`);
            }

            return handler.call(instance, input, context);
          },
        }, getProviderName(instance), methodName);
      }
    }
  }

  private registerDiscoveredAction(
    definition: ActionDefinition<unknown, unknown>,
    providerName: string,
    methodName: string,
  ): void {
    try {
      this.runner.registerAction(definition);
    } catch (error) {
      if (error instanceof ActionAlreadyRegisteredError) {
        throw new Error(
          `Failed to register Agent action "${definition.name}" from ${providerName}.${methodName}: ${error.message}`,
          { cause: error },
        );
      }

      throw error;
    }
  }
}

function getProviderName(instance: object): string {
  const constructorName = instance.constructor?.name;
  return constructorName && constructorName.length > 0 ? constructorName : 'UnknownProvider';
}

function getMethodNames(instance: object): readonly string[] {
  const names = new Set<string>();
  let prototype = Object.getPrototypeOf(instance);

  while (prototype && prototype !== Object.prototype) {
    for (const propertyName of Object.getOwnPropertyNames(prototype)) {
      if (propertyName === 'constructor') {
        continue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
      if (typeof descriptor?.value === 'function') {
        names.add(propertyName);
      }
    }

    prototype = Object.getPrototypeOf(prototype);
  }

  return [...names];
}
