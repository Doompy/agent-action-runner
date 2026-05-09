#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedVersion = parseExpectedVersion(process.argv.slice(2));
const rootPackage = await readJson('package.json');
const rootVersion = expectedVersion ?? rootPackage.version;
const lockfile = await readJson('package-lock.json');
const changelog = await readFile(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
const publicPackages = await discoverPublicPackages();
const failures = [];

expectEqual('root package version', rootPackage.version, rootVersion);
expectEqual('package-lock root version', lockfile.version, rootVersion);
expectEqual('package-lock packages[""].version', lockfile.packages?.['']?.version, rootVersion);

if (!changelog.includes(`## [${rootVersion}]`)) {
  failures.push(`CHANGELOG.md is missing section: ## [${rootVersion}]`);
}

const publicNames = new Set(publicPackages.map((pkg) => pkg.manifest.name));
for (const pkg of publicPackages) {
  const packageLabel = pkg.manifest.name;
  expectEqual(`${packageLabel} version`, pkg.manifest.version, rootVersion);
  expectEqual(
    `package-lock ${pkg.relativeDir} version`,
    lockfile.packages?.[pkg.relativeDir]?.version,
    rootVersion,
  );

  for (const blockName of ['dependencies', 'peerDependencies']) {
    const block = pkg.manifest[blockName];
    if (!block || typeof block !== 'object') {
      continue;
    }

    for (const [dependencyName, range] of Object.entries(block)) {
      if (publicNames.has(dependencyName)) {
        expectEqual(
          `${packageLabel} ${blockName}.${dependencyName}`,
          range,
          `^${rootVersion}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Release consistency check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Release consistency check passed for ${rootVersion}.`);

async function discoverPublicPackages() {
  const packagesDir = path.join(rootDir, 'packages');
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const relativeDir = path.join('packages', entry.name).replace(/\\/g, '/');
    const manifest = await readJson(path.join(relativeDir, 'package.json'));
    if (manifest.private === true) {
      continue;
    }
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      failures.push(`Invalid package manifest: ${relativeDir}`);
      continue;
    }

    packages.push({
      relativeDir,
      manifest,
    });
  }

  return packages.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(rootDir, relativePath), 'utf8'));
}

function expectEqual(label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

function parseExpectedVersion(args) {
  if (args.length === 0) {
    return undefined;
  }
  if (args.length === 1) {
    return normalizeVersion(args[0]);
  }
  if (args.length === 2 && args[0] === '--version') {
    return normalizeVersion(args[1]);
  }

  throw new Error('Usage: node scripts/check-release-consistency.mjs [--version] <version>');
}

function normalizeVersion(value) {
  return value.startsWith('v') ? value.slice(1) : value;
}
