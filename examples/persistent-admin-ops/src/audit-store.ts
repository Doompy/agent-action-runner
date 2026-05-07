import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  ActionExecutionEvent,
  ActionMode,
  AuditStore,
} from '@agent-action-runner/core';

export type PersistedAuditEntry = {
  readonly executionId: string;
  readonly workflowId?: string;
  readonly stepId?: string;
  readonly userId: string;
  readonly actionName: string;
  readonly mode: ActionMode;
  readonly status: 'started' | 'succeeded' | 'failed';
  readonly input: unknown;
  readonly outputSummary?: string;
  readonly approvalId?: string;
  readonly error?: {
    readonly name?: string;
    readonly message: string;
  };
  readonly createdAt: string;
};

export class FileAuditStore implements AuditStore {
  constructor(private readonly filePath: string) {}

  async write(event: ActionExecutionEvent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(
      this.filePath,
      `${JSON.stringify(toPersistedAuditEntry(event))}\n`,
      'utf8',
    );
  }

  async readAll(): Promise<PersistedAuditEntry[]> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    return contents
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as PersistedAuditEntry);
  }
}

function toPersistedAuditEntry(event: ActionExecutionEvent): PersistedAuditEntry {
  return {
    executionId: event.executionId,
    workflowId: event.workflowId,
    stepId: event.stepId,
    userId: event.userId,
    actionName: event.actionName,
    mode: event.mode,
    status: event.status,
    input: event.input,
    outputSummary: event.outputSummary,
    approvalId: event.approvalId,
    error: event.error ? toErrorSummary(event.error) : undefined,
    createdAt: event.createdAt.toISOString(),
  };
}

function toErrorSummary(error: unknown): PersistedAuditEntry['error'] {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    message: String(error),
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
