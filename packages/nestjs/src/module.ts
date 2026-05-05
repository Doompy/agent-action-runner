import { DynamicModule, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import {
  AgentActionRunner,
  AgentRunnerOptions,
  createRunner,
} from '@agent-action-runner/core';
import { AGENT_RUNNER, AGENT_RUNNER_OPTIONS } from './constants.js';
import { AgentActionExplorer } from './explorer.js';

export type AgentRunnerModuleOptions = AgentRunnerOptions & {
  readonly global?: boolean;
};

@Module({})
export class AgentRunnerModule {
  static forRoot(options: AgentRunnerModuleOptions = {}): DynamicModule {
    const { global = false, ...runnerOptions } = options;

    return {
      module: AgentRunnerModule,
      global,
      imports: [DiscoveryModule],
      providers: [
        {
          provide: AGENT_RUNNER_OPTIONS,
          useValue: runnerOptions,
        },
        {
          provide: AGENT_RUNNER,
          useFactory: (): AgentActionRunner => createRunner(runnerOptions),
        },
        AgentActionExplorer,
      ],
      exports: [AGENT_RUNNER],
    };
  }
}
