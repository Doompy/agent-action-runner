#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  ActionExample,
  ActionMode,
  ActionRiskLevel,
  AgentActionRunner,
  WorkflowDefinition,
  WorkflowValidationAction,
} from '@agent-action-runner/core';
import { validateWorkflowDefinition } from '@agent-action-runner/core';
import { z } from 'zod';

const DEFAULT_CONFIG_FILE = 'agent-runner.config.json';
const DEFAULT_ALLOWED_MODES: readonly ActionMode[] = ['read', 'draft', 'dryRun'];
const ACTION_MODES: readonly ActionMode[] = ['read', 'draft', 'dryRun', 'mutate'];
const ACTION_RISK_LEVELS: readonly ActionRiskLevel[] = ['low', 'medium', 'high'];

export type CliOptions = {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
};

export type AgentRunnerCliConfig = {
  readonly manifest: string;
  readonly runner: string;
  readonly workflowsDir: string;
  readonly mcp: {
    readonly exposeModes: readonly ActionMode[];
    readonly exposeMutations: boolean;
  };
};

export type ActionManifest = {
  readonly version: 1;
  readonly actions: readonly ActionManifestEntry[];
};

export type ActionManifestEntry = {
  readonly name: string;
  readonly mode: ActionMode;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly resourceType?: string;
  readonly riskLevel?: ActionRiskLevel;
  readonly deprecated?: boolean | string;
  readonly examples?: readonly ActionExample[];
  readonly approvalRequired?: boolean;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly inputSchemaStatus?: SchemaStatus;
  readonly outputSchemaStatus?: SchemaStatus;
};

type CommandContext = {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
};

type ParsedArgs = {
  readonly positionals: readonly string[];
  readonly flags: ReadonlySet<string>;
  readonly options: Readonly<Record<string, string>>;
};

type McpPreviewEntry = {
  readonly actionName: string;
  readonly mode: ActionMode;
  readonly approvalRequired: boolean;
  readonly tags?: readonly string[];
  readonly resourceType?: string;
  readonly riskLevel?: ActionRiskLevel;
  readonly deprecated?: boolean | string;
  readonly examples?: readonly ActionExample[];
  readonly exported: boolean;
  readonly toolName?: string;
  readonly reason?: 'modeNotExposed' | 'mutationNotExposed' | 'schemaMissing' | 'schemaNotSerializable';
};

type DoctorWarning = {
  readonly actionName?: string;
  readonly code: string;
  readonly message: string;
};

type SchemaStatus = 'missing' | 'present' | 'schemaNotSerializable';

const DEFAULT_CONFIG: AgentRunnerCliConfig = {
  manifest: './.agent-runner/actions.json',
  runner: './dist/agent-runner.js',
  workflowsDir: './agent-workflows',
  mcp: {
    exposeModes: DEFAULT_ALLOWED_MODES,
    exposeMutations: false,
  },
};

export async function runCli(options: CliOptions): Promise<number> {
  const context: CommandContext = {
    args: options.argv,
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdout: options.stdout ?? ((text) => process.stdout.write(text)),
    stderr: options.stderr ?? ((text) => process.stderr.write(text)),
  };
  const [command, ...rest] = context.args;

  try {
    switch (command) {
      case undefined:
      case '--help':
      case '-h':
        writeHelp(context);
        return 0;
      case 'init':
        await runInit(context, parseArgs(rest));
        return 0;
      case 'actions:list':
        await runActionsList(context, parseArgs(rest));
        return 0;
      case 'actions:inspect':
        await runActionsInspect(context, parseArgs(rest));
        return 0;
      case 'actions:export':
        await runActionsExport(context, parseArgs(rest));
        return 0;
      case 'workflow:validate':
        return await runWorkflowValidate(context, parseArgs(rest));
      case 'workflow:run':
        return await runWorkflowRun(context, parseArgs(rest));
      case 'mcp:preview':
        await runMcpPreview(context, parseArgs(rest));
        return 0;
      case 'mcp:serve':
        await runMcpServe(context, parseArgs(rest));
        return 0;
      case 'doctor':
        return await runDoctor(context, parseArgs(rest));
      case 'docs:generate':
        await runDocsGenerate(context, parseArgs(rest));
        return 0;
      default:
        throw new CliError(`Unknown command "${command}".`);
    }
  } catch (error) {
    context.stderr(`${formatCliError(error)}\n`);
    return 1;
  }
}

async function runInit(context: CommandContext, args: ParsedArgs): Promise<void> {
  const force = args.flags.has('force');
  const configPath = resolvePath(context.cwd, args.options.config ?? DEFAULT_CONFIG_FILE);
  const config = DEFAULT_CONFIG;
  const manifestPath = resolvePath(context.cwd, config.manifest);
  const workflowPath = resolvePath(context.cwd, config.workflowsDir, 'example.workflow.json');
  const files = [
    configPath,
    manifestPath,
    workflowPath,
  ];

  if (!force) {
    const existingFile = files.find((file) => existsSync(file));
    if (existingFile) {
      throw new CliError(`Refusing to overwrite existing file: ${path.relative(context.cwd, existingFile)}`);
    }
  }

  await writeJsonFile(configPath, config);
  await writeJsonFile(manifestPath, createExampleManifest());
  await writeJsonFile(workflowPath, createExampleWorkflow());

  context.stdout([
    'Created Agent Action Runner files:',
    `- ${path.relative(context.cwd, configPath)}`,
    `- ${path.relative(context.cwd, manifestPath)}`,
    `- ${path.relative(context.cwd, workflowPath)}`,
    '',
  ].join('\n'));
}

async function runActionsList(context: CommandContext, args: ParsedArgs): Promise<void> {
  const manifest = await loadActionManifestSource(context, args);
  if (wantsJson(args)) {
    writeJson(context, { actions: manifest.actions });
    return;
  }

  context.stdout('Registered Actions\n\n');
  for (const action of manifest.actions) {
    const approval = isApprovalRequired(action) ? ' approvalRequired' : '';
    const risk = action.riskLevel ? ` ${action.riskLevel}` : '';
    const description = action.description ? ` - ${action.description}` : '';
    context.stdout(`- ${action.name.padEnd(32)} ${action.mode}${risk}${approval}${description}\n`);
  }
}

async function runActionsInspect(context: CommandContext, args: ParsedArgs): Promise<void> {
  const actionName = args.positionals[0];
  if (!actionName) {
    throw new CliError('actions:inspect requires an action name.');
  }

  const manifest = await loadActionManifestSource(context, args);
  const action = manifest.actions.find((candidate) => candidate.name === actionName);
  if (!action) {
    throw new CliError(`Action "${actionName}" was not found in the manifest.`);
  }

  if (wantsJson(args)) {
    writeJson(context, { action });
    return;
  }

  context.stdout([
    `Action: ${action.name}`,
    `Mode: ${action.mode}`,
    `Approval required: ${isApprovalRequired(action) ? 'yes' : 'no'}`,
    `Risk level: ${action.riskLevel ?? ''}`,
    `Resource type: ${action.resourceType ?? ''}`,
    `Tags: ${action.tags?.join(', ') ?? ''}`,
    `Deprecated: ${formatDeprecated(action.deprecated)}`,
    `Examples: ${action.examples?.length ?? 0}`,
    `Description: ${action.description ?? ''}`,
    `Input schema: ${schemaStateForDisplay(action, 'input')}`,
    `Output schema: ${schemaStateForDisplay(action, 'output')}`,
    '',
  ].join('\n'));
}

async function runActionsExport(context: CommandContext, args: ParsedArgs): Promise<void> {
  const config = await loadConfig(context, args);
  const runner = await loadRunner(context, args, config);
  const manifest = await createManifestFromRunner(runner);
  const out = resolvePath(context.cwd, args.options.out ?? config.manifest);

  await writeJsonFile(out, manifest);
  context.stdout(`Exported ${manifest.actions.length} actions to ${path.relative(context.cwd, out)}\n`);
}

async function runWorkflowValidate(context: CommandContext, args: ParsedArgs): Promise<number> {
  const workflowFile = args.positionals[0];
  if (!workflowFile) {
    throw new CliError('workflow:validate requires a workflow JSON file.');
  }

  const config = await loadConfig(context, args);
  const validationActions = args.options.runner
    ? toValidationActionsFromRunner(await loadRunner(context, args, config))
    : toValidationActions(await loadManifest(context, args, config));
  const workflow = await readJsonFile(resolvePath(context.cwd, workflowFile));
  const result = validateWorkflowDefinition(workflow, {
    actions: validationActions,
  });

  if (wantsJson(args)) {
    writeJson(context, result);
  } else if (result.valid) {
    context.stdout(`Workflow is valid: ${workflowFile}\n`);
  } else {
    context.stdout(`Workflow is invalid: ${workflowFile}\n\n`);
    for (const issue of result.issues) {
      context.stdout(`- ${issue.code}${issue.path ? ` at ${issue.path}` : ''}: ${issue.message}\n`);
    }
  }

  return result.valid ? 0 : 1;
}

async function runWorkflowRun(context: CommandContext, args: ParsedArgs): Promise<number> {
  const workflowFile = args.positionals[0];
  if (!workflowFile) {
    throw new CliError('workflow:run requires a workflow JSON file.');
  }

  const config = await loadConfig(context, args);
  const runner = await loadRunner(context, args, config);
  const workflow = await readJsonFile(resolvePath(context.cwd, workflowFile));
  const validation = validateWorkflowDefinition(workflow, {
    actions: toValidationActionsFromRunner(runner),
  });
  if (!validation.valid) {
    for (const issue of validation.issues) {
      context.stderr(`${issue.code}${issue.path ? ` at ${issue.path}` : ''}: ${issue.message}\n`);
    }
    return 1;
  }

  const result = await runner.executeWorkflow({
    userId: resolveCliUserId(context, args),
    workflow: workflow as WorkflowDefinition,
    allowedModes: resolveWorkflowRunAllowedModes(args),
    metadata: parseMetadataJson(args),
  });

  writeJson(context, result);
  return 0;
}

async function runMcpPreview(context: CommandContext, args: ParsedArgs): Promise<void> {
  const config = await loadConfig(context, args);
  const exposeMutations = args.flags.has('expose-mutations') || config.mcp.exposeMutations;
  const report = args.options.runner
    ? await createRunnerMcpPreview(context, args, config, exposeMutations)
    : createManifestMcpPreview(await loadManifest(context, args, config), {
      exposeModes: config.mcp.exposeModes,
      exposeMutations,
    });

  if (wantsJson(args)) {
    writeJson(context, { tools: report });
    return;
  }

  context.stdout('MCP Tools to export:\n\n');
  for (const entry of report.filter((candidate) => candidate.exported)) {
    context.stdout(`- ${entry.toolName} (${entry.actionName})\n`);
  }

  const excluded = report.filter((candidate) => !candidate.exported);
  if (excluded.length > 0) {
    context.stdout('\nExcluded:\n\n');
    for (const entry of excluded) {
      context.stdout(`- ${entry.actionName} reason: ${entry.reason}\n`);
    }
  }
}

async function runMcpServe(context: CommandContext, args: ParsedArgs): Promise<void> {
  const config = await loadConfig(context, args);
  const runner = await loadRunner(context, args, config);
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const server = await createMcpServerForCli({
    config,
    exposeMutations: args.flags.has('expose-mutations') || config.mcp.exposeMutations,
    runner,
    userId: resolveCliUserId(context, args),
  });

  await server.connect(new StdioServerTransport());
}

export async function createMcpServerForCli(input: {
  readonly config?: AgentRunnerCliConfig;
  readonly exposeMutations?: boolean;
  readonly runner: AgentActionRunner;
  readonly userId: string;
}) {
  const { createMcpExporter } = await import('@agent-action-runner/mcp');
  const config = input.config ?? DEFAULT_CONFIG;

  return createMcpExporter(input.runner, {
    exposeModes: config.mcp.exposeModes,
    exposeMutations: input.exposeMutations ?? config.mcp.exposeMutations,
    getUserId: () => input.userId,
  });
}

async function createRunnerMcpPreview(
  context: CommandContext,
  args: ParsedArgs,
  config: AgentRunnerCliConfig,
  exposeMutations: boolean,
): Promise<readonly McpPreviewEntry[]> {
  const runner = await loadRunner(context, args, config);
  const { createMcpToolReport } = await import('@agent-action-runner/mcp');

  return createMcpToolReport(runner, {
    exposeModes: config.mcp.exposeModes,
    exposeMutations,
    getUserId: () => resolveCliUserId(context, args),
  }).map((entry) => {
    if (entry.exported) {
      return {
        actionName: entry.actionName,
        approvalRequired: entry.approvalRequired,
        exported: true,
        tags: entry.tags,
        resourceType: entry.resourceType,
        riskLevel: entry.riskLevel,
        deprecated: entry.deprecated,
        examples: entry.examples,
        mode: entry.mode,
        toolName: entry.name,
      };
    }

    return {
      actionName: entry.actionName,
      approvalRequired: entry.approvalRequired,
      exported: false,
      tags: entry.tags,
      resourceType: entry.resourceType,
      riskLevel: entry.riskLevel,
      deprecated: entry.deprecated,
      examples: entry.examples,
      mode: entry.mode,
      reason: entry.skipReason,
    };
  });
}

async function runDoctor(context: CommandContext, args: ParsedArgs): Promise<number> {
  const manifest = await loadActionManifestSource(context, args);
  const warnings = createDoctorWarnings(manifest);

  if (wantsJson(args)) {
    writeJson(context, {
      ok: warnings.length === 0,
      warnings,
    });
    return warnings.length === 0 ? 0 : 1;
  }

  if (warnings.length === 0) {
    context.stdout('No issues found.\n');
    return 0;
  }

  context.stdout('Warnings\n\n');
  for (const warning of warnings) {
    context.stdout(`- ${warning.actionName ? `${warning.actionName}: ` : ''}${warning.message}\n`);
  }
  return 1;
}

async function runDocsGenerate(context: CommandContext, args: ParsedArgs): Promise<void> {
  const manifest = await loadActionManifestSource(context, args);
  const out = resolvePath(context.cwd, args.options.out ?? 'docs/agent-actions.md');
  const markdown = createActionsMarkdown(manifest);

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, markdown, 'utf8');
  context.stdout(`Generated ${path.relative(context.cwd, out)}\n`);
}

function createManifestMcpPreview(
  manifest: ActionManifest,
  options: {
    readonly exposeModes: readonly ActionMode[];
    readonly exposeMutations: boolean;
  },
): readonly McpPreviewEntry[] {
  const usedNames = new Set<string>();
  return manifest.actions.map((action) => {
    const approvalRequired = isApprovalRequired(action);
    const base = {
      actionName: action.name,
      mode: action.mode,
      approvalRequired,
      tags: action.tags,
      resourceType: action.resourceType,
      riskLevel: action.riskLevel,
      deprecated: action.deprecated,
      examples: action.examples,
    };

    if (action.mode === 'mutate' && (!options.exposeMutations || !approvalRequired)) {
      return {
        ...base,
        exported: false,
        reason: 'mutationNotExposed',
      };
    }

    if (action.mode !== 'mutate' && !options.exposeModes.includes(action.mode)) {
      return {
        ...base,
        exported: false,
        reason: 'modeNotExposed',
      };
    }

    if (action.inputSchema === undefined) {
      return {
        ...base,
        exported: false,
        reason: 'schemaMissing',
      };
    }

    return {
      ...base,
      exported: true,
      toolName: createUniqueToolName(action.name, usedNames),
    };
  });
}

function createDoctorWarnings(manifest: ActionManifest): readonly DoctorWarning[] {
  const warnings: DoctorWarning[] = [];
  const counts = new Map<string, number>();

  for (const action of manifest.actions) {
    counts.set(action.name, (counts.get(action.name) ?? 0) + 1);
    if (action.mode === 'mutate' && !action.approvalRequired) {
      warnings.push({
        actionName: action.name,
        code: 'mutateWithoutApproval',
        message: 'mutate action should set approvalRequired.',
      });
    }
    if (action.mode === 'mutate' && !action.riskLevel) {
      warnings.push({
        actionName: action.name,
        code: 'mutateMissingRiskLevel',
        message: 'mutate action should declare a riskLevel.',
      });
    }
    if (!action.description) {
      warnings.push({
        actionName: action.name,
        code: 'missingDescription',
        message: 'action is missing a description.',
      });
    }
    const inputStatus = getSchemaStatus(action, 'input');
    const outputStatus = getSchemaStatus(action, 'output');

    if (inputStatus === 'missing') {
      warnings.push({
        actionName: action.name,
        code: 'missingInputSchema',
        message: 'action is missing inputSchema metadata.',
      });
    }
    if (inputStatus === 'schemaNotSerializable') {
      warnings.push({
        actionName: action.name,
        code: 'inputSchemaNotSerializable',
        message: 'inputSchema could not be serialized to JSON Schema.',
      });
    }
    if (outputStatus === 'missing') {
      warnings.push({
        actionName: action.name,
        code: 'missingOutputSchema',
        message: 'action is missing outputSchema metadata.',
      });
    }
    if (outputStatus === 'schemaNotSerializable') {
      warnings.push({
        actionName: action.name,
        code: 'outputSchemaNotSerializable',
        message: 'outputSchema could not be serialized to JSON Schema.',
      });
    }
  }

  for (const [actionName, count] of counts) {
    if (count > 1) {
      warnings.push({
        actionName,
        code: 'duplicateActionName',
        message: 'action name appears more than once in the manifest.',
      });
    }
  }

  return warnings;
}

function createActionsMarkdown(manifest: ActionManifest): string {
  return [
    '# Agent Actions',
    '',
    '| Action | Mode | Risk | Resource | Approval | Tags | Input | Output | Description |',
    '|---|---|---|---|---|---|---|---|---|',
    ...manifest.actions.map((action) => (
      `| \`${action.name}\` | ${action.mode} | ${action.riskLevel ?? ''} | ${action.resourceType ?? ''} | ${isApprovalRequired(action) ? 'required' : 'not required'} | ${action.tags?.join(', ') ?? ''} | ${schemaStateForDisplay(action, 'input')} | ${schemaStateForDisplay(action, 'output')} | ${action.description ?? ''} |`
    )),
    '',
  ].join('\n');
}

async function loadActionManifestSource(
  context: CommandContext,
  args: ParsedArgs,
  loadedConfig?: AgentRunnerCliConfig,
): Promise<ActionManifest> {
  const config = loadedConfig ?? await loadConfig(context, args);
  if (args.options.runner) {
    return createManifestFromRunner(await loadRunner(context, args, config));
  }

  return loadManifest(context, args, config);
}

async function loadConfig(context: CommandContext, args: ParsedArgs): Promise<AgentRunnerCliConfig> {
  const configPath = resolvePath(context.cwd, args.options.config ?? DEFAULT_CONFIG_FILE);
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  const raw = await readJsonFile(configPath);
  if (!isRecord(raw)) {
    throw new CliError('CLI config must be a JSON object.');
  }

  const configDir = path.dirname(configPath);
  const mcp = isRecord(raw.mcp) ? raw.mcp : {};
  return {
    manifest: resolveConfigPath(configDir, raw.manifest, DEFAULT_CONFIG.manifest),
    runner: resolveConfigPath(configDir, raw.runner, DEFAULT_CONFIG.runner),
    workflowsDir: resolveConfigPath(configDir, raw.workflowsDir, DEFAULT_CONFIG.workflowsDir),
    mcp: {
      exposeModes: parseExposeModes(mcp.exposeModes),
      exposeMutations: typeof mcp.exposeMutations === 'boolean'
        ? mcp.exposeMutations
        : DEFAULT_CONFIG.mcp.exposeMutations,
    },
  };
}

function resolveConfigPath(configDir: string, value: unknown, fallback: string): string {
  const candidate = typeof value === 'string' ? value : fallback;
  return path.isAbsolute(candidate) ? candidate : path.resolve(configDir, candidate);
}

async function loadManifest(
  context: CommandContext,
  args: ParsedArgs,
  loadedConfig?: AgentRunnerCliConfig,
): Promise<ActionManifest> {
  const config = loadedConfig ?? await loadConfig(context, args);
  const manifest = await readJsonFile(resolvePath(context.cwd, config.manifest));
  if (!isRecord(manifest) || manifest.version !== 1 || !Array.isArray(manifest.actions)) {
    throw new CliError('Action manifest must include version: 1 and an actions array.');
  }

  return {
    version: 1,
    actions: manifest.actions.map(parseManifestAction),
  };
}

function parseManifestAction(value: unknown): ActionManifestEntry {
  if (!isRecord(value)) {
    throw new CliError('Action manifest entries must be objects.');
  }
  if (typeof value.name !== 'string' || value.name.length === 0) {
    throw new CliError('Action manifest entry is missing a name.');
  }
  if (typeof value.mode !== 'string' || !ACTION_MODES.includes(value.mode as ActionMode)) {
    throw new CliError(`Action "${value.name}" has invalid mode "${String(value.mode)}".`);
  }

  return {
    name: value.name,
    mode: value.mode as ActionMode,
    description: typeof value.description === 'string' ? value.description : undefined,
    tags: parseStringArray(value.tags),
    resourceType: typeof value.resourceType === 'string' ? value.resourceType : undefined,
    riskLevel: parseRiskLevel(value.riskLevel),
    deprecated: parseDeprecated(value.deprecated),
    examples: parseActionExamples(value.examples),
    approvalRequired: typeof value.approvalRequired === 'boolean' ? value.approvalRequired : undefined,
    inputSchema: value.inputSchema,
    outputSchema: value.outputSchema,
    inputSchemaStatus: parseSchemaStatus(value.inputSchemaStatus),
    outputSchemaStatus: parseSchemaStatus(value.outputSchemaStatus),
  };
}

function parseSchemaStatus(value: unknown): SchemaStatus | undefined {
  return value === 'missing' || value === 'present' || value === 'schemaNotSerializable'
    ? value
    : undefined;
}

function parseStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter((item): item is string => typeof item === 'string');
  return values.length > 0 ? values : undefined;
}

function parseRiskLevel(value: unknown): ActionRiskLevel | undefined {
  return typeof value === 'string' && ACTION_RISK_LEVELS.includes(value as ActionRiskLevel)
    ? value as ActionRiskLevel
    : undefined;
}

function parseDeprecated(value: unknown): boolean | string | undefined {
  return typeof value === 'boolean' || typeof value === 'string' ? value : undefined;
}

function parseActionExamples(value: unknown): readonly ActionExample[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const examples = value.flatMap((item): ActionExample[] => {
    if (!isRecord(item) || typeof item.title !== 'string' || !('input' in item)) {
      return [];
    }

    return [{
      title: item.title,
      description: typeof item.description === 'string' ? item.description : undefined,
      input: item.input,
    }];
  });

  return examples.length > 0 ? examples : undefined;
}

async function createManifestFromRunner(runner: AgentActionRunner): Promise<ActionManifest> {
  return {
    version: 1,
    actions: runner.listActions().map((action) => {
      const inputSchema = serializeSchema(action.inputSchema);
      const outputSchema = serializeSchema(action.outputSchema);

      return {
        name: action.name,
        mode: action.mode,
        description: action.description,
        tags: action.tags,
        resourceType: action.resourceType,
        riskLevel: action.riskLevel,
        deprecated: action.deprecated,
        examples: action.examples,
        approvalRequired: action.approvalRequired,
        inputSchema: inputSchema.schema,
        outputSchema: outputSchema.schema,
        inputSchemaStatus: inputSchema.status,
        outputSchemaStatus: outputSchema.status,
      };
    }),
  };
}

function serializeSchema(schema: unknown): {
  readonly schema?: unknown;
  readonly status: SchemaStatus;
} {
  if (!schema) {
    return { status: 'missing' };
  }

  const converted = convertWithZodFunction(schema) ?? convertWithSchemaMethod(schema);
  if (converted !== undefined) {
    return {
      schema: converted,
      status: 'present',
    };
  }

  return { status: 'schemaNotSerializable' };
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

function toValidationActions(manifest: ActionManifest): readonly WorkflowValidationAction[] {
  return manifest.actions.map((action) => ({
    name: action.name,
    mode: action.mode,
  }));
}

function toValidationActionsFromRunner(runner: AgentActionRunner): readonly WorkflowValidationAction[] {
  return runner.listActions().map((action) => ({
    name: action.name,
    mode: action.mode,
  }));
}

async function loadRunner(
  context: CommandContext,
  args: ParsedArgs,
  config: AgentRunnerCliConfig,
): Promise<AgentActionRunner> {
  const runnerPath = resolvePath(context.cwd, args.options.runner ?? config.runner);
  const module = await import(pathToFileURL(runnerPath).href);
  const candidate = isRecord(module) && 'runner' in module
    ? module.runner
    : isRecord(module) && 'default' in module
      ? module.default
      : undefined;

  if (!isAgentRunner(candidate)) {
    throw new CliError('Runner module must export `runner` or default AgentActionRunner instance.');
  }

  return candidate;
}

function isAgentRunner(value: unknown): value is AgentActionRunner {
  return isRecord(value)
    && typeof value.executeAction === 'function'
    && typeof value.executeWorkflow === 'function'
    && typeof value.getAction === 'function'
    && typeof value.listActions === 'function';
}

function resolveCliUserId(context: CommandContext, args: ParsedArgs): string {
  return args.options['user-id'] ?? context.env.AGENT_RUNNER_USER_ID ?? 'local_user';
}

function resolveWorkflowRunAllowedModes(args: ParsedArgs): readonly ActionMode[] {
  return args.flags.has('allow-mutate')
    ? [...DEFAULT_ALLOWED_MODES, 'mutate']
    : DEFAULT_ALLOWED_MODES;
}

function parseMetadataJson(args: ParsedArgs): Readonly<Record<string, unknown>> | undefined {
  const raw = args.options['metadata-json'];
  if (!raw) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliError(`--metadata-json must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new CliError('--metadata-json must be a JSON object.');
  }

  return parsed;
}

function parseExposeModes(value: unknown): readonly ActionMode[] {
  if (!Array.isArray(value)) {
    return DEFAULT_CONFIG.mcp.exposeModes;
  }

  const modes = value.filter((mode): mode is ActionMode => (
    typeof mode === 'string' && ACTION_MODES.includes(mode as ActionMode)
  ));
  return modes.length > 0 ? modes : DEFAULT_CONFIG.mcp.exposeModes;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Set<string>();
  const options: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const name = arg.slice(2);
    if (
      name === 'config'
      || name === 'format'
      || name === 'metadata-json'
      || name === 'out'
      || name === 'runner'
      || name === 'user-id'
    ) {
      const value = args[index + 1];
      if (!value) {
        throw new CliError(`--${name} requires a value.`);
      }
      options[name] = value;
      index += 1;
      continue;
    }

    flags.add(name);
  }

  return { positionals, flags, options };
}

function wantsJson(args: ParsedArgs): boolean {
  const format = args.options.format;
  if (!format) {
    return args.flags.has('json');
  }

  if (format === 'json') {
    return true;
  }

  if (format === 'text' || format === 'table') {
    return false;
  }

  throw new CliError('--format must be one of: json, text, table.');
}

function createExampleManifest(): ActionManifest {
  return {
    version: 1,
    actions: [
      {
      name: 'delivery.searchJobs',
      mode: 'read',
      description: 'Search delivery jobs by filters.',
      tags: ['delivery', 'operations'],
      resourceType: 'deliveryJob',
      riskLevel: 'low',
      examples: [
        {
          title: 'Find failed jobs',
          input: { status: ['FAILED'] },
        },
      ],
      approvalRequired: false,
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'array', items: { type: 'string' } },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {
            jobIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      {
      name: 'delivery.dryRunRetry',
      mode: 'dryRun',
      description: 'Validate retry candidates before mutation.',
      tags: ['delivery', 'retry'],
      resourceType: 'deliveryJob',
      riskLevel: 'medium',
      approvalRequired: false,
        inputSchema: {
          type: 'object',
          properties: {
            jobIds: { type: 'array', items: { type: 'string' } },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {
            retryable: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      {
      name: 'delivery.executeRetry',
      mode: 'mutate',
      description: 'Execute retry for approved delivery jobs.',
      tags: ['delivery', 'retry'],
      resourceType: 'deliveryJob',
      riskLevel: 'high',
      approvalRequired: true,
        inputSchema: {
          type: 'object',
          properties: {
            jobIds: { type: 'array', items: { type: 'string' } },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {
            retried: { type: 'number' },
          },
        },
      },
    ],
  };
}

function createExampleWorkflow() {
  return {
    workflowName: 'retry-failed-delivery-jobs',
    steps: [
      {
        id: 'jobs',
        action: 'delivery.searchJobs',
        input: {
          status: ['FAILED'],
        },
      },
      {
        id: 'retryCheck',
        action: 'delivery.dryRunRetry',
        input: {
          jobIds: {
            $fromStep: 'jobs',
            path: '/jobIds',
          },
        },
      },
    ],
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
  const sanitized = actionName.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
  return sanitized || 'action';
}

function isApprovalRequired(action: ActionManifestEntry): boolean {
  return Boolean(action.approvalRequired || action.mode === 'mutate');
}

function getSchemaStatus(action: ActionManifestEntry, target: 'input' | 'output'): SchemaStatus {
  const status = target === 'input' ? action.inputSchemaStatus : action.outputSchemaStatus;
  if (status) {
    return status;
  }

  const schema = target === 'input' ? action.inputSchema : action.outputSchema;
  return schema === undefined ? 'missing' : 'present';
}

function schemaStateForDisplay(action: ActionManifestEntry, target: 'input' | 'output'): string {
  return getSchemaStatus(action, target);
}

function formatDeprecated(value: boolean | string | undefined): string {
  if (typeof value === 'string') {
    return value;
  }

  return value ? 'yes' : '';
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new CliError(`Could not read JSON file "${filePath}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJson(context: CommandContext, value: unknown): void {
  context.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

function resolvePath(cwd: string, first: string, ...rest: string[]): string {
  return path.resolve(cwd, first, ...rest);
}

function writeHelp(context: CommandContext): void {
  context.stdout([
    'Usage: agent-action-runner <command>',
    '',
    'Commands:',
    '  init',
    '  actions:list',
    '  actions:inspect <actionName>',
    '  actions:export --runner <file>',
    '  workflow:validate <file> [--runner <file>]',
    '  workflow:run <file>',
    '  mcp:preview',
    '  mcp:serve',
    '  doctor',
    '  docs:generate',
    '',
  ].join('\n'));
}

function formatCliError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = error.cause;
  if (cause instanceof Error) {
    return `${error.message}\nCaused by: ${cause.message}`;
  }

  return error.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const exitCode = await runCli({
    argv: process.argv.slice(2),
  });
  process.exitCode = exitCode;
}
