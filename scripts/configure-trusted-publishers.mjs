#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = 'npm';

const apply = parseBoolean(process.env.APPLY, false);
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

  console.log(`configure trusted publisher for ${pkg.name}`);
  await runNpm(args);
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
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`npm ${args.join(' ')} failed with ${signal ?? `exit code ${code}`}`));
    });
  });
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
