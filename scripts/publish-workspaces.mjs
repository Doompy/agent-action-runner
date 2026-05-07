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

const cliDryRun = parseDryRunFlag(process.argv.slice(2));
const dryRun = cliDryRun ?? parseBoolean(process.env.DRY_RUN, true);
const access = process.env.NPM_ACCESS ?? 'public';
const distTag = process.env.NPM_TAG ?? 'latest';

const packages = sortByInternalDependencies(await discoverPublishablePackages());
const results = [];

if (packages.length === 0) {
  console.log('No publishable packages found.');
  process.exit(0);
}

console.log(`Publish mode: ${dryRun ? 'dry run' : 'publish'}`);
console.log(`Packages: ${packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}`);

for (const pkg of packages) {
  const spec = `${pkg.name}@${pkg.version}`;
  const exists = await npmVersionExists(spec);
  if (exists) {
    console.log(`skip ${spec}: already published`);
    results.push({ spec, status: 'skipped' });
    continue;
  }

  if (dryRun) {
    console.log(`would publish ${spec}`);
    results.push({ spec, status: 'would-publish' });
    continue;
  }

  console.log(`publish ${spec}`);
  await runNpm([
    'publish',
    '--workspace',
    pkg.name,
    '--access',
    access,
    '--tag',
    distTag,
  ]);
  results.push({ spec, status: 'published' });
}

const published = results.filter((result) => result.status === 'published').length;
const wouldPublish = results.filter((result) => result.status === 'would-publish').length;
const skipped = results.filter((result) => result.status === 'skipped').length;
console.log(`Summary: ${published} published, ${wouldPublish} would publish, ${skipped} skipped.`);

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
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`Invalid package manifest: ${path.relative(rootDir, dir)}`);
    }

    packages.push({
      dir,
      manifest,
      name: manifest.name,
      version: manifest.version,
    });
  }

  return packages;
}

function sortByInternalDependencies(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const sorted = [];
  const visiting = new Set();
  const visited = new Set();

  for (const pkg of packages.toSorted((a, b) => a.name.localeCompare(b.name))) {
    visit(pkg);
  }

  return sorted;

  function visit(pkg) {
    if (visited.has(pkg.name)) {
      return;
    }
    if (visiting.has(pkg.name)) {
      throw new Error(`Circular internal dependency detected at ${pkg.name}`);
    }

    visiting.add(pkg.name);
    for (const depName of internalDependencyNames(pkg.manifest, byName)) {
      visit(byName.get(depName));
    }
    visiting.delete(pkg.name);
    visited.add(pkg.name);
    sorted.push(pkg);
  }
}

function internalDependencyNames(manifest, byName) {
  const dependencyBlocks = [
    manifest.dependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ];
  const names = new Set();

  for (const block of dependencyBlocks) {
    if (!block || typeof block !== 'object') {
      continue;
    }
    for (const name of Object.keys(block)) {
      if (byName.has(name)) {
        names.add(name);
      }
    }
  }

  return [...names].sort();
}

async function npmVersionExists(spec) {
  try {
    await runNpm(['view', spec, 'version', '--json'], { silent: true });
    return true;
  } catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    if (output.includes('E404') || output.includes('404 Not Found') || output.includes('404')) {
      return false;
    }
    throw error;
  }
}

async function runNpm(args, options = {}) {
  if (!options.silent) {
    return runNpmInteractive(args);
  }

  try {
    const result = process.platform === 'win32'
      ? await execAsync([npmCommand, ...args.map(quoteShellArg)].join(' '), {
        cwd: rootDir,
        env: process.env,
        maxBuffer: 1024 * 1024 * 16,
      })
      : await execFileAsync(npmCommand, args, {
        cwd: rootDir,
        env: process.env,
        maxBuffer: 1024 * 1024 * 16,
      });

    return result;
  } catch (error) {
    throw error;
  }
}

function runNpmInteractive(args) {
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
        resolve({ stdout: '', stderr: '' });
        return;
      }

      reject(new Error(`npm ${args.join(' ')} failed with ${signal ?? `exit code ${code}`}`));
    });
  });
}

function quoteShellArg(value) {
  if (/^[A-Za-z0-9@%_+=:,./-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
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

function parseDryRunFlag(args) {
  let mode;
  for (const arg of args) {
    if (arg === '--dry-run') {
      if (mode === false) {
        throw new Error('Use only one of --dry-run or --publish.');
      }
      mode = true;
      continue;
    }

    if (arg === '--publish') {
      if (mode === true) {
        throw new Error('Use only one of --dry-run or --publish.');
      }
      mode = false;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return mode;
}
