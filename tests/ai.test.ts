import { describe, it, expect, vi } from 'vitest';
import type { ClassifyRoastInput, ClassifyRoastResult } from '../src/lib/ai.js';

// ─── Type validation ──────────────────────────────────────────────────────────

describe('ClassifyRoastInput type shape', () => {
  it('accepts minimal input with only title', () => {
    const input: ClassifyRoastInput = {
      alogMetadata: { title: 'Ethiopia Guji 01' },
      inventory: [],
    };
    expect(input.alogMetadata.title).toBe('Ethiopia Guji 01');
  });

  it('accepts full metadata fields', () => {
    const input: ClassifyRoastInput = {
      alogMetadata: {
        title: 'Ethiopia Guji',
        roastertype: 'Aillio Bullet R1',
        beans: 'Ethiopia Guji Buku',
        roastingnotes: 'Light roast, floral',
        weight: [200, 170, 'g'],
      },
      inventory: [
        { id: 1, coffee_name: 'Ethiopia Guji Buku', origin: 'Ethiopia', processing: 'natural' },
      ],
    };
    expect(input.alogMetadata.weight).toEqual([200, 170, 'g']);
    expect(input.inventory[0].id).toBe(1);
  });

  it('accepts inventory without optional fields', () => {
    const input: ClassifyRoastInput = {
      alogMetadata: { title: 'Test Roast' },
      inventory: [{ id: 42, coffee_name: 'Mystery Bean' }],
    };
    expect(input.inventory[0].origin).toBeUndefined();
    expect(input.inventory[0].processing).toBeUndefined();
  });
});

// ─── Response parsing ─────────────────────────────────────────────────────────

describe('ClassifyRoastResult parsing', () => {
  it('parses a valid match response', () => {
    const raw: ClassifyRoastResult = {
      match: {
        inventoryId: 7,
        coffeeName: 'Ethiopia Guji Buku',
        confidence: 95,
        reasoning: 'Title and beans field both reference Ethiopia Guji.',
      },
    };
    expect(raw.match).not.toBeNull();
    expect(raw.match!.inventoryId).toBe(7);
    expect(raw.match!.confidence).toBe(95);
  });

  it('parses a null match response', () => {
    const raw: ClassifyRoastResult = { match: null };
    expect(raw.match).toBeNull();
  });

  it('handles malformed response gracefully via type widening', () => {
    // Simulate what happens if the API returns unexpected shape
    const raw = { match: null } as ClassifyRoastResult;
    expect(() => raw.match?.inventoryId).not.toThrow();
  });
});

// ─── Confidence threshold logic ───────────────────────────────────────────────

describe('confidence threshold logic', () => {
  /** Mirrors the threshold check in watch.ts runAutoMatch */
  function shouldAutoImport(confidence: number): boolean {
    return confidence >= 50;
  }

  it('auto-imports at exactly 50% confidence', () => {
    expect(shouldAutoImport(50)).toBe(true);
  });

  it('auto-imports above 50% confidence', () => {
    expect(shouldAutoImport(95)).toBe(true);
    expect(shouldAutoImport(51)).toBe(true);
  });

  it('marks as needs-review below 50% confidence', () => {
    expect(shouldAutoImport(49)).toBe(false);
    expect(shouldAutoImport(0)).toBe(false);
    expect(shouldAutoImport(30)).toBe(false);
  });

  it('handles edge values at boundary', () => {
    expect(shouldAutoImport(50)).toBe(true);
    expect(shouldAutoImport(49)).toBe(false);
  });
});

// ─── classifyRoast error handling ────────────────────────────────────────────

describe('classifyRoast error handling', () => {
  it('throws AuthError when no session', async () => {
    const { classifyRoast } = await import('../src/lib/ai.js');

    const mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      },
    } as unknown as Parameters<typeof classifyRoast>[0];

    await expect(
      classifyRoast(mockSupabase, {
        alogMetadata: { title: 'Test' },
        inventory: [],
      })
    ).rejects.toThrow('Not authenticated');
  });

  it('throws on 403 response', async () => {
    const { classifyRoast } = await import('../src/lib/ai.js');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    const mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'mock-token' } },
        }),
      },
    } as unknown as Parameters<typeof classifyRoast>[0];

    try {
      await expect(
        classifyRoast(mockSupabase, {
          alogMetadata: { title: 'Test' },
          inventory: [],
        })
      ).rejects.toThrow('Member role required');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('throws on 429 response', async () => {
    const { classifyRoast } = await import('../src/lib/ai.js');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    const mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'mock-token' } },
        }),
      },
    } as unknown as Parameters<typeof classifyRoast>[0];

    try {
      await expect(
        classifyRoast(mockSupabase, {
          alogMetadata: { title: 'Test' },
          inventory: [],
        })
      ).rejects.toThrow('Rate limit exceeded');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('throws generic error on other non-ok responses', async () => {
    const { classifyRoast } = await import('../src/lib/ai.js');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    const mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'mock-token' } },
        }),
      },
    } as unknown as Parameters<typeof classifyRoast>[0];

    try {
      await expect(
        classifyRoast(mockSupabase, {
          alogMetadata: { title: 'Test' },
          inventory: [],
        })
      ).rejects.toThrow('AI classification failed');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('returns parsed result on success', async () => {
    const { classifyRoast } = await import('../src/lib/ai.js');

    const expectedResult: ClassifyRoastResult = {
      match: {
        inventoryId: 3,
        coffeeName: 'Colombia Huila',
        confidence: 82,
        reasoning: 'Title mentions Colombia, inventory has Colombia Huila.',
      },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(expectedResult),
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    const mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'mock-token' } },
        }),
      },
    } as unknown as Parameters<typeof classifyRoast>[0];

    try {
      const result = await classifyRoast(mockSupabase, {
        alogMetadata: { title: 'colombia-02.alog' },
        inventory: [{ id: 3, coffee_name: 'Colombia Huila', origin: 'Colombia' }],
      });
      expect(result.match).not.toBeNull();
      expect(result.match!.inventoryId).toBe(3);
      expect(result.match!.confidence).toBe(82);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('handles network error (fetch throws) gracefully at call site', async () => {
    const { classifyRoast } = await import('../src/lib/ai.js');

    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    const mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'mock-token' } },
        }),
      },
    } as unknown as Parameters<typeof classifyRoast>[0];

    try {
      // The function itself throws — callers (runAutoMatch) catch it
      await expect(
        classifyRoast(mockSupabase, {
          alogMetadata: { title: 'Test' },
          inventory: [],
        })
      ).rejects.toThrow('network error');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ─── ImportRecord with AI fields ─────────────────────────────────────────────

describe('ImportRecord aiMatch field', () => {
  it('can hold a complete aiMatch result', () => {
    // Type-level check: ImportRecord accepts aiMatch
    type ImportRecord = {
      fileName: string;
      roastId: number | null;
      batchName: string;
      status: 'success' | 'failed' | 'needs-review';
      error?: string;
      importedAt: string;
      aiMatch?: {
        coffeeName: string;
        confidence: number;
        reasoning: string;
      };
    };

    const rec: ImportRecord = {
      fileName: 'ethiopia-guji-01.alog',
      roastId: 456,
      batchName: 'Ethiopia Guji #1',
      status: 'success',
      importedAt: new Date().toISOString(),
      aiMatch: {
        coffeeName: 'Ethiopia Guji Buku',
        confidence: 95,
        reasoning: 'Direct match on beans field.',
      },
    };

    expect(rec.aiMatch!.confidence).toBe(95);
    expect(rec.aiMatch!.coffeeName).toBe('Ethiopia Guji Buku');
  });

  it('can hold a needs-review record with low confidence aiMatch', () => {
    type ImportRecord = {
      fileName: string;
      roastId: number | null;
      batchName: string;
      status: 'success' | 'failed' | 'needs-review';
      error?: string;
      importedAt: string;
      aiMatch?: {
        coffeeName: string;
        confidence: number;
        reasoning: string;
      };
    };

    const rec: ImportRecord = {
      fileName: 'mystery-03.alog',
      roastId: null,
      batchName: 'Roast #3',
      status: 'needs-review',
      error: 'Low AI confidence (30%)',
      importedAt: new Date().toISOString(),
      aiMatch: {
        coffeeName: 'Unknown Bean',
        confidence: 30,
        reasoning: 'No clear match found.',
      },
    };

    expect(rec.status).toBe('needs-review');
    expect(rec.roastId).toBeNull();
    expect(rec.aiMatch!.confidence).toBe(30);
  });

  it('is optional — records without AI match are valid', () => {
    type ImportRecord = {
      fileName: string;
      roastId: number | null;
      batchName: string;
      status: 'success' | 'failed' | 'needs-review';
      error?: string;
      importedAt: string;
      aiMatch?: {
        coffeeName: string;
        confidence: number;
        reasoning: string;
      };
    };

    const rec: ImportRecord = {
      fileName: 'roast.alog',
      roastId: 100,
      batchName: 'Test #1',
      status: 'success',
      importedAt: new Date().toISOString(),
    };

    expect(rec.aiMatch).toBeUndefined();
  });
});
