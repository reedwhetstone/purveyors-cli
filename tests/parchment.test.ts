import { describe, expect, it } from 'vitest';

import { unwrapParchment, type ParchmentResult } from '../src/lib/parchment.js';
import { AuthError, PrvrsError } from '../src/lib/errors.js';

function result<T>(status: number, error?: unknown, data?: T): ParchmentResult<T> {
  return {
    data,
    error,
    response: new Response(null, { status }),
  };
}

describe('unwrapParchment', () => {
  it('returns data on a successful response', () => {
    const payload = { rows: [1, 2, 3] };
    expect(unwrapParchment(result(200, undefined, payload), 'price-index')).toBe(payload);
  });

  it('maps HTTP 400 to INVALID_ARGUMENT so bad input stays distinguishable', () => {
    try {
      unwrapParchment(
        result(400, { error: { message: 'from must be a valid date' } }),
        'price-index'
      );
      throw new Error('expected unwrapParchment to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PrvrsError);
      expect((err as PrvrsError).code).toBe('INVALID_ARGUMENT');
      expect((err as PrvrsError).message).toContain('from must be a valid date');
    }
  });

  it('maps HTTP 401 to an AuthError', () => {
    expect(() => unwrapParchment(result(401, {}), 'price-index')).toThrow(AuthError);
  });

  it('maps HTTP 403 to an AuthError', () => {
    expect(() => unwrapParchment(result(403, {}), 'price-index')).toThrow(AuthError);
  });

  it('maps HTTP 404 to NOT_FOUND', () => {
    try {
      unwrapParchment(result(404, {}), 'procurement matches');
      throw new Error('expected unwrapParchment to throw');
    } catch (err) {
      expect((err as PrvrsError).code).toBe('NOT_FOUND');
    }
  });

  it('maps HTTP 409 to DEPENDENCY_CONFLICT', () => {
    expect(() =>
      unwrapParchment(
        result(409, { error: { message: 'Dependent roast profiles exist' } }),
        'inventory delete'
      )
    ).toThrowError(expect.objectContaining({ code: 'DEPENDENCY_CONFLICT' }));
  });

  it('falls back to GENERAL_ERROR for unexpected server failures', () => {
    try {
      unwrapParchment(result(500, {}), 'price-index');
      throw new Error('expected unwrapParchment to throw');
    } catch (err) {
      expect((err as PrvrsError).code).toBe('GENERAL_ERROR');
    }
  });
});
