#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const version = normalizeVersion(args.version ?? args._[0]);
const changelogPath = args.changelog ?? 'CHANGELOG.md';
const outputPath = args.out;

if (!version) {
  fail(`Usage: node ${basename(process.argv[1] ?? 'extract-changelog-section.mjs')} <version> [--changelog CHANGELOG.md] [--out notes.md]`);
}

const changelog = await readFile(changelogPath, 'utf8');
const section = extractSection(changelog, version);

if (!section) {
  fail(`Could not find changelog section for ${version} in ${changelogPath}.`);
}

if (outputPath) {
  await writeFile(outputPath, `${section}\n`, 'utf8');
} else {
  process.stdout.write(`${section}\n`);
}

function extractSection(changelog, version) {
  const escaped = escapeRegExp(version);
  const headerPattern = new RegExp(`^## \\[(?:v)?${escaped}\\].*$`, 'm');
  const match = headerPattern.exec(changelog);
  if (!match || match.index === undefined) {
    return undefined;
  }

  const start = match.index;
  const afterHeader = start + match[0].length;
  const nextHeaderPattern = /^## \[/gm;
  nextHeaderPattern.lastIndex = afterHeader;
  const next = nextHeaderPattern.exec(changelog);
  const end = next?.index ?? changelog.length;

  return changelog.slice(start, end).trim();
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--version') {
      parsed.version = argv[++index];
    } else if (arg === '--changelog') {
      parsed.changelog = argv[++index];
    } else if (arg === '--out') {
      parsed.out = argv[++index];
    } else {
      parsed._.push(arg);
    }
  }
  return parsed;
}

function normalizeVersion(version) {
  if (!version) {
    return undefined;
  }
  return version.startsWith('v') ? version.slice(1) : version;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
