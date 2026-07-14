import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  linkPackedNodeModules,
  repoRoot,
  verifyPrepublishParity,
} from '../scripts/verify-prepublish-parity.mjs';

function writeTarString(buffer: Buffer, start: number, length: number, value: string) {
  buffer.write(value.slice(0, length), start, length, 'utf8');
}

function writeTarOctal(buffer: Buffer, start: number, length: number, value: number) {
  const encoded = value.toString(8).padStart(length - 1, '0');
  buffer.write(`${encoded}\0`, start, length, 'ascii');
}

function createTarHeader(name: string, size: number, typeflag: '0' | '2' | '5', linkPath = '') {
  const header = Buffer.alloc(512, 0);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, typeflag === '5' ? 0o755 : 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  writeTarString(header, 156, 1, typeflag);
  if (typeflag === '2') {
    writeTarString(header, 157, 100, linkPath);
  }
  writeTarString(header, 257, 6, 'ustar');
  writeTarString(header, 263, 2, '00');

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  writeTarOctal(header, 148, 8, checksum);

  return header;
}

function createTarGzFixture(
  entries: Array<{ path: string; type: '0' | '2' | '5'; content?: string; linkPath?: string }>
) {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? '', 'utf8');
    blocks.push(
      createTarHeader(
        entry.path,
        entry.type === '0' ? content.length : 0,
        entry.type,
        entry.linkPath ?? ''
      )
    );

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

function getFixtureGuardrailSteps(tempRepo: string) {
  const sharedOptions = {
    cwd: tempRepo,
    encoding: 'utf8' as const,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env,
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
        './market': './dist/lib/market.js',
        './ai': './dist/lib/ai.js',
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

  it('rejects tar entries that traverse outside the unpack root', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'purvey-tar-traversal-fixture-'));
    const archivePath = join(fixtureDir, 'fixture.tgz');
    const unpackDir = join(fixtureDir, 'unpack');
    const escapedPath = join(fixtureDir, 'escaped.txt');

    try {
      writeFileSync(
        archivePath,
        createTarGzFixture([{ path: '../escaped.txt', type: '0', content: 'owned\n' }])
      );

      expect(() => extractTarGzArchive(archivePath, unpackDir)).toThrow(/escapes the unpack root/);
      expect(existsSync(escapedPath)).toBe(false);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('rejects tar entries that resolve through symlinks outside the unpack root', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'purvey-tar-symlink-fixture-'));
    const archivePath = join(fixtureDir, 'fixture.tgz');
    const unpackDir = join(fixtureDir, 'unpack');
    const escapedPath = join(fixtureDir, 'escaped.txt');

    try {
      writeFileSync(
        archivePath,
        createTarGzFixture([
          { path: 'package/', type: '5' },
          { path: 'package/out', type: '2', linkPath: '../..' },
          { path: 'package/out/escaped.txt', type: '0', content: 'owned\n' },
        ])
      );

      expect(() => extractTarGzArchive(archivePath, unpackDir)).toThrow(/escapes the unpack root/);
      expect(existsSync(escapedPath)).toBe(false);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it.each([
    { label: 'relative escape', linkPath: '../../outside-root', error: /escapes the unpack root/ },
    { label: 'absolute target', linkPath: '/tmp/outside-root', error: /must be relative/ },
  ])(
    'rejects tar symlink targets that escape the unpack root via $label',
    ({ linkPath, error }) => {
      const fixtureDir = mkdtempSync(join(tmpdir(), 'purvey-tar-fixture-'));
      const archivePath = join(fixtureDir, 'fixture.tgz');
      const unpackDir = join(fixtureDir, 'unpack');

      try {
        writeFileSync(
          archivePath,
          createTarGzFixture([
            { path: 'package/', type: '5' },
            { path: 'package/dist', type: '2', linkPath },
          ])
        );

        expect(() => extractTarGzArchive(archivePath, unpackDir)).toThrow(error);
      } finally {
        rmSync(fixtureDir, { recursive: true, force: true });
      }
    }
  );

  it('uses a Windows-safe junction for packed node_modules fixtures', () => {
    const packageDir = 'C:\\temp\\package';
    const sourceNodeModulesPath = 'C:\\repo\\node_modules';
    const calls: Array<{ target: string; linkPath: string; type: string | undefined }> = [];

    const linkPath = linkPackedNodeModules(packageDir, sourceNodeModulesPath, {
      platform: 'win32',
      symlink(target: string, path: string, type?: string) {
        calls.push({
          target,
          linkPath: path,
          type,
        });
      },
    });

    expect(linkPath).toBe(join(packageDir, 'node_modules'));
    expect(calls).toEqual([
      {
        target: sourceNodeModulesPath,
        linkPath: join(packageDir, 'node_modules'),
        type: 'junction',
      },
    ]);
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

  it('passes the end-to-end prepublish smoke/parity checks', () => {
    expect(() => verifyPrepublishParity()).not.toThrow();
  }, 30000);
});
