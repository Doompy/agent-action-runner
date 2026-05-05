import { InvalidStepReferenceError } from './errors.js';
import type { JsonPointer, StepReference, WorkflowInputValue } from './types.js';

export function fromStep(stepId: string, path: JsonPointer = ''): StepReference {
  return { $fromStep: stepId, path };
}

export function resolveWorkflowInput(
  value: WorkflowInputValue,
  outputByStep: Readonly<Record<string, unknown>>,
): unknown {
  if (isStepReference(value)) {
    return resolveStepReference(value, outputByStep);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveWorkflowInput(item, outputByStep));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveWorkflowInput(item, outputByStep)]),
    );
  }

  return value;
}

function resolveStepReference(
  reference: StepReference,
  outputByStep: Readonly<Record<string, unknown>>,
): unknown {
  if (!Object.hasOwn(outputByStep, reference.$fromStep)) {
    throw new InvalidStepReferenceError(`Step "${reference.$fromStep}" has no output to reference.`);
  }

  return resolveJsonPointer(outputByStep[reference.$fromStep], reference.path);
}

function resolveJsonPointer(value: unknown, pointer: JsonPointer): unknown {
  if (pointer === '') {
    return value;
  }

  const segments = pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));

  let cursor = value;
  for (const segment of segments) {
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) {
        throw new InvalidStepReferenceError(`Array index "${segment}" is not available for pointer "${pointer}".`);
      }
      cursor = cursor[index];
      continue;
    }

    if (cursor !== null && typeof cursor === 'object' && Object.hasOwn(cursor, segment)) {
      cursor = (cursor as Record<string, unknown>)[segment];
      continue;
    }

    throw new InvalidStepReferenceError(`Path "${pointer}" could not be resolved.`);
  }

  return cursor;
}

function isStepReference(value: unknown): value is StepReference {
  return (
    value !== null
    && typeof value === 'object'
    && typeof (value as Partial<StepReference>).$fromStep === 'string'
    && typeof (value as Partial<StepReference>).path === 'string'
  );
}
