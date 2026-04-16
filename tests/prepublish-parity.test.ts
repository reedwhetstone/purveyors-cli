import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_HELP_SNIPPETS,
  REQUIRED_PACKAGE_EXPORTS,
  REQUIRED_README_SNIPPETS,
  assertHelpSurface,
  assertPackageReleaseSurface,
  assertReadmeReleaseSurface,
  repoRoot,
  stripAnsi,
  verifyPrepublishParity,
} from '../scripts/verify-prepublish-parity.mjs';

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

function runFixtureGuardrail(tempRepo: string) {
  return spawnSync(
    'bash',
    ['-lc', 'pnpm clean:dist && pnpm build && node scripts/verify-prepublish-parity.mjs'],
    {
      cwd: tempRepo,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        PURVEYORS_SUPABASE_URL: 'https://placeholder.supabase.co',
        PURVEYORS_SUPABASE_ANON_KEY: 'placeholder-anon-key',
      },
    }
  );
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
