import { describe, expect, it } from 'vitest';
import {
  createApprovalStore,
  createDisableUserApproval,
  verifyApprovalToken,
} from './approval.js';
import { createStableHash } from './hash.js';

describe('admin ops approval helpers', () => {
  it('accepts approval tokens bound to the matching approval context', () => {
    const approvals = createApprovalStore();
    const now = new Date('2026-05-06T00:00:00.000Z');
    const approval = createDisableUserApproval({
      operatorUserId: 'operator_1',
      targetUserId: 'user_2',
      reason: 'Repeated policy violations.',
      dryRunHash: 'dry_run_hash_1',
      approvals,
      now,
    });

    const result = verifyApprovalToken({
      token: approval.approvalToken,
      approvals,
      now: new Date('2026-05-06T00:01:00.000Z'),
      approvalContext: {
        userId: 'operator_1',
        actionName: 'admin.disableUser',
        mode: 'mutate',
        inputHash: createStableHash(approval.mutateInput),
        resourceIds: ['user_2'],
        dryRunHash: 'dry_run_hash_1',
      },
    });

    expect(result).toEqual({
      approved: true,
      approvalId: approval.approvalId,
    });
  });

  it('rejects missing, mismatched, and expired approval tokens', () => {
    const approvals = createApprovalStore();
    const now = new Date('2026-05-06T00:00:00.000Z');
    const approval = createDisableUserApproval({
      operatorUserId: 'operator_1',
      targetUserId: 'user_2',
      reason: 'Repeated policy violations.',
      dryRunHash: 'dry_run_hash_1',
      approvals,
      now,
    });

    expect(verifyApprovalToken({
      approvals,
      approvalContext: {
        userId: 'operator_1',
        actionName: 'admin.disableUser',
        mode: 'mutate',
        inputHash: createStableHash(approval.mutateInput),
        resourceIds: ['user_2'],
        dryRunHash: 'dry_run_hash_1',
      },
    })).toEqual({ approved: false });

    expect(verifyApprovalToken({
      token: approval.approvalToken,
      approvals,
      now: new Date('2026-05-06T00:01:00.000Z'),
      approvalContext: {
        userId: 'operator_1',
        actionName: 'admin.disableUser',
        mode: 'mutate',
        inputHash: createStableHash({
          ...approval.mutateInput,
          reason: 'Changed after approval.',
        }),
        resourceIds: ['user_2'],
        dryRunHash: 'dry_run_hash_1',
      },
    })).toEqual({ approved: false });

    expect(verifyApprovalToken({
      token: approval.approvalToken,
      approvals,
      now: new Date('2026-05-06T00:06:00.000Z'),
      approvalContext: {
        userId: 'operator_1',
        actionName: 'admin.disableUser',
        mode: 'mutate',
        inputHash: createStableHash(approval.mutateInput),
        resourceIds: ['user_2'],
        dryRunHash: 'dry_run_hash_1',
      },
    })).toEqual({ approved: false });
  });
});
