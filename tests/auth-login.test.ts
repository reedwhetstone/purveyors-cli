import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createManualCallbackReaderForQuestion,
  parseOAuthCallbackUrl,
} from '../src/commands/auth.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseOAuthCallbackUrl', () => {
  it('extracts tokens from a full callback URL fragment', () => {
    expect(
      parseOAuthCallbackUrl(
        'http://localhost:49200/auth/callback#access_token=access&refresh_token=refresh&expires_in=7200'
      )
    ).toEqual({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 7200 });
  });

  it('extracts tokens from a full callback URL query string', () => {
    expect(
      parseOAuthCallbackUrl(
        'https://purveyors.io/auth/cli-callback?access_token=access&refresh_token=refresh&expires_in=3600'
      )
    ).toEqual({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600 });
  });

  it('extracts tokens from a pasted bare fragment', () => {
    expect(parseOAuthCallbackUrl('access_token=access&refresh_token=refresh')).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 3600,
    });
  });

  it('rejects callback URLs without both tokens', () => {
    expect(() => parseOAuthCallbackUrl('access_token=access')).toThrow(/Could not extract tokens/);
  });
});

describe('createManualCallbackReaderForQuestion', () => {
  it('keeps waiting and prompts again after invalid manual callback input', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const answers = [
      '',
      'not a callback url',
      'access_token=manual-access&refresh_token=manual-refresh&expires_in=120',
    ];
    const prompts: string[] = [];
    let closeCount = 0;

    const reader = createManualCallbackReaderForQuestion(
      (prompt, callback) => {
        prompts.push(prompt);
        const answer = answers.shift();
        if (answer === undefined) {
          throw new Error('Manual callback reader prompted too many times');
        }
        queueMicrotask(() => callback(answer));
      },
      () => {
        closeCount += 1;
      },
      true
    );

    await expect(reader?.promise).resolves.toEqual({
      accessToken: 'manual-access',
      refreshToken: 'manual-refresh',
      expiresIn: 120,
    });
    expect(prompts).toHaveLength(3);
    expect(closeCount).toBe(1);
  });

  it('does not create a manual reader when input cannot be read', () => {
    const reader = createManualCallbackReaderForQuestion(
      () => {
        throw new Error('question should not be called');
      },
      () => {
        throw new Error('close should not be called');
      },
      false
    );

    expect(reader).toBeNull();
  });
});
