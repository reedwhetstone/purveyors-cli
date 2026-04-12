#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const repoRoot = resolve(__dirname, '..');

export const REQUIRED_PACKAGE_EXPORTS = {
  '.': './dist/index.js',
  './catalog': './dist/lib/catalog.js',
  './inventory': './dist/lib/inventory.js',
  './roast': './dist/lib/roast.js',
  './sales': './dist/lib/sales.js',
  './tasting': './dist/lib/tasting.js',
  './lib': './dist/lib/index.js',
  './manifest': './dist/lib/manifest.js',
  './artisan': './dist/lib/artisan/index.js',
  './ai': './dist/lib/ai.js',
};

export const REQUIRED_SELF_IMPORT_EXPORTS = Object.fromEntries(
  Object.entries(REQUIRED_PACKAGE_EXPORTS).filter(([exportKey]) => exportKey !== '.')
);

export const REQUIRED_PACKAGE_FILES = ['dist', 'README.md', 'LICENSE.md'];

export const REQUIRED_README_SNIPPETS = [
  'purvey manifest',
  'purvey context --json',
  '@purveyors/cli/manifest',
  'No pre-existing session is required for `auth`, `config`, `context`, or `manifest`.',
];

export const REQUIRED_HELP_SNIPPETS = [
  'manifest',
  'Human reference:  purvey context',
  'JSON manifest:    purvey manifest',
];

export function stripAnsi(text) {
  return text.replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').replace(/\r/g, '');
}

function formatStdio(result) {
  return [
    result.stdout ? `stdout:\n${stripAnsi(result.stdout).trim()}` : 'stdout: <empty>',
    result.stderr ? `stderr:\n${stripAnsi(result.stderr).trim()}` : 'stderr: <empty>',
  ].join('\n\n');
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), 'utf8'));
}

function readText(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function stripDotSlash(path) {
  return path.replace(/^\.\//, '');
}

function assertPathExists(relativePath, label = relativePath) {
  assert(
    existsSync(resolve(repoRoot, relativePath)),
    `${label} is missing from the release surface: ${relativePath}`
  );
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      ...env,
    },
  });

  if (result.error) {
    fail(`Failed to execute ${command} ${args.join(' ')}: ${result.error.message}`);
  }

  return result;
}

function collectPackageTargets(value) {
  if (typeof value === 'string') {
    return [stripDotSlash(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectPackageTargets);
  }

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectPackageTargets);
  }

  return [];
}

function getPackDryRun() {
  const result = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts']);

  if (result.status !== 0) {
    fail(`npm pack --dry-run failed.\n\n${formatStdio(result)}`);
  }

  try {
    const [packResult] = JSON.parse(result.stdout);
    return packResult;
  } catch (error) {
    fail(`npm pack --dry-run did not emit valid JSON.\n\n${formatStdio(result)}\n\n${error}`);
  }
}

function assertSuccessfulRun(result, label) {
  if (result.status !== 0 || stripAnsi(result.stderr).trim() !== '') {
    fail(`${label} failed.\n\n${formatStdio(result)}`);
  }
}

function parseJsonStdout(result, label) {
  assertSuccessfulRun(result, label);

  try {
    return JSON.parse(stripAnsi(result.stdout).trim());
  } catch (error) {
    fail(`${label} did not emit valid JSON.\n\n${formatStdio(result)}\n\n${error}`);
  }
}

function assertDeepEqual(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(
      `${label} drifted.\n\nActual:\n${JSON.stringify(actual, null, 2)}\n\nExpected:\n${JSON.stringify(expected, null, 2)}`
    );
  }
}

function assertTextEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} drifted.\n\nActual:\n${actual}\n\nExpected:\n${expected}`);
  }
}

export function assertPackageReleaseSurface(packageJson) {
  assert(packageJson.name === '@purveyors/cli', 'package.json name must stay @purveyors/cli');
  assert(
    packageJson.bin?.purvey === './dist/index.js',
    'package.json bin.purvey must point at ./dist/index.js'
  );
  assertDeepEqual(packageJson.exports, REQUIRED_PACKAGE_EXPORTS, 'package.json exports contract');

  for (const requiredFile of REQUIRED_PACKAGE_FILES) {
    assert(
      Array.isArray(packageJson.files) && packageJson.files.includes(requiredFile),
      `package.json files must include ${requiredFile}`
    );
  }

  assertPathExists(packageJson.bin.purvey, 'CLI dist entrypoint');

  for (const [exportKey, exportPath] of Object.entries(REQUIRED_PACKAGE_EXPORTS)) {
    if (typeof exportPath === 'string' && exportPath.startsWith('./dist/')) {
      assertPathExists(exportPath, `package export ${exportKey}`);
    }
  }

  for (const requiredFile of REQUIRED_PACKAGE_FILES) {
    assertPathExists(requiredFile, `package files entry ${requiredFile}`);
  }

  const packResult = getPackDryRun();
  const packedPaths = new Set((packResult.files ?? []).map((file) => file.path));
  const expectedPackedPaths = new Set([
    ...REQUIRED_PACKAGE_FILES.filter((entry) => entry !== 'dist'),
    ...Object.values(packageJson.bin ?? {}).map(stripDotSlash),
    ...collectPackageTargets(REQUIRED_PACKAGE_EXPORTS),
  ]);

  for (const packedPath of expectedPackedPaths) {
    assert(
      packedPaths.has(packedPath),
      `npm pack --dry-run is missing required publish path: ${packedPath}`
    );
  }

  const distEntrypoint = (packResult.files ?? []).find((file) => file.path === 'dist/index.js');
  assert(
    distEntrypoint?.mode === 0o755,
    'npm pack --dry-run must keep dist/index.js executable in the publish artifact'
  );
}

export function assertReadmeReleaseSurface(readmeText) {
  for (const snippet of REQUIRED_README_SNIPPETS) {
    assert(
      readmeText.includes(snippet),
      `README.md is missing required release snippet: ${snippet}`
    );
  }
}

export function assertHelpSurface(helpText, label) {
  for (const snippet of REQUIRED_HELP_SNIPPETS) {
    assert(helpText.includes(snippet), `${label} is missing help snippet: ${snippet}`);
  }
}

export function assertManifestSurface(manifest, label) {
  assert(manifest && typeof manifest === 'object', `${label} must be an object`);
  assert(manifest.schemaVersion === '1', `${label} must keep schemaVersion 1`);
  assert(manifest.binary === 'purvey', `${label} must keep binary purvey`);
  assert(
    manifest.packageName === '@purveyors/cli',
    `${label} must keep packageName @purveyors/cli`
  );

  const commandGroupNames = Array.isArray(manifest.commandGroups)
    ? manifest.commandGroups.map((group) => group?.name)
    : [];

  for (const requiredGroup of ['context', 'manifest']) {
    assert(
      commandGroupNames.includes(requiredGroup),
      `${label} is missing command group ${requiredGroup}`
    );
  }
}

function runSourceCli(args) {
  return run('pnpm', ['exec', 'tsx', 'src/index.ts', ...args]);
}

function runDistCli(args) {
  return run('node', ['dist/index.js', ...args]);
}

function runSelfImportManifest() {
  return run('node', [
    '--input-type=module',
    '-e',
    "import { getCliManifest } from '@purveyors/cli/manifest'; console.log(JSON.stringify(getCliManifest()));",
  ]);
}

function runSelfImportExports() {
  const specifiers = Object.keys(REQUIRED_SELF_IMPORT_EXPORTS).map(
    (exportKey) => `@purveyors/cli${exportKey.slice(1)}`
  );

  return run(
    'node',
    [
      '--input-type=module',
      '-e',
      `const specifiers = ${JSON.stringify(specifiers)};\nconst loaded = [];\nfor (const specifier of specifiers) {\n  const moduleNamespace = await import(specifier);\n  loaded.push({ specifier, keys: Object.keys(moduleNamespace).sort() });\n}\nconsole.log(JSON.stringify(loaded));`,
    ],
    {
      PURVEYORS_SUPABASE_URL: 'https://placeholder.supabase.co',
      PURVEYORS_SUPABASE_ANON_KEY: 'placeholder-anon-key',
    }
  );
}

export function verifyPrepublishParity() {
  const packageJson = readJson('package.json');
  const readmeText = readText('README.md');

  assertPackageReleaseSurface(packageJson);
  assertReadmeReleaseSurface(readmeText);

  const sourceHelpResult = runSourceCli(['--help']);
  const distHelpResult = runDistCli(['--help']);

  assertSuccessfulRun(sourceHelpResult, 'source help smoke check');
  assertSuccessfulRun(distHelpResult, 'dist help smoke check');

  const sourceHelp = stripAnsi(sourceHelpResult.stdout);
  const distHelp = stripAnsi(distHelpResult.stdout);
  assertHelpSurface(sourceHelp, 'source help');
  assertHelpSurface(distHelp, 'dist help');
  assertTextEqual(distHelp, sourceHelp, 'Source and dist help output');

  const sourceManifest = parseJsonStdout(runSourceCli(['manifest']), 'source manifest smoke check');
  const sourceContext = parseJsonStdout(
    runSourceCli(['context', '--json']),
    'source context --json smoke check'
  );
  const distManifest = parseJsonStdout(runDistCli(['manifest']), 'dist manifest smoke check');
  const distContext = parseJsonStdout(
    runDistCli(['context', '--json']),
    'dist context --json smoke check'
  );
  const importManifest = parseJsonStdout(
    runSelfImportManifest(),
    'package self-import manifest smoke check'
  );
  const importExports = parseJsonStdout(
    runSelfImportExports(),
    'package self-import subpath smoke check'
  );

  for (const [label, manifest] of [
    ['source manifest', sourceManifest],
    ['source context --json', sourceContext],
    ['dist manifest', distManifest],
    ['dist context --json', distContext],
    ['self-import manifest', importManifest],
  ]) {
    assertManifestSurface(manifest, label);
  }

  assertDeepEqual(sourceContext, sourceManifest, 'Source manifest and source context --json');
  assertDeepEqual(distManifest, sourceManifest, 'Dist manifest and source manifest');
  assertDeepEqual(distContext, sourceContext, 'Dist context --json and source context --json');
  assertDeepEqual(importManifest, sourceManifest, 'Self-import manifest and source manifest');
  assert(
    Array.isArray(importExports) &&
      importExports.length === Object.keys(REQUIRED_SELF_IMPORT_EXPORTS).length,
    'Self-import subpath smoke check must load every stable exported subpath'
  );

  return {
    checked: [
      'package.json bin/files/exports surface',
      'npm pack dry-run publish surface',
      'README machine-readable contract snippets',
      'source vs dist help parity',
      'source manifest/context parity',
      'dist manifest/context parity',
      'package self-import manifest parity',
      'package self-import subpath parity',
    ],
  };
}

function isDirectRun() {
  return process.argv[1] && resolve(process.argv[1]) === __filename;
}

if (isDirectRun()) {
  try {
    const result = verifyPrepublishParity();
    console.log(`Prepublish parity OK: ${result.checked.join('; ')}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
