import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  REQUIRED_HELP_SNIPPETS,
  REQUIRED_PACKAGE_EXPORTS,
  REQUIRED_README_SNIPPETS,
  assertHelpSurface,
  assertPackageReleaseSurface,
  assertReadmeReleaseSurface,
  extractTarGzArchive,
  repoRoot,
  stripAnsi,
  verifyPrepublishParity,
} from '../scripts/verify-prepublish-parity.mjs';

function writeTarString(buffer: Buffer, start: number, length: number, value: string) {
  buffer.write(value.slice(0, length), start, length, 'utf8');
}

function writeTarOctal(buffer: Buffer, start: number, length: number, value: number) {
  const encoded = value.toString(8).padStart(length - 1, '0');
  buffer.write(`${encoded}\0`, start, length, 'ascii');
}

function createTarHeader(name: string, size: number, typeflag: '0' | '5') {
  const header = Buffer.alloc(512, 0);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, typeflag === '5' ? 0o755 : 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  writeTarString(header, 156, 1, typeflag);
  writeTarString(header, 257, 6, 'ustar');
  writeTarString(header, 263, 2, '00');

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  writeTarOctal(header, 148, 8, checksum);

  return header;
}

function createTarGzFixture(entries: Array<{ path: string; type: '0' | '5'; content?: string }>) {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? '', 'utf8');
    blocks.push(createTarHeader(entry.path, entry.type === '5' ? 0 : content.length, entry.type));

    if (entry.type === '0') {
      blocks.push(content);
      const padding = (512 - (content.length % 512)) % 512;
      if (padding) {
        blocks.push(Buffer.alloc(padding, 0));
      }
    }
  }

  blocks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks));
}

function createTempRepoFixture() {
  const tempRepo = mkdtempSync(join(tmpdir(), 'purvey-prepublish-fixture-'));

  cpSync(repoRoot, tempRepo, {
    recursive: true,
    filter: (source) => {
      const relativePath = source.slice(repoRoot.length + 1);

      if (!relativePath) {
        return true;
      }

      return !['.git', 'node_modules', '.verify-pr', 'notes/pr-audits'].some(
        (blockedPath) => relativePath === blockedPath || relativePath.startsWith(`${blockedPath}/`)
      );
    },
  });

  symlinkSync(resolve(repoRoot, 'node_modules'), join(tempRepo, 'node_modules'), 'dir');

  return {
    tempRepo,
    cleanup() {
      rmSync(tempRepo, { recursive: true, force: true });
    },
  };
}

function getFixtureGuardrailSteps(tempRepo: string) {
  const sharedOptions = {
    cwd: tempRepo,
    encoding: 'utf8' as const,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      PURVEYORS_SUPABASE_URL: 'https://placeholder.supabase.co',
      PURVEYORS_SUPABASE_ANON_KEY: 'placeholder-anon-key',
    },
  };

  return [
    { command: 'pnpm', args: ['clean:dist'], options: sharedOptions },
    { command: 'pnpm', args: ['build'], options: sharedOptions },
    {
      command: process.execPath,
      args: ['scripts/verify-prepublish-parity.mjs'],
      options: sharedOptions,
    },
  ];
}

function runFixtureGuardrail(tempRepo: string) {
  let stdout = '';
  let stderr = '';

  for (const step of getFixtureGuardrailSteps(tempRepo)) {
    const result = spawnSync(step.command, step.args, step.options);
    stdout += result.stdout;
    stderr += result.stderr;

    if (result.error || result.status !== 0 || result.signal) {
      return {
        ...result,
        stdout,
        stderr,
      };
    }
  }

  return {
    status: 0,
    signal: null,
    stdout,
    stderr,
  };
}

describe('prepublish parity guardrail', () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
    exports?: Record<string, string>;
  };

  it('covers the expected package, README, and help surfaces', () => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
    const sampleHelp = REQUIRED_HELP_SNIPPETS.join('\n');

    expect(REQUIRED_README_SNIPPETS).toEqual(
      expect.arrayContaining([
        'purvey manifest',
        'purvey context --json',
        '@purveyors/cli/manifest',
      ])
    );
    expect(REQUIRED_PACKAGE_EXPORTS).toEqual(
      expect.objectContaining({
        '.': './dist/index.js',
        './catalog': './dist/lib/catalog.js',
        './manifest': './dist/lib/manifest.js',
        './artisan': './dist/lib/artisan/index.js',
      })
    );
    expect(() => assertPackageReleaseSurface(packageJson)).not.toThrow();
    expect(() => assertReadmeReleaseSurface(readme)).not.toThrow();
    expect(() => assertHelpSurface(sampleHelp, 'sample help')).not.toThrow();
  });

  it('runs the fixture guardrail with direct executables instead of bash', () => {
    const commands = getFixtureGuardrailSteps(repoRoot).map((step) => step.command);

    expect(commands).toEqual(['pnpm', 'pnpm', process.execPath]);
    expect(commands).not.toContain('bash');
  });

  it('extracts packed artifacts without relying on system tar', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'purvey-tar-fixture-'));
    const archivePath = join(fixtureDir, 'fixture.tgz');
    const unpackDir = join(fixtureDir, 'unpack');

    try {
      writeFileSync(
        archivePath,
        createTarGzFixture([
          { path: 'package/', type: '5' },
          { path: 'package/dist/', type: '5' },
          { path: 'package/dist/index.js', type: '0', content: "console.log('fixture');\n" },
        ])
      );

      extractTarGzArchive(archivePath, unpackDir);

      expect(readFileSync(join(unpackDir, 'package', 'dist', 'index.js'), 'utf8')).toBe(
        "console.log('fixture');\n"
      );
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('fails when a supported package export is removed or retargeted', () => {
    const missingCatalogExport = JSON.parse(JSON.stringify(packageJson)) as {
      exports: Record<string, string>;
    };
    delete missingCatalogExport.exports['./catalog'];

    const wrongAiExportPath = JSON.parse(JSON.stringify(packageJson)) as {
      exports: Record<string, string>;
    };
    wrongAiExportPath.exports['./ai'] = './dist/lib/not-ai.js';

    const collectErrorMessage = (callback: () => void) => {
      try {
        callback();
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };

    const missingCatalogError = collectErrorMessage(() =>
      assertPackageReleaseSurface(missingCatalogExport)
    );
    const wrongAiError = collectErrorMessage(() => assertPackageReleaseSurface(wrongAiExportPath));

    expect(missingCatalogError).toContain('package.json exports contract drifted.');
    expect(missingCatalogError).toContain('"./catalog": "./dist/lib/catalog.js"');
    expect(wrongAiError).toContain('package.json exports contract drifted.');
    expect(wrongAiError).toContain('"./ai": "./dist/lib/not-ai.js"');
    expect(wrongAiError).toContain('"./ai": "./dist/lib/ai.js"');
  });

  it('fails when a clean rebuild no longer emits a required published subpath artifact', () => {
    const fixture = createTempRepoFixture();

    try {
      rmSync(join(fixture.tempRepo, 'src', 'lib', 'artisan', 'index.ts'));

      const result = runFixtureGuardrail(fixture.tempRepo);
      const output = stripAnsi(`${result.stdout}\n${result.stderr}`);

      expect(result.status).toBe(1);
      expect(output).toContain('package export ./artisan is missing from the release surface');
    } finally {
      fixture.cleanup();
    }
  }, 30000);

  it('fails when a stable published subpath loses a required named export', () => {
    const fixture = createTempRepoFixture();

    try {
      const artisanIndexPath = join(fixture.tempRepo, 'src', 'lib', 'artisan', 'index.ts');
      const original = readFileSync(artisanIndexPath, 'utf8');
      writeFileSync(
        artisanIndexPath,
        original.replace(
          "export { parseAlogFile } from './parser.js'; // renamed from processAlogFile\n",
          ''
        ),
        'utf8'
      );

      const result = runFixtureGuardrail(fixture.tempRepo);
      const output = stripAnsi(`${result.stdout}\n${result.stderr}`);

      expect(result.status).toBe(1);
      expect(output).toContain('@purveyors/cli/artisan is missing required export parseAlogFile');
    } finally {
      fixture.cleanup();
    }
  }, 30000);

  it('passes the end-to-end prepublish smoke/parity checks', () => {
    expect(() => verifyPrepublishParity()).not.toThrow();
  }, 30000);
});
