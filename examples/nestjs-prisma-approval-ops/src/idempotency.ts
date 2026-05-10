import type { PrismaClient } from '@prisma/client';

export async function reserveIdempotencyKey(input: {
  readonly tx: PrismaTransaction;
  readonly key: string;
  readonly actionName: string;
  readonly userId: string;
  readonly executionId: string;
}): Promise<
  | { readonly replay: true; readonly result: unknown }
  | { readonly replay: false }
> {
  const existing = await input.tx.agentIdempotencyKey.findUnique({
    where: { key: input.key },
  });

  if (existing?.status === 'succeeded') {
    return {
      replay: true,
      result: parseStoredJson(existing.resultJson),
    };
  }

  if (existing?.status === 'in_progress') {
    throw new Error('A matching operation is already in progress.');
  }

  if (existing) {
    await input.tx.agentIdempotencyKey.update({
      where: { key: input.key },
      data: {
        actionName: input.actionName,
        userId: input.userId,
        executionId: input.executionId,
        status: 'in_progress',
        errorJson: null,
        updatedAt: new Date(),
      },
    });
    return { replay: false };
  }

  await input.tx.agentIdempotencyKey.create({
    data: {
      key: input.key,
      actionName: input.actionName,
      userId: input.userId,
      executionId: input.executionId,
      status: 'in_progress',
    },
  });
  return { replay: false };
}

export async function markIdempotencySucceeded(input: {
  readonly tx: PrismaTransaction;
  readonly key: string;
  readonly result: unknown;
}): Promise<void> {
  await input.tx.agentIdempotencyKey.update({
    where: { key: input.key },
    data: {
      status: 'succeeded',
      resultJson: JSON.stringify(input.result),
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

function parseStoredJson(value: string | null): unknown {
  if (!value) {
    return undefined;
  }

  return JSON.parse(value);
}

type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
