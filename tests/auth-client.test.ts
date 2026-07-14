import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '../src/lib/errors.js';

const { createParchmentClientMock, readCredentialsMock } = vi.hoisted(() => ({
  createParchmentClientMock: vi.fn(),
  readCredentialsMock: vi.fn(),
}));

vi.mock('@purveyors/sdk', () => ({
  createParchmentClient: createParchmentClientMock,
}));

vi.mock('../src/lib/config.js', () => ({
  readCredentials: readCredentialsMock,
}));

import { createCredentialContext } from '../src/lib/auth-client.js';

const credentials = {
  apiKey: 'pk_live_stored',
  keyId: 'key-1',
  createdAt: '2026-07-12T20:00:00.000Z',
  user: { id: 'stored-user', email: 'user@example.com', role: 'viewer' },
};

describe('createCredentialContext', () => {
  afterEach(() => {
    createParchmentClientMock.mockReset();
    readCredentialsMock.mockReset();
  });

  it('validates the stored API key before exposing it as an authenticated session', async () => {
    readCredentialsMock.mockResolvedValue(credentials);
    createParchmentClientMock.mockReturnValue({
      me: vi.fn().mockResolvedValue({
        data: {
          authenticated: true,
          userId: 'live-user',
          appRoles: ['member'],
          primaryAppRole: 'member',
        },
        response: new Response(null, { status: 200 }),
      }),
    });

    const client = await createCredentialContext();

    await expect(client.getSession()).resolves.toEqual({
      data: {
        session: {
          apiKey: 'pk_live_stored',
          user: { id: 'live-user', email: 'user@example.com', role: 'member' },
        },
      },
    });
  });

  it('rejects a revoked stored key instead of exposing it to optional auth flows', async () => {
    readCredentialsMock.mockResolvedValue(credentials);
    createParchmentClientMock.mockReturnValue({
      me: vi.fn().mockResolvedValue({
        data: { authenticated: false },
        error: { message: 'Invalid API key' },
        response: new Response(null, { status: 401 }),
      }),
    });

    await expect(createCredentialContext()).rejects.toBeInstanceOf(AuthError);
  });
});
