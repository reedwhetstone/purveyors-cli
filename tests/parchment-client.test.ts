import { afterEach, describe, expect, it, vi } from 'vitest';

const { sdkCreateClient } = vi.hoisted(() => ({
  sdkCreateClient: vi.fn((options: unknown) => ({ options })),
}));

vi.mock('@purveyors/sdk', () => ({
  createParchmentClient: sdkCreateClient,
}));

import { createParchmentClient } from '../src/lib/parchment.js';

describe('createParchmentClient', () => {
  afterEach(() => {
    sdkCreateClient.mockClear();
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
});
