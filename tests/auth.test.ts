import { describe, expect, it } from 'vitest';
import { AuthError } from '../src/lib/errors.js';
import { extractCallbackResult } from '../src/commands/auth.js';

describe('extractCallbackResult', () => {
  it('extracts tokens from a full callback URL with a hash fragment', () => {
    expect(
      extractCallbackResult(
        'http://localhost:3000/auth/callback#access_token=access-hash&refresh_token=refresh-hash&expires_in=7200'
      )
    ).toEqual({
      accessToken: 'access-hash',
      refreshToken: 'refresh-hash',
      expiresIn: 7200,
    });
  });

  it('extracts tokens from a full callback URL with query params', () => {
    expect(
      extractCallbackResult(
        'http://localhost:3000/auth/callback?access_token=access-query&refresh_token=refresh-query&expires_in=1800'
      )
    ).toEqual({
      accessToken: 'access-query',
      refreshToken: 'refresh-query',
      expiresIn: 1800,
    });
  });

  it('extracts tokens from a pasted fragment string', () => {
    expect(
      extractCallbackResult('access_token=access-only&refresh_token=refresh-only&expires_in=900')
    ).toEqual({
      accessToken: 'access-only',
      refreshToken: 'refresh-only',
      expiresIn: 900,
    });
  });

  it('defaults expiresIn when omitted', () => {
    expect(
      extractCallbackResult('access_token=access-default&refresh_token=refresh-default')
    ).toEqual({
      accessToken: 'access-default',
      refreshToken: 'refresh-default',
      expiresIn: 3600,
    });
  });

  it('throws a helpful error when tokens are missing', () => {
    expect(() => extractCallbackResult('http://localhost:3000/auth/callback?code=abc123')).toThrow(
      AuthError
    );
    expect(() => extractCallbackResult('http://localhost:3000/auth/callback?code=abc123')).toThrow(
      /Could not extract tokens from the callback URL/
    );
  });
});
