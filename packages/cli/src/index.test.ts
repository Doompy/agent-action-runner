import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRunner } from '@agent-action-runner/core';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createMcpServerForCli, runCli } from './index.js';

describe('@agent-action-runner/cli manifest commands', () => {
  it('init creates config, manifest, and example workflow', async () => {
    const cwd = await createTempDir();
    const result = await runTestCli(cwd, ['init']);

    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(cwd, 'agent-runner.config.json'))).toBe(true);
    expect(existsSync(path.join(cwd, '.agent-runner', 'actions.json'))).toBe(true);
    expect(existsSync(path.join(cwd, 'agent-workflows', 'example.workflow.json'))).toBe(true);
  });

  it('init refuses overwrite without force', async () => {
    const cwd = await createTempDir();
    expect((await runTestCli(cwd, ['init'])).exitCode).toBe(0);

    const result = await runTestCli(cwd, ['init']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Refusing to overwrite existing file');
  });

  it('lists and inspects actions from the manifest', async () => {
    const cwd = await createInitializedProject();

    const list = await runTestCli(cwd, ['actions:list']);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain('delivery.searchJobs');
    expect(list.stdout).toContain('delivery.executeRetry');

    const inspect = await runTestCli(cwd, ['actions:inspect', 'delivery.searchJobs', '--json']);
    expect(inspect.exitCode).toBe(0);
    expect(JSON.parse(inspect.stdout).action).toMatchObject({
      name: 'delivery.searchJobs',
      mode: 'read',
    });

    const formatted = await runTestCli(cwd, ['actions:list', '--format', 'json']);
    expect(formatted.exitCode).toBe(0);
    expect(JSON.parse(formatted.stdout).actions).toHaveLength(3);
  });

  it('validates workflow files with manifest actions and step references', async () => {
    const cwd = await createInitializedProject();

    const valid = await runTestCli(cwd, ['workflow:validate', './agent-workflows/example.workflow.json']);
    expect(valid.exitCode).toBe(0);
    expect(valid.stdout).toContain('Workflow is valid');

    const invalidWorkflow = path.join(cwd, 'agent-workflows', 'invalid.workflow.json');
    await writeFile(invalidWorkflow, JSON.stringify({
      workflowName: 'invalid',
      steps: [
        {
          id: 'retryCheck',
          action: 'delivery.dryRunRetry',
          input: {
            jobIds: { $fromStep: 'jobs', path: '/jobIds' },
          },
        },
      ],
    }), 'utf8');

    const invalid = await runTestCli(cwd, ['workflow:validate', invalidWorkflow, '--json']);
    expect(invalid.exitCode).toBe(1);
    expect(JSON.parse(invalid.stdout).issues[0]).toMatchObject({
      code: 'invalidStepReference',
    });
  });

  it('previews MCP exports from the manifest', async () => {
    const cwd = await createInitializedProject();

    const result = await runTestCli(cwd, ['mcp:preview']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('delivery_searchJobs');
    expect(result.stdout).toContain('delivery.executeRetry reason: mutationNotExposed');
  });

  it('doctor reports risky manifest entries', async () => {
    const cwd = await createInitializedProject();
    const manifestPath = path.join(cwd, '.agent-runner', 'actions.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.actions.push({
      name: 'danger.mutate',
      mode: 'mutate',
    });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const result = await runTestCli(cwd, ['doctor', '--json']);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionName: 'danger.mutate',
        code: 'mutateWithoutApproval',
      }),
    ]));
  });

  it('generates markdown docs from the manifest', async () => {
    const cwd = await createInitializedProject();

    const result = await runTestCli(cwd, ['docs:generate']);

    expect(result.exitCode).toBe(0);
    const docs = await readFile(path.join(cwd, 'docs', 'agent-actions.md'), 'utf8');
    expect(docs).toContain('# Agent Actions');
    expect(docs).toContain('`delivery.searchJobs`');
  });
});

describe('@agent-action-runner/cli runner module commands', () => {
  it('imports a runner from named runner export and runs a workflow', async () => {
    const cwd = await createTempDir();
    const runnerPath = await writeRunnerModule(cwd, { exportStyle: 'named' });
    const workflowPath = await writeWorkflow(cwd, 'double.workflow.json', {
      workflowName: 'double',
      steps: [
        {
          id: 'double',
          action: 'math.double',
          input: { value: 2 },
        },
      ],
    });

    const result = await runTestCli(cwd, [
      'workflow:run',
      workflowPath,
      '--runner',
      runnerPath,
      '--user-id',
      'dev_user',
      '--metadata-json',
      '{"source":"test"}',
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).outputByStep.double).toEqual({ value: 4 });
  });

  it('imports a runner from default export', async () => {
    const cwd = await createTempDir();
    const runnerPath = await writeRunnerModule(cwd, { exportStyle: 'default' });
    const workflowPath = await writeWorkflow(cwd, 'search.workflow.json', {
      workflowName: 'search',
      steps: [
        {
          id: 'jobs',
          action: 'delivery.searchJobs',
          input: { status: ['FAILED'] },
        },
      ],
    });

    const result = await runTestCli(cwd, ['workflow:run', workflowPath, '--runner', runnerPath]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).outputByStep.jobs).toEqual({ jobIds: ['job_1'] });
  });

  it('validates workflows against a real runner when --runner is supplied', async () => {
    const cwd = await createTempDir();
    const runnerPath = await writeRunnerModule(cwd, { exportStyle: 'named' });
    const workflowPath = await writeWorkflow(cwd, 'validate-runner.workflow.json', {
      workflowName: 'validate-runner',
      steps: [
        {
          id: 'double',
          action: 'math.double',
          input: { value: 4 },
        },
      ],
    });

    const valid = await runTestCli(cwd, [
      'workflow:validate',
      workflowPath,
      '--runner',
      runnerPath,
      '--format',
      'json',
    ]);
    expect(valid.exitCode).toBe(0);
    expect(JSON.parse(valid.stdout).valid).toBe(true);
  });

  it('blocks mutate workflows by default and allows them with explicit opt-in', async () => {
    const cwd = await createTempDir();
    const runnerPath = await writeRunnerModule(cwd, { exportStyle: 'named' });
    const workflowPath = await writeWorkflow(cwd, 'mutate.workflow.json', {
      workflowName: 'mutate',
      steps: [
        {
          id: 'retry',
          action: 'delivery.executeRetry',
          input: { jobIds: ['job_1'] },
        },
      ],
    });

    const blocked = await runTestCli(cwd, ['workflow:run', workflowPath, '--runner', runnerPath]);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr).toContain('not allowed');

    const allowed = await runTestCli(cwd, [
      'workflow:run',
      workflowPath,
      '--runner',
      runnerPath,
      '--allow-mutate',
    ]);
    expect(allowed.exitCode).toBe(0);
    expect(JSON.parse(allowed.stdout).outputByStep.retry).toEqual({ retried: 1 });
  });

  it('uses a real runner for MCP preview when --runner is supplied', async () => {
    const cwd = await createTempDir();
    const runnerPath = await writeRunnerModule(cwd, { exportStyle: 'named' });

    const result = await runTestCli(cwd, ['mcp:preview', '--runner', runnerPath, '--json']);

    expect(result.exitCode).toBe(0);
    const tools = JSON.parse(result.stdout).tools;
    expect(tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionName: 'math.double',
        exported: true,
        toolName: 'math_double',
      }),
      expect.objectContaining({
        actionName: 'delivery.executeRetry',
        exported: false,
        reason: 'mutationNotExposed',
      }),
    ]));
  });

  it('lists and inspects actions from a real runner when --runner is supplied', async () => {
    const cwd = await createTempDir();
    const runnerPath = await writeRunnerModule(cwd, { exportStyle: 'named' });

    const list = await runTestCli(cwd, ['actions:list', '--runner', runnerPath]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain('math.double');
    expect(list.stdout).toContain('danger.rawMutation');

    const inspect = await runTestCli(cwd, ['actions:inspect', 'math.double', '--runner', runnerPath, '--json']);
    expect(inspect.exitCode).toBe(0);
    expect(JSON.parse(inspect.stdout).action).toMatchObject({
      name: 'math.double',
      inputSchemaStatus: 'present',
      outputSchemaStatus: 'present',
    });
  });

  it('exports a manifest from a real runner', async () => {
    const cwd = await createTempDir();
    const runnerPath = await writeRunnerModule(cwd, { exportStyle: 'named' });
    const out = path.join(cwd, '.agent-runner', 'actions.json');

    const result = await runTestCli(cwd, ['actions:export', '--runner', runnerPath, '--out', out]);

    expect(result.exitCode).toBe(0);
    const manifest = JSON.parse(await readFile(out, 'utf8'));
    expect(manifest.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'math.double',
        inputSchemaStatus: 'present',
      }),
      expect.objectContaining({
        name: 'danger.rawMutation',
        inputSchemaStatus: 'schemaNotSerializable',
        outputSchemaStatus: 'missing',
      }),
    ]));
  });

  it('generates docs and doctor warnings from a real runner', async () => {
    const cwd = await createTempDir();
    const runnerPath = await writeRunnerModule(cwd, { exportStyle: 'named' });
    const out = path.join(cwd, 'docs.md');

    const docs = await runTestCli(cwd, ['docs:generate', '--runner', runnerPath, '--out', out]);
    expect(docs.exitCode).toBe(0);
    expect(await readFile(out, 'utf8')).toContain('schemaNotSerializable');

    const doctor = await runTestCli(cwd, ['doctor', '--runner', runnerPath, '--json']);
    expect(doctor.exitCode).toBe(1);
    expect(JSON.parse(doctor.stdout).warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionName: 'danger.rawMutation',
        code: 'mutateWithoutApproval',
      }),
      expect.objectContaining({
        actionName: 'danger.rawMutation',
        code: 'inputSchemaNotSerializable',
      }),
    ]));
  });

  it('creates an MCP server helper without binding stdio', async () => {
    const runner = createRunner();
    runner.registerAction({
      name: 'math.double',
      mode: 'read',
      inputSchema: z.object({ value: z.number() }),
      handler: (input) => ({ value: input.value * 2 }),
    });

    const server = await createMcpServerForCli({
      runner,
      userId: 'dev_user',
    });

    expect(server).toBeTruthy();
  });
});

async function createInitializedProject(): Promise<string> {
  const cwd = await createTempDir();
  const result = await runTestCli(cwd, ['init']);
  expect(result.exitCode).toBe(0);
  return cwd;
}

async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'aar-cli-'));
}

async function runTestCli(cwd: string, argv: readonly string[]) {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli({
    argv,
    cwd,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });

  return {
    exitCode,
    stderr,
    stdout,
  };
}

async function writeWorkflow(cwd: string, name: string, workflow: unknown): Promise<string> {
  const workflowPath = path.join(cwd, name);
  await writeFile(workflowPath, JSON.stringify(workflow, null, 2), 'utf8');
  return workflowPath;
}

async function writeRunnerModule(
  cwd: string,
  options: {
    readonly exportStyle: 'default' | 'named';
  },
): Promise<string> {
  const runnerPath = path.join(cwd, `runner-${options.exportStyle}.mjs`);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const coreImport = pathToFileURL(path.join(repoRoot, 'packages', 'core', 'dist', 'index.js')).href;
  const exportStatement = options.exportStyle === 'named'
    ? 'export { runner };'
    : 'export default runner;';
  await writeFile(runnerPath, `
import { createRunner } from '${coreImport}';

const objectSchema = {
  safeParse: (value) => ({ success: true, data: value }),
  toJSONSchema: () => ({ type: 'object', additionalProperties: true }),
};

const rawSchema = {
  safeParse: (value) => ({ success: true, data: value }),
};

const runner = createRunner({
  approval: () => ({ approved: true, approvalId: 'approval_test' }),
});

runner.registerAction({
  name: 'math.double',
  mode: 'read',
  description: 'Double a number.',
  inputSchema: objectSchema,
  outputSchema: objectSchema,
  handler: (input) => ({ value: input.value * 2 }),
});

runner.registerAction({
  name: 'delivery.searchJobs',
  mode: 'read',
  description: 'Search delivery jobs.',
  inputSchema: objectSchema,
  outputSchema: objectSchema,
  handler: () => ({ jobIds: ['job_1'] }),
});

runner.registerAction({
  name: 'delivery.executeRetry',
  mode: 'mutate',
  description: 'Retry approved jobs.',
  approvalRequired: true,
  inputSchema: objectSchema,
  outputSchema: objectSchema,
  handler: (input) => ({ retried: input.jobIds.length }),
});

runner.registerAction({
  name: 'danger.rawMutation',
  mode: 'mutate',
  description: 'Raw mutation without serialized schemas.',
  inputSchema: rawSchema,
  handler: () => ({ ok: true }),
});

${exportStatement}
`, 'utf8');
  return runnerPath;
}
