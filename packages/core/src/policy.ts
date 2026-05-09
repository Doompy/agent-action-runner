import type {
  ActionMode,
  PolicyCheck,
  PolicyCheckInput,
  PolicyCheckResult,
} from './types.js';

export type PolicyRequirementOptions = {
  readonly actions?: readonly string[];
  readonly metadataKey?: string;
};

export function composePolicies(...policies: readonly PolicyCheck[]): PolicyCheck {
  return async (input) => {
    for (const policy of policies) {
      const result = await policy(input);
      if (!result.allowed) {
        return result;
      }
    }

    return { allowed: true };
  };
}

export function allowModes(modes: readonly ActionMode[]): PolicyCheck {
  const allowedModes = new Set<ActionMode>(modes);
  return ({ action }) => (
    allowedModes.has(action.mode)
      ? { allowed: true }
      : {
        allowed: false,
        reason: `Action mode "${action.mode}" is not allowed by policy.`,
      }
  );
}

export function requireRole(
  role: string,
  options: PolicyRequirementOptions = {},
): PolicyCheck {
  return createMetadataRequirementPolicy({
    label: 'role',
    metadataKey: options.metadataKey ?? 'roles',
    requiredValue: role,
    actions: options.actions,
  });
}

export function requireScope(
  scope: string,
  options: PolicyRequirementOptions = {},
): PolicyCheck {
  return createMetadataRequirementPolicy({
    label: 'scope',
    metadataKey: options.metadataKey ?? 'scopes',
    requiredValue: scope,
    actions: options.actions,
  });
}

function createMetadataRequirementPolicy(input: {
  readonly actions?: readonly string[];
  readonly label: string;
  readonly metadataKey: string;
  readonly requiredValue: string;
}): PolicyCheck {
  const actionNames = input.actions ? new Set(input.actions) : undefined;

  return (checkInput) => {
    if (actionNames && !actionNames.has(checkInput.action.name)) {
      return { allowed: true };
    }

    return hasMetadataValue(checkInput, input.metadataKey, input.requiredValue)
      ? { allowed: true }
      : createRejectedResult(input.label, input.requiredValue, checkInput.action.name);
  };
}

function hasMetadataValue(
  input: PolicyCheckInput,
  metadataKey: string,
  expected: string,
): boolean {
  const value = input.context.metadata[metadataKey];
  if (typeof value === 'string') {
    return value === expected;
  }

  return Array.isArray(value) && value.includes(expected);
}

function createRejectedResult(
  label: string,
  value: string,
  actionName: string,
): PolicyCheckResult {
  return {
    allowed: false,
    reason: `Action "${actionName}" requires ${label} "${value}".`,
  };
}
