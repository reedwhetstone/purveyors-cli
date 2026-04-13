import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_HELP_SNIPPETS,
  REQUIRED_PACKAGE_EXPORTS,
  REQUIRED_README_SNIPPETS,
  assertHelpSurface,
  assertPackageReleaseSurface,
  assertReadmeReleaseSurface,
  repoRoot,
  verifyPrepublishParity,
} from '../scripts/verify-prepublish-parity.mjs';

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

  it('passes the end-to-end prepublish smoke/parity checks', () => {
    expect(() => verifyPrepublishParity()).not.toThrow();
  }, 30000);
});
