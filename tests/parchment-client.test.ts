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
      supabase: {
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: { session: { access_token: 'session-token' } },
          }),
        },
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
