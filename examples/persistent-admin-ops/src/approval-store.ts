import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  createStableHash,
  type ApprovalContext,
  type ApprovalCheckResult,
} from '@agent-action-runner/core';

const TOKEN_TTL_MS = 5 * 60 * 1000;

export type StoredApprovalRecord = {
  readonly approvalId: string;
  readonly tokenHash: string;
  readonly userId: string;
  readonly actionName: 'admin.disableUser';
  readonly inputHash: string;
  readonly resourceIds: readonly string[];
  readonly dryRunHash: string;
  readonly expiresAt: string;
  readonly createdAt: string;
};

export type DisableUserApprovalResult = {
  readonly approvalId: string;
  readonly approvalToken: string;
  readonly approval: StoredApprovalRecord;
  readonly mutateInput: {
    readonly userId: string;
    readonly reason: string;
    readonly dryRunHash: string;
  };
};

export class FileApprovalStore {
  constructor(private readonly filePath: string) {}

  async createDisableUserApproval(input: {
    readonly operatorUserId: string;
    readonly targetUserId: string;
    readonly reason: string;
    readonly dryRunHash: string;
    readonly now?: Date;
  }): Promise<DisableUserApprovalResult> {
    const now = input.now ?? new Date();
    const approvalToken = randomBytes(32).toString('base64url');
    const mutateInput = {
      userId: input.targetUserId,
      reason: input.reason,
      dryRunHash: input.dryRunHash,
    };
    const approval: StoredApprovalRecord = {
      approvalId: randomUUID(),
      tokenHash: hashToken(approvalToken),
      userId: input.operatorUserId,
      actionName: 'admin.disableUser',
      inputHash: createStableHash(mutateInput),
      resourceIds: [input.targetUserId],
      dryRunHash: input.dryRunHash,
      expiresAt: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(),
      createdAt: now.toISOString(),
    };

    await this.append(approval);

    return {
      approvalId: approval.approvalId,
      approvalToken,
      approval,
      mutateInput,
    };
  }

  async verifyApprovalToken(input: {
    readonly token?: string;
    readonly approvalContext: ApprovalContext;
    readonly now?: Date;
  }): Promise<ApprovalCheckResult> {
    if (!input.token) {
      return { approved: false };
    }

    const tokenHash = hashToken(input.token);
    const approvals = await this.readAll();
    const approval = approvals.find((candidate) => safeEqual(candidate.tokenHash, tokenHash));
    if (!approval) {
      return { approved: false };
    }

    const now = input.now ?? new Date();
    if (Date.parse(approval.expiresAt) <= now.getTime()) {
      return { approved: false, reason: 'Approval token expired.' };
    }

    if (!matchesApprovalContext(approval, input.approvalContext)) {
      return { approved: false, reason: 'Approval token does not match this mutation.' };
    }

    return {
      approved: true,
      approvalId: approval.approvalId,
    };
  }

  async readAll(): Promise<StoredApprovalRecord[]> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    return JSON.parse(contents) as StoredApprovalRecord[];
  }

  private async append(approval: StoredApprovalRecord): Promise<void> {
    const approvals = await this.readAll();
    approvals.push(approval);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(approvals, null, 2)}\n`, 'utf8');
  }
}

function matchesApprovalContext(
  approval: StoredApprovalRecord,
  context: ApprovalContext,
): boolean {
  return approval.userId === context.userId
    && approval.actionName === context.actionName
    && approval.inputHash === context.inputHash
    && approval.dryRunHash === context.dryRunHash
    && approval.resourceIds.join('\0') === context.resourceIds?.join('\0');
}

function hashToken(token: string): string {
  return createHash('sha256')
    .update(token)
    .digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
