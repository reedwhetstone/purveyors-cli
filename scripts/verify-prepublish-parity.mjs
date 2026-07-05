#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

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
  './ai': './dist/lib/ai.js',
};

export const REQUIRED_SELF_IMPORT_EXPORTS = Object.fromEntries(
  Object.entries(REQUIRED_PACKAGE_EXPORTS).filter(([exportKey]) => exportKey !== '.')
);

export const REQUIRED_SELF_IMPORT_MEMBERS = {
  './catalog': [
    'searchCatalog',
    'getCatalog',
    'getCatalogStats',
    'listCatalogFacets',
    'rankCatalog',
    'findSimilarBeans',
  ],
  './inventory': [
    'listInventory',
    'getInventory',
    'addInventory',
    'updateInventory',
    'deleteInventory',
  ],
  './roast': ['listRoasts', 'getRoast', 'createRoast', 'updateRoast', 'deleteRoast'],
  './sales': ['listSales', 'recordSale', 'updateSale', 'deleteSale'],
  './tasting': ['getTastingNotes', 'rateCoffee'],
  './lib': [
    'searchCatalog',
    'listCatalogFacets',
    'rankCatalog',
    'listInventory',
    'listRoasts',
    'recordSale',
    'getCliManifest',
  ],
  './manifest': ['getCliManifest', 'renderContextText'],
  './ai': ['classifyRoast'],
};

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

function run(command, args, options = {}) {
  const { cwd = repoRoot, env = {} } = options;
  const result = spawnSync(command, args, {
    cwd,
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

function readTarString(buffer, start, length) {
  return buffer
    .subarray(start, start + length)
    .toString('utf8')
    .replace(/\0.*$/, '')
    .trim();
}

function readTarOctal(buffer, start, length) {
  const value = readTarString(buffer, start, length);
  return value ? Number.parseInt(value, 8) : 0;
}

function isZeroBlock(block) {
  for (const byte of block) {
    if (byte !== 0) {
      return false;
    }
  }

  return true;
}

function parsePaxHeader(buffer) {
  const values = {};
  let offset = 0;

  while (offset < buffer.length) {
    const lengthEnd = buffer.indexOf(0x20, offset);
    if (lengthEnd === -1) {
      break;
    }

    const recordLength = Number.parseInt(buffer.subarray(offset, lengthEnd).toString('utf8'), 10);
    if (!Number.isFinite(recordLength) || recordLength <= 0) {
      break;
    }

    const record = buffer.subarray(offset + (lengthEnd - offset) + 1, offset + recordLength - 1);
    const separatorIndex = record.indexOf(0x3d);
    if (separatorIndex !== -1) {
      const key = record.subarray(0, separatorIndex).toString('utf8');
      const value = record.subarray(separatorIndex + 1).toString('utf8');
      values[key] = value;
    }

    offset += recordLength;
  }

  return values;
}

function isPathInsideRoot(rootPath, candidatePath) {
  const relativePath = relative(rootPath, candidatePath);
  return (
    relativePath === '' ||
    (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`))
  );
}

function findNearestExistingPath(path) {
  let currentPath = path;

  while (!existsSync(currentPath)) {
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }

    currentPath = parentPath;
  }

  return currentPath;
}

function resolveTarTargetPath(unpackRoot, relativePath, archivePath) {
  const targetPath = resolve(unpackRoot, relativePath);
  if (!isPathInsideRoot(unpackRoot, targetPath)) {
    fail(`Tar entry escapes the unpack root: ${relativePath} in ${archivePath}`);
  }

  const existingPath = findNearestExistingPath(targetPath);
  const resolvedExistingPath = realpathSync(existingPath);
  if (!isPathInsideRoot(unpackRoot, resolvedExistingPath)) {
    fail(`Tar entry resolves outside the unpack root: ${relativePath} in ${archivePath}`);
  }

  return targetPath;
}

function resolveTarSymlinkTargetPath(unpackRoot, symlinkPath, linkPath, archivePath) {
  if (isAbsolute(linkPath)) {
    fail(`Tar symlink target must be relative: ${linkPath} in ${archivePath}`);
  }

  const resolvedTargetPath = resolve(dirname(symlinkPath), linkPath);
  if (!isPathInsideRoot(unpackRoot, resolvedTargetPath)) {
    fail(`Tar symlink target escapes the unpack root: ${linkPath} in ${archivePath}`);
  }

  const existingPath = findNearestExistingPath(resolvedTargetPath);
  const resolvedExistingPath = realpathSync(existingPath);
  if (!isPathInsideRoot(unpackRoot, resolvedExistingPath)) {
    fail(`Tar symlink target resolves outside the unpack root: ${linkPath} in ${archivePath}`);
  }
}

export function extractTarGzArchive(archivePath, destinationDir) {
  mkdirSync(destinationDir, { recursive: true });
  const unpackRoot = realpathSync(destinationDir);
  const archive = gunzipSync(readFileSync(archivePath));
  let offset = 0;
  let pendingExtendedHeader = null;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    offset += 512;

    if (isZeroBlock(header)) {
      break;
    }

    const size = readTarOctal(header, 124, 12);
    const typeflag = readTarString(header, 156, 1) || '0';
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const rawPath = prefix ? `${prefix}/${name}` : name;
    const content = archive.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    if (typeflag === 'x' || typeflag === 'g') {
      pendingExtendedHeader = parsePaxHeader(content);
      continue;
    }

    const extendedHeader = pendingExtendedHeader;
    const relativePath = extendedHeader?.path ?? rawPath;
    const linkPath = extendedHeader?.linkpath ?? readTarString(header, 157, 100);
    pendingExtendedHeader = null;

    if (!relativePath) {
      continue;
    }

    const targetPath = resolveTarTargetPath(unpackRoot, relativePath, archivePath);

    if (typeflag === '5') {
      mkdirSync(targetPath, { recursive: true });
      continue;
    }

    if (typeflag === '2') {
      resolveTarSymlinkTargetPath(unpackRoot, targetPath, linkPath, archivePath);
      mkdirSync(dirname(targetPath), { recursive: true });
      rmSync(targetPath, { force: true });
      symlinkSync(linkPath, targetPath);
      continue;
    }

    if (typeflag !== '0') {
      fail(`Unsupported tar entry type ${typeflag} in ${archivePath}`);
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content);
  }
}

export function linkPackedNodeModules(packageDir, sourceNodeModulesPath, options = {}) {
  const { platform = process.platform, symlink = symlinkSync } = options;
  const linkPath = join(packageDir, 'node_modules');
  const linkType = platform === 'win32' ? 'junction' : 'dir';

  symlink(sourceNodeModulesPath, linkPath, linkType);

  return linkPath;
}

function createPackedArtifactFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), 'purvey-prepublish-pack-'));
  const packDir = join(tempDir, 'pack');
  const unpackDir = join(tempDir, 'unpack');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(unpackDir, { recursive: true });

  const packResult = run('npm', [
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    packDir,
  ]);
  if (packResult.status !== 0) {
    fail(`npm pack failed.\n\n${formatStdio(packResult)}`);
  }

  let tarballFilename;
  try {
    const [packMetadata] = JSON.parse(packResult.stdout);
    tarballFilename = packMetadata.filename;
  } catch (error) {
    fail(`npm pack did not emit valid JSON.\n\n${formatStdio(packResult)}\n\n${error}`);
  }

  const tarballPath = join(packDir, tarballFilename);
  extractTarGzArchive(tarballPath, unpackDir);

  const packageDir = join(unpackDir, 'package');
  const cliPath = join(packageDir, 'dist', 'index.js');
  assert(existsSync(cliPath), `Packed CLI entrypoint is missing: ${cliPath}`);
  linkPackedNodeModules(packageDir, resolve(repoRoot, 'node_modules'));

  return {
    tempDir,
    packageDir,
    cliPath,
  };
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

function runPackedCli(packFixture, args) {
  return run('node', [packFixture.cliPath, ...args], { cwd: packFixture.packageDir });
}

function runPackedManifestImport(packFixture) {
  return run(
    'node',
    [
      '--input-type=module',
      '-e',
      "import { getCliManifest } from '@purveyors/cli/manifest'; console.log(JSON.stringify(getCliManifest()));",
    ],
    {
      cwd: packFixture.packageDir,
    }
  );
}

function runPackedSelfImportExports(packFixture) {
  const specifiers = Object.entries(REQUIRED_SELF_IMPORT_MEMBERS).map(
    ([exportKey, requiredKeys]) => ({
      specifier: `@purveyors/cli${exportKey.slice(1)}`,
      requiredKeys,
    })
  );

  return run(
    'node',
    [
      '--input-type=module',
      '-e',
      `const specifiers = ${JSON.stringify(specifiers)};\nconst loaded = [];\nfor (const { specifier, requiredKeys } of specifiers) {\n  const moduleNamespace = await import(specifier);\n  loaded.push({ specifier, requiredKeys, keys: Object.keys(moduleNamespace).sort() });\n}\nconsole.log(JSON.stringify(loaded));`,
    ],
    {
      cwd: packFixture.packageDir,
      env: {
        PURVEYORS_SUPABASE_URL: 'https://placeholder.supabase.co',
        PURVEYORS_SUPABASE_ANON_KEY: 'placeholder-anon-key',
      },
    }
  );
}

export function verifyPrepublishParity() {
  const packageJson = readJson('package.json');
  const readmeText = readText('README.md');

  assertPackageReleaseSurface(packageJson);
  assertReadmeReleaseSurface(readmeText);

  const packFixture = createPackedArtifactFixture();

  try {
    const sourceHelpResult = runSourceCli(['--help']);
    const packedHelpResult = runPackedCli(packFixture, ['--help']);

    assertSuccessfulRun(sourceHelpResult, 'source help smoke check');
    assertSuccessfulRun(packedHelpResult, 'packed help smoke check');

    const sourceHelp = stripAnsi(sourceHelpResult.stdout);
    const packedHelp = stripAnsi(packedHelpResult.stdout);
    assertHelpSurface(sourceHelp, 'source help');
    assertHelpSurface(packedHelp, 'packed help');
    assertTextEqual(packedHelp, sourceHelp, 'Source and packed help output');

    const sourceManifest = parseJsonStdout(
      runSourceCli(['manifest']),
      'source manifest smoke check'
    );
    const sourceContext = parseJsonStdout(
      runSourceCli(['context', '--json']),
      'source context --json smoke check'
    );
    const packedManifest = parseJsonStdout(
      runPackedCli(packFixture, ['manifest']),
      'packed manifest smoke check'
    );
    const packedContext = parseJsonStdout(
      runPackedCli(packFixture, ['context', '--json']),
      'packed context --json smoke check'
    );
    const importedManifest = parseJsonStdout(
      runPackedManifestImport(packFixture),
      'packed self-import manifest smoke check'
    );
    const importedExports = parseJsonStdout(
      runPackedSelfImportExports(packFixture),
      'packed self-import subpath smoke check'
    );

    for (const [label, manifest] of [
      ['source manifest', sourceManifest],
      ['source context --json', sourceContext],
      ['packed manifest', packedManifest],
      ['packed context --json', packedContext],
      ['packed self-import manifest', importedManifest],
    ]) {
      assertManifestSurface(manifest, label);
    }

    assertDeepEqual(sourceContext, sourceManifest, 'Source manifest and source context --json');
    assertDeepEqual(packedManifest, sourceManifest, 'Packed manifest and source manifest');
    assertDeepEqual(
      packedContext,
      sourceContext,
      'Packed context --json and source context --json'
    );
    assertDeepEqual(
      importedManifest,
      sourceManifest,
      'Packed self-import manifest and source manifest'
    );

    assert(
      Array.isArray(importedExports) &&
        importedExports.length === Object.keys(REQUIRED_SELF_IMPORT_MEMBERS).length,
      'Packed self-import subpath smoke check must load every stable exported subpath'
    );

    for (const [exportKey, requiredKeys] of Object.entries(REQUIRED_SELF_IMPORT_MEMBERS)) {
      const specifier = `@purveyors/cli${exportKey.slice(1)}`;
      const loadedModule = importedExports.find((entry) => entry.specifier === specifier);
      assert(loadedModule, `Packed self-import subpath smoke check is missing ${specifier}`);

      for (const requiredKey of requiredKeys) {
        assert(
          loadedModule.keys.includes(requiredKey),
          `${specifier} is missing required export ${requiredKey}`
        );
      }
    }

    return {
      checked: [
        'package.json bin/files/exports surface',
        'npm pack dry-run publish surface',
        'README machine-readable contract snippets',
        'source vs packed help parity',
        'source manifest/context parity',
        'packed manifest/context parity',
        'packed self-import manifest parity',
        'packed self-import subpath member parity',
      ],
    };
  } finally {
    rmSync(packFixture.tempDir, { recursive: true, force: true });
  }
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
