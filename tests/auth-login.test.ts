import { describe, expect, it } from 'vitest';
import { parseOAuthCallbackUrl } from '../src/commands/auth.js';

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
