import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPkcePair, normalizeMachineName, performDeviceLogin } from '../src/commands/auth.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function response<T>(data: T, status = 200) {
  return { data, response: new Response(null, { status }) };
}

function errorResponse(code: string, message: string, status: number) {
  return {
    error: { error: { code, message } },
    response: new Response(null, { status }),
  };
}

function createClient(
  exchangeResults: unknown[],
  expiresAt = new Date(Date.now() + 60_000).toISOString()
) {
  return {
    cliAuth: {
      create: vi.fn().mockResolvedValue(
        response(
          {
            requestToken: 'signed-request-token',
            requestId: 'request-1',
            verificationUri: 'https://purveyors.io/auth/cli?request=signed-request-token',
            expiresAt,
            intervalSeconds: 3,
          },
          201
        )
      ),
      exchange: vi.fn().mockImplementation(() => Promise.resolve(exchangeResults.shift())),
    },
  };
}

describe('Parchment device authorization', () => {
  it('generates an RFC 7636 verifier and matching S256 challenge', () => {
    const first = createPkcePair();
    const second = createPkcePair();

    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.verifier).not.toBe(first.verifier);
  });

  it('normalizes machine names to the API contract', () => {
    expect(normalizeMachineName(' host/@name! ')).toBe('host-name');
    expect(normalizeMachineName('a'.repeat(100))).toHaveLength(64);
    expect(normalizeMachineName('///')).toBe('unknown-machine');
  });

  it('polls at the server interval and stores only API-key metadata', async () => {
    const client = createClient([
      errorResponse('authorization_pending', 'Authorization pending', 409),
      response(
        {
          apiKey: 'pk_live_new-secret',
          key: {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'purvey-cli-host',
            createdAt: '2026-07-14T02:00:00.000Z',
            lastUsedAt: null,
            isActive: true,
            scopes: ['catalog:read'],
          },
          user: { id: 'user-1', email: 'user@example.com', role: 'member' },
        },
        201
      ),
    ]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const openBrowser = vi.fn().mockResolvedValue(true);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const credentials = await performDeviceLogin({
      headless: false,
      client: client as never,
      machineName: 'host',
      openBrowser,
      sleep,
    });

    expect(client.cliAuth.create).toHaveBeenCalledWith({
      machineName: 'host',
      codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(openBrowser).toHaveBeenCalledWith(
      'https://purveyors.io/auth/cli?request=signed-request-token'
    );
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 3000, undefined);
    expect(client.cliAuth.exchange).toHaveBeenCalledTimes(2);
    expect(client.cliAuth.exchange).toHaveBeenCalledWith({
      requestToken: 'signed-request-token',
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(credentials).toEqual({
      apiKey: 'pk_live_new-secret',
      keyId: '22222222-2222-4222-8222-222222222222',
      createdAt: '2026-07-14T02:00:00.000Z',
      user: { id: 'user-1', email: 'user@example.com', role: 'member' },
    });
    expect(credentials).not.toHaveProperty('requestToken');
    expect(credentials).not.toHaveProperty('codeVerifier');
  });

  it('prints the approval URL in headless mode without opening a browser', async () => {
    const client = createClient([
      response(
        {
          apiKey: 'pk_live_secret',
          key: { id: 'key-1', createdAt: null },
          user: { id: 'user-1', email: 'user@example.com', role: 'viewer' },
        },
        201
      ),
    ]);
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)));
    const openBrowser = vi.fn();

    await performDeviceLogin({
      headless: true,
      client: client as never,
      openBrowser,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    expect(openBrowser).not.toHaveBeenCalled();
    expect(output.join('\n')).toContain('https://purveyors.io/auth/cli');
  });

  it('prints the URL and continues polling when browser launch fails', async () => {
    const client = createClient([
      response(
        {
          apiKey: 'pk_live_secret',
          key: { id: 'key-1', createdAt: null },
          user: { id: 'user-1', email: 'user@example.com', role: 'viewer' },
        },
        201
      ),
    ]);
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      performDeviceLogin({
        headless: false,
        client: client as never,
        openBrowser: vi.fn().mockResolvedValue(false),
        sleep: vi.fn().mockResolvedValue(undefined),
      })
    ).resolves.toMatchObject({ apiKey: 'pk_live_secret' });
    expect(output.join('\n')).toContain('https://purveyors.io/auth/cli');
  });

  it.each([
    ['request_expired', 'expired', 410, /expired/],
    ['request_consumed', 'already used', 410, /already used/],
    ['invalid_request', 'Malformed request', 400, /Malformed request/],
  ])('reports %s responses clearly', async (code, message, status, expected) => {
    const client = createClient([errorResponse(code, message, status)]);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(
      performDeviceLogin({
        headless: true,
        client: client as never,
        sleep: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow(expected);
  });

  it('reports network failures during polling', async () => {
    const client = createClient([]);
    client.cliAuth.exchange.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(
      performDeviceLogin({
        headless: true,
        client: client as never,
        sleep: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow(/Could not contact Parchment/);
  });

  it('cancels cleanly when interrupted', async () => {
    const client = createClient([]);
    const controller = new AbortController();
    controller.abort();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(
      performDeviceLogin({
        headless: true,
        client: client as never,
        signal: controller.signal,
      })
    ).rejects.toThrow(/cancelled/);
    expect(client.cliAuth.exchange).not.toHaveBeenCalled();
  });

  it('cancels promptly while the initial request is in flight', async () => {
    const client = createClient([]);
    client.cliAuth.create.mockImplementationOnce(() => new Promise(() => undefined));
    const controller = new AbortController();

    const login = performDeviceLogin({
      headless: true,
      client: client as never,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(client.cliAuth.create).toHaveBeenCalledOnce());
    controller.abort();

    await expect(login).rejects.toThrow(/cancelled/);
    expect(client.cliAuth.exchange).not.toHaveBeenCalled();
  });

  it('keeps a successful one-time exchange when cancellation arrives in flight', async () => {
    let resolveExchange!: (value: unknown) => void;
    const client = createClient([]);
    client.cliAuth.exchange.mockImplementationOnce(
      () => new Promise((resolve) => (resolveExchange = resolve))
    );
    const controller = new AbortController();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const login = performDeviceLogin({
      headless: true,
      client: client as never,
      sleep: vi.fn().mockResolvedValue(undefined),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(client.cliAuth.exchange).toHaveBeenCalledOnce());
    controller.abort();
    resolveExchange(
      response(
        {
          apiKey: 'pk_live_exchanged',
          key: { id: 'key-1', createdAt: '2026-07-14T02:00:00.000Z' },
          user: { id: 'user-1', email: 'user@example.com', role: 'member' },
        },
        201
      )
    );

    await expect(login).resolves.toMatchObject({ apiKey: 'pk_live_exchanged' });
  });

  it('cancels after an in-flight pending exchange returns', async () => {
    let resolveExchange!: (value: unknown) => void;
    const client = createClient([]);
    client.cliAuth.exchange.mockImplementationOnce(
      () => new Promise((resolve) => (resolveExchange = resolve))
    );
    const controller = new AbortController();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const login = performDeviceLogin({
      headless: true,
      client: client as never,
      sleep: vi.fn().mockResolvedValue(undefined),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(client.cliAuth.exchange).toHaveBeenCalledOnce());
    controller.abort();
    resolveExchange(errorResponse('authorization_pending', 'Authorization pending', 409));

    await expect(login).rejects.toThrow(/cancelled/);
    expect(client.cliAuth.exchange).toHaveBeenCalledOnce();
  });

  it('reports cancellation when an in-flight network wait rejects after abort', async () => {
    let rejectExchange!: (error: Error) => void;
    const client = createClient([]);
    client.cliAuth.exchange.mockImplementationOnce(
      () => new Promise((_, reject) => (rejectExchange = reject))
    );
    const controller = new AbortController();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const login = performDeviceLogin({
      headless: true,
      client: client as never,
      sleep: vi.fn().mockResolvedValue(undefined),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(client.cliAuth.exchange).toHaveBeenCalledOnce());
    controller.abort();
    rejectExchange(new Error('socket closed'));

    await expect(login).rejects.toThrow(/cancelled/);
  });

  it('bounds cancellation when an in-flight exchange never settles', async () => {
    const client = createClient([]);
    client.cliAuth.exchange.mockImplementationOnce(() => new Promise(() => undefined));
    const controller = new AbortController();
    const onExchangeCancellationWait = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const login = performDeviceLogin({
      headless: true,
      client: client as never,
      sleep: vi.fn().mockResolvedValue(undefined),
      signal: controller.signal,
      exchangeCancellationTimeoutMs: 5,
      onExchangeCancellationWait,
    });
    await vi.waitFor(() => expect(client.cliAuth.exchange).toHaveBeenCalledOnce());
    controller.abort();

    await expect(login).rejects.toThrow(/cancellation timed out/);
    expect(onExchangeCancellationWait).toHaveBeenCalledOnce();
  });

  it('caps sleep to the remaining TTL and does not exchange after expiry', async () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const client = createClient([], new Date(now + 1000).toISOString());
    const sleep = vi.fn().mockImplementation(async () => {
      vi.mocked(Date.now).mockReturnValue(now + 1000);
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(
      performDeviceLogin({ headless: true, client: client as never, sleep })
    ).rejects.toThrow(/expired/);
    expect(sleep).toHaveBeenCalledWith(1000, undefined);
    expect(client.cliAuth.exchange).not.toHaveBeenCalled();
  });

  it('rejects an already expired request without sleeping or exchanging', async () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const client = createClient([], new Date(now - 1).toISOString());
    const sleep = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(
      performDeviceLogin({ headless: true, client: client as never, sleep })
    ).rejects.toThrow(/expired/);
    expect(sleep).not.toHaveBeenCalled();
    expect(client.cliAuth.exchange).not.toHaveBeenCalled();
  });
});
