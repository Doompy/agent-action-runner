import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { z } from 'zod';
import type {
  ActionExample,
  ActionMode,
  ActionRiskLevel,
  AgentActionRunner,
  ApprovalContextOverrides,
  ExecutableActionDefinition,
} from '@agent-action-runner/core';

const DEFAULT_SERVER_NAME = 'agent-action-runner';
const DEFAULT_EXPOSE_MODES: readonly ActionMode[] = ['read', 'draft', 'dryRun'];
const require = createRequire(import.meta.url);
const DEFAULT_SERVER_VERSION = readPackageVersion();

export type MaybePromise<T> = T | Promise<T>;

export type McpToolRequestContext = RequestHandlerExtra<ServerRequest, ServerNotification>;

export type McpExporterOptions = {
  readonly serverName?: string;
  readonly serverVersion?: string;
  readonly exposeModes?: readonly ActionMode[];
  readonly exposeMutations?: boolean;
  readonly allowedModes?: readonly ActionMode[];
  readonly getUserId?: (context: McpToolRequestContext) => MaybePromise<string>;
  readonly getApprovalToken?: (context: McpToolRequestContext) => MaybePromise<string | undefined>;
  readonly getApprovalContext?: (context: McpToolRequestContext) => MaybePromise<ApprovalContextOverrides | undefined>;
  readonly getIdempotencyKey?: (
    context: McpToolRequestContext,
    action: ExecutableActionDefinition,
    input: unknown,
  ) => MaybePromise<string | undefined>;
  readonly getMetadata?: (context: McpToolRequestContext) => MaybePromise<Readonly<Record<string, unknown>> | undefined>;
};

export type McpToolCatalogEntry = {
  readonly name: string;
  readonly actionName: string;
  readonly mode: ActionMode;
  readonly description: string;
  readonly approvalRequired: boolean;
  readonly tags?: readonly string[];
  readonly resourceType?: string;
  readonly riskLevel?: ActionRiskLevel;
  readonly deprecated?: boolean | string;
  readonly examples?: readonly ActionExample[];
  readonly inputSchema: JsonSchemaObject;
};

export type McpToolSkipReason =
  | 'modeNotExposed'
  | 'mutationNotExposed'
  | 'schemaMissing'
  | 'schemaNotSerializable';

export type McpToolReportEntry =
  | (McpToolCatalogEntry & {
    readonly exported: true;
  })
  | {
    readonly exported: false;
    readonly actionName: string;
    readonly mode: ActionMode;
    readonly approvalRequired: boolean;
    readonly tags?: readonly string[];
    readonly resourceType?: string;
    readonly riskLevel?: ActionRiskLevel;
    readonly deprecated?: boolean | string;
    readonly examples?: readonly ActionExample[];
    readonly skipReason: McpToolSkipReason;
  };

export type JsonSchemaObject = {
  readonly type: 'object';
  readonly [key: string]: unknown;
};

export function createMcpExporter(
  runner: AgentActionRunner,
  options: McpExporterOptions = {},
): McpServer {
  const server = new McpServer({
    name: options.serverName ?? DEFAULT_SERVER_NAME,
    version: options.serverVersion ?? DEFAULT_SERVER_VERSION,
  });

  registerMcpTools(server, runner, options);
  return server;
}

export function registerMcpTools(
  server: McpServer,
  runner: AgentActionRunner,
  options: McpExporterOptions = {},
): readonly McpToolCatalogEntry[] {
  const catalog = createMcpToolCatalog(runner, options);

  for (const tool of catalog) {
    const action = runner.getAction(tool.actionName);
    if (!action?.inputSchema) {
      continue;
    }

    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: action.inputSchema as unknown as AnySchema,
      annotations: createToolAnnotations(action),
      _meta: {
        'agent-action-runner/actionName': action.name,
        'agent-action-runner/mode': action.mode,
        'agent-action-runner/approvalRequired': tool.approvalRequired,
        'agent-action-runner/riskLevel': action.riskLevel,
        'agent-action-runner/resourceType': action.resourceType,
        'agent-action-runner/tags': action.tags,
      },
    }, async (args: unknown, extra: McpToolRequestContext) => executeMcpTool(runner, action, args, extra, options));
  }

  return catalog;
}

export function createMcpToolCatalog(
  runner: AgentActionRunner,
  options: McpExporterOptions = {},
): readonly McpToolCatalogEntry[] {
  return createMcpToolReport(runner, options)
    .filter((entry): entry is McpToolCatalogEntry & { readonly exported: true } => entry.exported)
    .map(({ exported: _exported, ...entry }) => entry);
}

export function createMcpToolReport(
  runner: AgentActionRunner,
  options: McpExporterOptions = {},
): readonly McpToolReportEntry[] {
  const usedNames = new Set<string>();
  const entries: McpToolReportEntry[] = [];

  for (const action of runner.listActions()) {
    const skipReason = getSkipReason(action, options);
    if (skipReason) {
      entries.push(createSkippedReportEntry(action, skipReason));
      continue;
    }

    const inputSchema = action.inputSchema ? toJsonSchemaObject(action.inputSchema) : undefined;
    if (!inputSchema) {
      entries.push(createSkippedReportEntry(action, action.inputSchema ? 'schemaNotSerializable' : 'schemaMissing'));
      continue;
    }

    entries.push({
      exported: true,
      name: createUniqueToolName(action.name, usedNames),
      actionName: action.name,
      mode: action.mode,
      description: createToolDescription(action),
      approvalRequired: isApprovalRequired(action),
      ...createActionMetadata(action),
      inputSchema,
    });
  }

  return entries;
}

function createSkippedReportEntry(
  action: ExecutableActionDefinition,
  skipReason: McpToolSkipReason,
): McpToolReportEntry {
  return {
    exported: false,
    actionName: action.name,
    mode: action.mode,
    approvalRequired: isApprovalRequired(action),
    ...createActionMetadata(action),
    skipReason,
  };
}

async function executeMcpTool(
  runner: AgentActionRunner,
  action: ExecutableActionDefinition,
  input: unknown,
  context: McpToolRequestContext,
  options: McpExporterOptions,
): Promise<CallToolResult> {
  try {
    const result = await runner.executeAction({
      userId: await resolveUserId(context, options),
      action: action.name,
      input,
      allowedModes: resolveAllowedModes(options),
      approvalToken: await options.getApprovalToken?.(context),
      approvalContext: await options.getApprovalContext?.(context),
      idempotencyKey: await options.getIdempotencyKey?.(context, action, input),
      metadata: await options.getMetadata?.(context),
    });
    const structuredContent = {
      executionId: result.executionId,
      actionName: result.actionName,
      mode: result.mode,
      output: result.output,
      approvalId: result.approvalId,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
      structuredContent,
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool execution failed.';
    return {
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
      structuredContent: {
        error: {
          message,
        },
      },
      isError: true,
    };
  }
}

function isActionExportable(
  action: ExecutableActionDefinition,
  options: McpExporterOptions,
): boolean {
  return !getSkipReason(action, options);
}

function getSkipReason(
  action: ExecutableActionDefinition,
  options: McpExporterOptions,
): McpToolSkipReason | undefined {
  if (action.mode === 'mutate') {
    return Boolean(options.exposeMutations) && isApprovalRequired(action)
      ? undefined
      : 'mutationNotExposed';
  }

  return (options.exposeModes ?? DEFAULT_EXPOSE_MODES).includes(action.mode)
    ? undefined
    : 'modeNotExposed';
}

function isApprovalRequired(action: ExecutableActionDefinition): boolean {
  return Boolean(action.approvalRequired || action.mode === 'mutate');
}

function resolveAllowedModes(options: McpExporterOptions): readonly ActionMode[] {
  if (options.allowedModes) {
    return options.allowedModes;
  }

  const modes = new Set<ActionMode>(options.exposeModes ?? DEFAULT_EXPOSE_MODES);
  if (options.exposeMutations) {
    modes.add('mutate');
  }

  return [...modes];
}

async function resolveUserId(
  context: McpToolRequestContext,
  options: McpExporterOptions,
): Promise<string> {
  const configuredUserId = await options.getUserId?.(context);
  if (configuredUserId) {
    return configuredUserId;
  }

  const metadataUserId = getMetadataString(context._meta, 'agent-action-runner/userId')
    ?? getMetadataString(context._meta, 'userId')
    ?? getMetadataString(context.authInfo?.extra, 'userId');
  if (metadataUserId) {
    return metadataUserId;
  }

  throw new Error('MCP exporter requires getUserId or context metadata userId.');
}

function createToolDescription(action: ExecutableActionDefinition): string {
  return [
    action.description,
    `Agent Action Runner action: ${action.name}`,
    `Mode: ${action.mode}`,
    `Approval required: ${isApprovalRequired(action) ? 'yes' : 'no'}`,
    action.riskLevel ? `Risk level: ${action.riskLevel}` : undefined,
    action.resourceType ? `Resource type: ${action.resourceType}` : undefined,
    action.tags && action.tags.length > 0 ? `Tags: ${action.tags.join(', ')}` : undefined,
    action.deprecated
      ? `Deprecated: ${typeof action.deprecated === 'string' ? action.deprecated : 'yes'}`
      : undefined,
  ].filter(Boolean).join('\n\n');
}

function createActionMetadata(action: ExecutableActionDefinition): {
  readonly tags?: readonly string[];
  readonly resourceType?: string;
  readonly riskLevel?: ActionRiskLevel;
  readonly deprecated?: boolean | string;
  readonly examples?: readonly ActionExample[];
} {
  return {
    tags: action.tags,
    resourceType: action.resourceType,
    riskLevel: action.riskLevel,
    deprecated: action.deprecated,
    examples: action.examples,
  };
}

function createToolAnnotations(action: ExecutableActionDefinition): ToolAnnotations {
  return {
    title: action.name,
    readOnlyHint: action.mode === 'read',
    destructiveHint: action.mode === 'mutate',
    idempotentHint: action.mode !== 'mutate',
  };
}

function createUniqueToolName(actionName: string, usedNames: Set<string>): string {
  const baseName = sanitizeToolName(actionName);
  let toolName = baseName;
  let suffix = 2;

  while (usedNames.has(toolName)) {
    toolName = `${baseName}_${suffix}`;
    suffix += 1;
  }

  usedNames.add(toolName);
  return toolName;
}

function sanitizeToolName(actionName: string): string {
  const sanitized = actionName
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || 'action';
}

function toJsonSchemaObject(schema: unknown): JsonSchemaObject | undefined {
  const converted = convertWithZodFunction(schema) ?? convertWithSchemaMethod(schema);
  if (!isRecord(converted) || converted.type !== 'object') {
    return undefined;
  }

  return converted as JsonSchemaObject;
}

function convertWithZodFunction(schema: unknown): unknown {
  const converter = (z as typeof z & {
    readonly toJSONSchema?: (schema: unknown) => unknown;
  }).toJSONSchema;

  if (typeof converter !== 'function') {
    return undefined;
  }

  try {
    return converter(schema);
  } catch {
    return undefined;
  }
}

function convertWithSchemaMethod(schema: unknown): unknown {
  if (!isRecord(schema) || typeof schema.toJSONSchema !== 'function') {
    return undefined;
  }

  try {
    return schema.toJSONSchema();
  } catch {
    return undefined;
  }
}

function getMetadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readPackageVersion(): string {
  try {
    const manifest = require('../package.json') as { readonly version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
