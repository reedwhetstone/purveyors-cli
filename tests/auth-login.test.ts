import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostname } from 'os';
import {
  createOAuthUrl,
  createManualCallbackReaderForQuestion,
  exchangeOAuthSessionForApiKey,
  parseOAuthCallbackUrl,
} from '../src/commands/auth.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('API-key bootstrap', () => {
  it('builds a Google OAuth URL without the Supabase runtime client', () => {
    const url = new URL(createOAuthUrl('http://localhost:4321/auth/callback'));
    expect(url.pathname).toBe('/auth/v1/authorize');
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('redirect_to')).toBe('http://localhost:4321/auth/callback');
  });

  it('replaces the machine key and stores only the scoped API-key credential', async () => {
    const ok = <T>(data: T, status = 200) => ({
      data,
      response: new Response(null, { status }),
    });
    const revoke = vi.fn().mockResolvedValue(ok({ key: { id: 'old-key' } }));
    const create = vi.fn().mockResolvedValue(
      ok(
        {
          apiKey: 'pk_live_new-secret',
          key: {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'purvey-cli-host',
            createdAt: '2026-07-12T20:00:00.000Z',
          },
        },
        201
      )
    );
    const client = {
      me: vi.fn().mockResolvedValue(
        ok({
          authenticated: true,
          userId: 'user-1',
          appRoles: ['member'],
          primaryAppRole: 'member',
        })
      ),
      apiKeys: {
        list: vi.fn().mockResolvedValue(
          ok({
            data: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                name: `purvey-cli-${hostname()}`,
                isActive: true,
              },
            ],
          })
        ),
        revoke,
        create,
      },
    } as never;
    const payload = Buffer.from(
      JSON.stringify({ sub: 'user-1', email: 'user@example.com', role: 'authenticated' })
    ).toString('base64url');

    const credentials = await exchangeOAuthSessionForApiKey(`header.${payload}.sig`, client);

    expect(revoke).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(create).toHaveBeenCalledWith({
      name: `purvey-cli-${hostname()}`,
      scopes: [
        'catalog:read',
        'inventory:read',
        'inventory:write',
        'roast:read',
        'roast:write',
        'sales:read',
        'sales:write',
        'tasting:read',
        'tasting:write',
      ],
    });
    expect(credentials).toEqual({
      apiKey: 'pk_live_new-secret',
      keyId: '22222222-2222-4222-8222-222222222222',
      createdAt: '2026-07-12T20:00:00.000Z',
      user: { id: 'user-1', email: 'user@example.com', role: 'member' },
    });
    expect(credentials).not.toHaveProperty('accessToken');
    expect(credentials).not.toHaveProperty('refreshToken');
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(revoke.mock.invocationCallOrder[0]);
  });
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

  it('rejects a callback from a different login attempt', () => {
    expect(() =>
      parseOAuthCallbackUrl(
        'http://localhost/auth/callback?state=wrong#access_token=access&refresh_token=refresh',
        'expected'
      )
    ).toThrow(/state did not match/);
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
