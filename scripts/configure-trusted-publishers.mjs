#!/usr/bin/env node
import { exec, execFile, spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = 'npm';

const apply = parseBoolean(process.env.APPLY, false);
const precheck = parseBoolean(process.env.NPM_TRUST_PRECHECK, false);
const workflowFile = process.env.NPM_TRUST_WORKFLOW ?? 'publish.yml';
const repository = process.env.NPM_TRUST_REPOSITORY ?? inferGitHubRepository(await readRootRepositoryUrl());
const packages = await discoverPublishablePackages();

if (!repository) {
  throw new Error('Unable to infer GitHub repository. Set NPM_TRUST_REPOSITORY=owner/repo.');
}

if (packages.length === 0) {
  console.log('No publishable packages found.');
  process.exit(0);
}

console.log(`Trusted publisher mode: ${apply ? 'apply' : 'dry run'}`);
console.log(`Repository: ${repository}`);
console.log(`Workflow file: ${workflowFile}`);
console.log(`Precheck existing trust: ${precheck ? 'yes' : 'no'}`);
console.log(`Packages: ${packages.map((pkg) => pkg.name).join(', ')}`);

for (const pkg of packages) {
  const args = [
    'trust',
    'github',
    pkg.name,
    '--file',
    workflowFile,
    '--repo',
    repository,
    '--yes',
  ];

  if (!apply) {
    console.log(`would run: npm ${args.map(formatShellArg).join(' ')}`);
    continue;
  }

  if (precheck && await trustedPublisherExists(pkg.name)) {
    console.log(`skip ${pkg.name}: trusted publisher already configured`);
    continue;
  }

  console.log(`configure trusted publisher for ${pkg.name}`);
  try {
    await runNpm(args);
  } catch (error) {
    if (isTrustConflict(error)) {
      console.log(`skip ${pkg.name}: trusted publisher already configured`);
      continue;
    }

    throw error;
  }
}

async function discoverPublishablePackages() {
  const packagesDir = path.join(rootDir, 'packages');
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dir = path.join(packagesDir, entry.name);
    const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    if (manifest.private === true) {
      continue;
    }
    if (typeof manifest.name !== 'string') {
      throw new Error(`Invalid package manifest: ${path.relative(rootDir, dir)}`);
    }

    packages.push({
      dir,
      manifest,
      name: manifest.name,
    });
  }

  return packages.toSorted((a, b) => a.name.localeCompare(b.name));
}

async function readRootRepositoryUrl() {
  const manifest = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
  if (typeof manifest.repository === 'string') {
    return manifest.repository;
  }
  if (manifest.repository && typeof manifest.repository.url === 'string') {
    return manifest.repository.url;
  }
  return undefined;
}

function inferGitHubRepository(repositoryUrl) {
  if (!repositoryUrl) {
    return undefined;
  }

  const match = repositoryUrl.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.#]+)(?:\.git)?/i);
  if (!match?.groups) {
    return undefined;
  }

  return `${match.groups.owner}/${match.groups.repo}`;
}

async function runNpm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, args, {
      cwd: rootDir,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => {
      stdout.push(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr.push(chunk);
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const error = new Error(`npm ${args.join(' ')} failed with ${signal ?? `exit code ${code}`}`);
      error.stdout = Buffer.concat(stdout).toString('utf8');
      error.stderr = Buffer.concat(stderr).toString('utf8');
      reject(error);
    });
  });
}

function isTrustConflict(error) {
  const output = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}`;
  return output.includes('E409') || output.includes('409 Conflict');
}

async function trustedPublisherExists(packageName) {
  const result = await runNpmCaptured(['trust', 'list', packageName, '--json']);
  const output = result.stdout.trim();

  if (output === '') {
    return false;
  }

  const parsed = JSON.parse(output);
  const configs = Array.isArray(parsed) ? parsed : [parsed];

  return configs.some((config) => (
    config
    && config.type === 'github'
    && config.file === workflowFile
    && config.repository === repository
  ));
}

async function runNpmCaptured(args) {
  return process.platform === 'win32'
    ? execAsync([npmCommand, ...args.map(quoteShellArg)].join(' '), {
      cwd: rootDir,
      env: process.env,
      maxBuffer: 1024 * 1024 * 16,
    })
    : execFileAsync(npmCommand, args, {
      cwd: rootDir,
      env: process.env,
      maxBuffer: 1024 * 1024 * 16,
    });
}

function quoteShellArg(value) {
  if (/^[A-Za-z0-9@%_+=:,./-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function formatShellArg(value) {
  if (/^[A-Za-z0-9@%_+=:,./-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (value === '1' || value === 'true' || value === 'yes') {
    return true;
  }
  if (value === '0' || value === 'false' || value === 'no') {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}
