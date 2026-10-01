import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '../src/lib/errors.js';

const { sdkCreateClient, requireAuthMock } = vi.hoisted(() => ({
  sdkCreateClient: vi.fn((options: unknown) => ({ options })),
  requireAuthMock: vi.fn(),
}));

vi.mock('@purveyors/sdk', () => ({
  createParchmentClient: sdkCreateClient,
}));

vi.mock('../src/lib/auth-guard.js', () => ({
  requireAuth: requireAuthMock,
}));

import {
  createParchmentClient,
  getParchmentIdentity,
  resolveParchmentSessionTokenIfAvailable,
} from '../src/lib/parchment.js';

describe('createParchmentClient', () => {
  afterEach(() => {
    sdkCreateClient.mockClear();
    requireAuthMock.mockReset();
    delete process.env.PARCHMENT_API_KEY;
    delete process.env.PURVEYORS_API_KEY;
    delete process.env.PARCHMENT_API_BASE_URL;
    delete process.env.PURVEYORS_BASE_URL;
  });

  it('uses an explicit token override before exported API keys', async () => {
    process.env.PARCHMENT_API_KEY = 'api-key-for-another-account';

    await createParchmentClient('member', 'session-token');

    expect(sdkCreateClient).toHaveBeenCalledWith({
      baseUrl: 'https://api.purveyors.io',
      token: 'session-token',
    });
  });

  it('returns a valid member session token when one is available', async () => {
    requireAuthMock.mockResolvedValue({
      credentialContext: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { apiKey: 'session-token' } },
        }),
      },
    });

    await expect(resolveParchmentSessionTokenIfAvailable('member')).resolves.toBe('session-token');
    expect(requireAuthMock).toHaveBeenCalledWith('member');
  });

  it('returns undefined when no usable session exists so API-key-only flows can continue', async () => {
    requireAuthMock.mockRejectedValue(new AuthError('Not logged in.'));

    await expect(resolveParchmentSessionTokenIfAvailable('member')).resolves.toBeUndefined();
  });
});

describe('getParchmentIdentity', () => {
  afterEach(() => {
    sdkCreateClient.mockReset();
    sdkCreateClient.mockImplementation((options: unknown) => ({ options }));
    delete process.env.PARCHMENT_API_KEY;
  });

  it('returns the canonical /v1/me principal for the active credential unchanged', async () => {
    process.env.PARCHMENT_API_KEY = 'env-key';
    const principal = {
      authenticated: true,
      primaryAppRole: 'member',
      capabilities: { profileStudio: { available: true, reason: 'available' } },
    };
    const me = vi.fn().mockResolvedValue({
      data: principal,
      response: new Response(null, { status: 200 }),
    });
    sdkCreateClient.mockImplementation(((options: unknown) => ({ options, me })) as never);

    await expect(getParchmentIdentity()).resolves.toEqual(principal);
    expect(sdkCreateClient).toHaveBeenCalledWith({
      baseUrl: 'https://api.purveyors.io',
      token: 'env-key',
    });
    expect(requireAuthMock).not.toHaveBeenCalled();
  });
});
