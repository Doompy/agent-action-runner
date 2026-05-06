import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from './index.js';

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
