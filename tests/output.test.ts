import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the internal helpers by importing from output.ts
// (outputData writes to stdout/stderr; we spy on console methods)

describe('output utilities', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('shouldUseInteractiveOutput', () => {
    it('allows interactive output for a TTY with no explicit mode', async () => {
      const { shouldUseInteractiveOutput } = await import('../src/lib/output.js');
      expect(shouldUseInteractiveOutput({}, true)).toBe(true);
    });

    it('disables interactive output when --json is requested', async () => {
      const { shouldUseInteractiveOutput } = await import('../src/lib/output.js');
      expect(shouldUseInteractiveOutput({ json: true }, true)).toBe(false);
    });

    it('disables interactive output when --pretty is requested', async () => {
      const { shouldUseInteractiveOutput } = await import('../src/lib/output.js');
      expect(shouldUseInteractiveOutput({ pretty: true }, true)).toBe(false);
    });

    it('disables interactive output when --csv is requested', async () => {
      const { shouldUseInteractiveOutput } = await import('../src/lib/output.js');
      expect(shouldUseInteractiveOutput({ csv: true }, true)).toBe(false);
    });

    it('disables interactive output when stdout is not a TTY', async () => {
      const { shouldUseInteractiveOutput } = await import('../src/lib/output.js');
      expect(shouldUseInteractiveOutput({}, false)).toBe(false);
    });
  });

  describe('outputOptionsFromArgv', () => {
    it('detects explicit output flags from argv', async () => {
      const { outputOptionsFromArgv } = await import('../src/lib/output.js');
      expect(outputOptionsFromArgv(['node', 'src/index.ts', '--pretty', '--csv'])).toEqual({
        json: false,
        pretty: true,
        csv: true,
      });
    });
  });

  describe('formatStructuredOutput', () => {
    it('returns compact JSON by default', async () => {
      const { formatStructuredOutput } = await import('../src/lib/output.js');
      expect(formatStructuredOutput({ coffee: 'espresso' })).toBe('{"coffee":"espresso"}');
    });

    it('returns indented JSON in pretty mode', async () => {
      const { formatStructuredOutput } = await import('../src/lib/output.js');
      const output = formatStructuredOutput({ coffee: 'espresso' }, { pretty: true });
      expect(output).toContain('\n');
      expect(output).toContain('coffee');
      expect(output).toContain('espresso');
    });
  });

  describe('outputData — default (compact JSON)', () => {
    it('prints compact JSON with no options', async () => {
      const { outputData } = await import('../src/lib/output.js');
      const data = { name: 'espresso', roast: 'dark' };
      outputData(data);
      expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(data));
    });

    it('prints compact JSON for arrays', async () => {
      const { outputData } = await import('../src/lib/output.js');
      const data = [{ id: 1 }, { id: 2 }];
      outputData(data);
      expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(data));
    });

    it('outputs null as compact JSON', async () => {
      const { outputData } = await import('../src/lib/output.js');
      outputData(null);
      expect(stdoutSpy).toHaveBeenCalledWith('null');
    });
  });

  describe('outputData — CSV mode', () => {
    it('produces CSV headers + rows from array of objects', async () => {
      const { outputData } = await import('../src/lib/output.js');
      const data = [
        { name: 'Ethiopia Yirgacheffe', price: 18.5 },
        { name: 'Colombia Huila', price: 16.0 },
      ];
      outputData(data, { csv: true });
      const output = stdoutSpy.mock.calls[0][0] as string;
      expect(output).toContain('name,price');
      expect(output).toContain('Ethiopia Yirgacheffe');
      expect(output).toContain('Colombia Huila');
    });

    it('wraps a non-array value in an array for CSV', async () => {
      const { outputData } = await import('../src/lib/output.js');
      const data = { name: 'single', roast: 'light' };
      outputData(data, { csv: true });
      const output = stdoutSpy.mock.calls[0][0] as string;
      expect(output).toContain('name');
      expect(output).toContain('single');
    });

    it('escapes commas in CSV values', async () => {
      const { outputData } = await import('../src/lib/output.js');
      const data = [{ name: 'Ethiopia, Yirgacheffe', price: 18 }];
      outputData(data, { csv: true });
      const output = stdoutSpy.mock.calls[0][0] as string;
      expect(output).toContain('"Ethiopia, Yirgacheffe"');
    });

    it('flattens nested objects for CSV', async () => {
      const { outputData } = await import('../src/lib/output.js');
      const data = [{ coffee: { name: 'Gesha', origin: 'Panama' }, price: 30 }];
      outputData(data, { csv: true });
      const output = stdoutSpy.mock.calls[0][0] as string;
      expect(output).toContain('coffee.name');
      expect(output).toContain('coffee.origin');
    });

    it('returns empty string for empty array', async () => {
      const { outputData } = await import('../src/lib/output.js');
      outputData([], { csv: true });
      expect(stdoutSpy).toHaveBeenCalledWith('');
    });
  });

  describe('outputData — pretty mode', () => {
    it('produces indented JSON in pretty mode', async () => {
      const { outputData } = await import('../src/lib/output.js');
      const data = { coffee: 'espresso' };
      outputData(data, { pretty: true });
      const output = stdoutSpy.mock.calls[0][0] as string;
      expect(output).toContain('\n');
      expect(output).toContain('  ');
      expect(output).toContain('coffee');
      expect(output).toContain('espresso');
    });
  });

  describe('success / info / warn helpers', () => {
    it('success writes to stderr with checkmark', async () => {
      const { success } = await import('../src/lib/output.js');
      success('It worked');
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('✔');
      expect(output).toContain('It worked');
    });

    it('info writes to stderr', async () => {
      const { info } = await import('../src/lib/output.js');
      info('Some info');
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('ℹ');
      expect(output).toContain('Some info');
    });

    it('warn writes to stderr', async () => {
      const { warn } = await import('../src/lib/output.js');
      warn('Watch out');
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('⚠');
      expect(output).toContain('Watch out');
    });
  });
});
