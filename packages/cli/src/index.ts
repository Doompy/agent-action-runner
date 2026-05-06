#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ActionMode, WorkflowValidationAction } from '@agent-action-runner/core';
import { validateWorkflowDefinition } from '@agent-action-runner/core';

const DEFAULT_CONFIG_FILE = 'agent-runner.config.json';
const DEFAULT_ALLOWED_MODES: readonly ActionMode[] = ['read', 'draft', 'dryRun'];
const ACTION_MODES: readonly ActionMode[] = ['read', 'draft', 'dryRun', 'mutate'];

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
  readonly approvalRequired?: boolean;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
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
  readonly exported: boolean;
  readonly toolName?: string;
  readonly reason?: 'modeNotExposed' | 'mutationNotExposed' | 'schemaMissing';
};

type DoctorWarning = {
  readonly actionName?: string;
  readonly code: string;
  readonly message: string;
};

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
      case 'workflow:validate':
        return await runWorkflowValidate(context, parseArgs(rest));
      case 'mcp:preview':
        await runMcpPreview(context, parseArgs(rest));
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
    context.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
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
  const manifest = await loadManifest(context, args);
  if (args.flags.has('json')) {
    writeJson(context, { actions: manifest.actions });
    return;
  }

  context.stdout('Registered Actions\n\n');
  for (const action of manifest.actions) {
    const approval = isApprovalRequired(action) ? ' approvalRequired' : '';
    const description = action.description ? ` - ${action.description}` : '';
    context.stdout(`- ${action.name.padEnd(32)} ${action.mode}${approval}${description}\n`);
  }
}

async function runActionsInspect(context: CommandContext, args: ParsedArgs): Promise<void> {
  const actionName = args.positionals[0];
  if (!actionName) {
    throw new CliError('actions:inspect requires an action name.');
  }

  const manifest = await loadManifest(context, args);
  const action = manifest.actions.find((candidate) => candidate.name === actionName);
  if (!action) {
    throw new CliError(`Action "${actionName}" was not found in the manifest.`);
  }

  if (args.flags.has('json')) {
    writeJson(context, { action });
    return;
  }

  context.stdout([
    `Action: ${action.name}`,
    `Mode: ${action.mode}`,
    `Approval required: ${isApprovalRequired(action) ? 'yes' : 'no'}`,
    `Description: ${action.description ?? ''}`,
    `Input schema: ${schemaState(action.inputSchema)}`,
    `Output schema: ${schemaState(action.outputSchema)}`,
    '',
  ].join('\n'));
}

async function runWorkflowValidate(context: CommandContext, args: ParsedArgs): Promise<number> {
  const workflowFile = args.positionals[0];
  if (!workflowFile) {
    throw new CliError('workflow:validate requires a workflow JSON file.');
  }

  const manifest = await loadManifest(context, args);
  const workflow = await readJsonFile(resolvePath(context.cwd, workflowFile));
  const result = validateWorkflowDefinition(workflow, {
    actions: toValidationActions(manifest),
  });

  if (args.flags.has('json')) {
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

async function runMcpPreview(context: CommandContext, args: ParsedArgs): Promise<void> {
  const config = await loadConfig(context, args);
  const manifest = await loadManifest(context, args, config);
  const exposeMutations = args.flags.has('expose-mutations') || config.mcp.exposeMutations;
  const report = createManifestMcpPreview(manifest, {
    exposeModes: config.mcp.exposeModes,
    exposeMutations,
  });

  if (args.flags.has('json')) {
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

async function runDoctor(context: CommandContext, args: ParsedArgs): Promise<number> {
  const manifest = await loadManifest(context, args);
  const warnings = createDoctorWarnings(manifest);

  if (args.flags.has('json')) {
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
  const manifest = await loadManifest(context, args);
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
    if (!action.description) {
      warnings.push({
        actionName: action.name,
        code: 'missingDescription',
        message: 'action is missing a description.',
      });
    }
    if (action.inputSchema === undefined) {
      warnings.push({
        actionName: action.name,
        code: 'missingInputSchema',
        message: 'action is missing inputSchema metadata.',
      });
    }
    if (action.outputSchema === undefined) {
      warnings.push({
        actionName: action.name,
        code: 'missingOutputSchema',
        message: 'action is missing outputSchema metadata.',
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
    '| Action | Mode | Approval | Description |',
    '|---|---|---|---|',
    ...manifest.actions.map((action) => (
      `| \`${action.name}\` | ${action.mode} | ${isApprovalRequired(action) ? 'required' : 'not required'} | ${action.description ?? ''} |`
    )),
    '',
  ].join('\n');
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

  const mcp = isRecord(raw.mcp) ? raw.mcp : {};
  return {
    manifest: typeof raw.manifest === 'string' ? raw.manifest : DEFAULT_CONFIG.manifest,
    runner: typeof raw.runner === 'string' ? raw.runner : DEFAULT_CONFIG.runner,
    workflowsDir: typeof raw.workflowsDir === 'string' ? raw.workflowsDir : DEFAULT_CONFIG.workflowsDir,
    mcp: {
      exposeModes: parseExposeModes(mcp.exposeModes),
      exposeMutations: typeof mcp.exposeMutations === 'boolean'
        ? mcp.exposeMutations
        : DEFAULT_CONFIG.mcp.exposeMutations,
    },
  };
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
    approvalRequired: typeof value.approvalRequired === 'boolean' ? value.approvalRequired : undefined,
    inputSchema: value.inputSchema,
    outputSchema: value.outputSchema,
  };
}

function toValidationActions(manifest: ActionManifest): readonly WorkflowValidationAction[] {
  return manifest.actions.map((action) => ({
    name: action.name,
    mode: action.mode,
  }));
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
    if (name === 'config' || name === 'out') {
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

function createExampleManifest(): ActionManifest {
  return {
    version: 1,
    actions: [
      {
        name: 'delivery.searchJobs',
        mode: 'read',
        description: 'Search delivery jobs by filters.',
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

function schemaState(value: unknown): string {
  return value === undefined ? 'missing' : 'present';
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
    '  workflow:validate <file>',
    '  mcp:preview',
    '  doctor',
    '  docs:generate',
    '',
  ].join('\n'));
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
