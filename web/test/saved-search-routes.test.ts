import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock next/server before importing routes.
// ---------------------------------------------------------------------------

class MockNextResponse<T = unknown> {
  readonly status: number;
  private _body: T | null;

  constructor(body: BodyInit | null, init?: ResponseInit) {
    this.status = init?.status ?? 200;
    this._body = body as T | null;
  }

  static json<J>(data: J, init?: ResponseInit): MockNextResponse<J> {
    const res = new MockNextResponse<J>(null, init);
    res._body = data;
    return res;
  }

  async json(): Promise<T | null> {
    return this._body;
  }
}

class MockNextRequest {
  readonly nextUrl: { searchParams: URLSearchParams };
  private readonly _body: unknown;

  constructor(url: string, init?: { method?: string; body?: string }) {
    this.nextUrl = { searchParams: new URLSearchParams(new URL(url).search) };
    this._body = init?.body ? (JSON.parse(init.body) as unknown) : undefined;
  }

  async json(): Promise<unknown> {
    return this._body;
  }
}

vi.mock('next/server', () => ({
  NextRequest: MockNextRequest,
  NextResponse: MockNextResponse,
}));

// ---------------------------------------------------------------------------
// Mock the web/lib/saved-searches module
// ---------------------------------------------------------------------------

const mockListSavedSearches = vi.fn();
const mockGetSavedSearch = vi.fn();
const mockCreateSavedSearch = vi.fn();
const mockUpdateSavedSearch = vi.fn();
const mockDeleteSavedSearch = vi.fn();
const mockBuildParkRegionOf = vi.fn(() => () => null);

vi.mock('../lib/saved-searches.js', () => ({
  listSavedSearches: (...args: unknown[]) => mockListSavedSearches(...args),
  getSavedSearch: (...args: unknown[]) => mockGetSavedSearch(...args),
  createSavedSearch: (...args: unknown[]) => mockCreateSavedSearch(...args),
  updateSavedSearch: (...args: unknown[]) => mockUpdateSavedSearch(...args),
  deleteSavedSearch: (...args: unknown[]) => mockDeleteSavedSearch(...args),
  buildParkRegionOf: (...args: unknown[]) => mockBuildParkRegionOf(...args),
}));

// ---------------------------------------------------------------------------
// Mock the availability-cache re-export
// ---------------------------------------------------------------------------

const mockSearchAvailableStays = vi.fn(async () => []);
const mockGetEntriesForPark = vi.fn(async () => []);

vi.mock('../lib/availability-cache.js', () => ({
  searchAvailableStays: (...args: unknown[]) => mockSearchAvailableStays(...args),
  getEntriesForPark: (...args: unknown[]) => mockGetEntriesForPark(...args),
}));

// ---------------------------------------------------------------------------
// Mock the saved-search matcher
// ---------------------------------------------------------------------------

const mockMatchSavedSearch = vi.fn(async () => []);

vi.mock('../../src/saved-search/match.js', () => ({
  matchSavedSearch: (...args: unknown[]) => mockMatchSavedSearch(...args),
  // todayUtc is imported by the /run route; return the real UTC date so the route works
  todayUtc: () => new Date().toISOString().slice(0, 10),
}));

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks are set up
// ---------------------------------------------------------------------------

const { GET: collectionGET, POST: collectionPOST } =
  await import('../app/api/saved-searches/route.js');

const { GET: itemGET, PATCH: itemPATCH, DELETE: itemDELETE } =
  await import('../app/api/saved-searches/[id]/route.js');

const { POST: runPOST } =
  await import('../app/api/saved-searches/[id]/run/route.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSearch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ss-1',
    userId: null,
    provider: 'california-parks',
    name: 'Bay Area Weekends',
    scope: { region: 'bay-area', parkPageIds: [] },
    datePattern: { kind: 'any_weekend', horizonDays: 90 },
    filters: { access: [], kinds: [], hide: [], minNights: 1 },
    alertEnabled: false,
    emailEnabled: true,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeReq(url: string, opts?: { method?: string; body?: unknown }): MockNextRequest {
  return new MockNextRequest(url, {
    method: opts?.method,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

type RouteHandler<TReq, TCtx = void> = TCtx extends void
  ? (req: TReq) => Promise<MockNextResponse<unknown>>
  : (req: TReq, ctx: TCtx) => Promise<MockNextResponse<unknown>>;

// ---------------------------------------------------------------------------
// GET /api/saved-searches
// ---------------------------------------------------------------------------

describe('GET /api/saved-searches', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns { savedSearches: [] } when store is empty', async () => {
    mockListSavedSearches.mockResolvedValue([]);
    const req = makeReq('http://localhost/api/saved-searches');
    const handler = collectionGET as RouteHandler<MockNextRequest>;
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { savedSearches: unknown[] };
    expect(body.savedSearches).toEqual([]);
  });

  it('returns saved searches from the store', async () => {
    const search = makeSearch();
    mockListSavedSearches.mockResolvedValue([search]);
    const req = makeReq('http://localhost/api/saved-searches');
    const handler = collectionGET as RouteHandler<MockNextRequest>;
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { savedSearches: unknown[] };
    expect(body.savedSearches).toHaveLength(1);
  });

  it('returns 500 when the store throws', async () => {
    mockListSavedSearches.mockRejectedValue(new Error('DB gone'));
    const req = makeReq('http://localhost/api/saved-searches');
    const handler = collectionGET as RouteHandler<MockNextRequest>;
    const res = await handler(req);
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('DB gone');
  });
});

// ---------------------------------------------------------------------------
// POST /api/saved-searches
// ---------------------------------------------------------------------------

describe('POST /api/saved-searches', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates a saved search and returns 201 with { savedSearch }', async () => {
    const search = makeSearch();
    mockCreateSavedSearch.mockResolvedValue(search);
    const req = makeReq('http://localhost/api/saved-searches', { method: 'POST', body: search });
    const handler = collectionPOST as RouteHandler<MockNextRequest>;
    const res = await handler(req);
    expect(res.status).toBe(201);
    const body = await res.json() as { savedSearch: Record<string, unknown> };
    expect(body.savedSearch['id']).toBe('ss-1');
  });

  it('returns 400 when the store throws a validation error', async () => {
    const { ZodError, z } = await import('zod');
    const fakeError = new ZodError(
      z.object({ name: z.string().min(1) }).safeParse({ name: '' }).error!.issues
    );
    mockCreateSavedSearch.mockRejectedValue(fakeError);
    const req = makeReq('http://localhost/api/saved-searches', { method: 'POST', body: { name: '' } });
    const handler = collectionPOST as RouteHandler<MockNextRequest>;
    const res = await handler(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 500 when the store throws a generic (non-Zod) error', async () => {
    mockCreateSavedSearch.mockRejectedValue(new Error('DB connection failed'));
    const req = makeReq('http://localhost/api/saved-searches', { method: 'POST', body: {} });
    const handler = collectionPOST as RouteHandler<MockNextRequest>;
    const res = await handler(req);
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('DB connection failed');
  });
});

// ---------------------------------------------------------------------------
// GET /api/saved-searches/[id]
// ---------------------------------------------------------------------------

describe('GET /api/saved-searches/[id]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 200 with { savedSearch } when found', async () => {
    const search = makeSearch();
    mockGetSavedSearch.mockResolvedValue(search);
    const req = makeReq('http://localhost/api/saved-searches/ss-1');
    const handler = itemGET as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    const res = await handler(req, makeParams('ss-1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { savedSearch: Record<string, unknown> };
    expect(body.savedSearch['id']).toBe('ss-1');
  });

  it('returns 404 when not found', async () => {
    mockGetSavedSearch.mockResolvedValue(undefined);
    const req = makeReq('http://localhost/api/saved-searches/bad-id');
    const handler = itemGET as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    const res = await handler(req, makeParams('bad-id'));
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('returns 500 on unexpected error', async () => {
    mockGetSavedSearch.mockRejectedValue(new Error('Postgres gone'));
    const req = makeReq('http://localhost/api/saved-searches/ss-1');
    const handler = itemGET as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    const res = await handler(req, makeParams('ss-1'));
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/saved-searches/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/saved-searches/[id]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 200 with updated search when patch is valid', async () => {
    const original = makeSearch();
    const patched = makeSearch({ name: 'Renamed' });
    mockGetSavedSearch.mockResolvedValue(original);
    mockUpdateSavedSearch.mockResolvedValue(patched);
    const req = makeReq('http://localhost/api/saved-searches/ss-1', { method: 'PATCH', body: { name: 'Renamed' } });
    const handler = itemPATCH as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    const res = await handler(req, makeParams('ss-1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { savedSearch: Record<string, unknown> };
    expect(body.savedSearch['name']).toBe('Renamed');
  });

  it('returns 404 when id is not found on GET-before-patch check', async () => {
    mockGetSavedSearch.mockResolvedValue(undefined);
    const req = makeReq('http://localhost/api/saved-searches/missing', { method: 'PATCH', body: { name: 'x' } });
    const handler = itemPATCH as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    const res = await handler(req, makeParams('missing'));
    expect(res.status).toBe(404);
  });

  it('returns 400 when update throws a ZodError (invalid patch)', async () => {
    const { ZodError, z } = await import('zod');
    const fakeError = new ZodError(
      z.object({ name: z.string().min(1) }).safeParse({ name: '' }).error!.issues
    );
    mockGetSavedSearch.mockResolvedValue(makeSearch());
    mockUpdateSavedSearch.mockRejectedValue(fakeError);
    const req = makeReq('http://localhost/api/saved-searches/ss-1', { method: 'PATCH', body: { name: '' } });
    const handler = itemPATCH as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    const res = await handler(req, makeParams('ss-1'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when update throws a "not found" error (race condition)', async () => {
    mockGetSavedSearch.mockResolvedValue(makeSearch());
    mockUpdateSavedSearch.mockRejectedValue(new Error('SavedSearch "ss-1" not found'));
    const req = makeReq('http://localhost/api/saved-searches/ss-1', { method: 'PATCH', body: { name: 'x' } });
    const handler = itemPATCH as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    const res = await handler(req, makeParams('ss-1'));
    expect(res.status).toBe(404);
  });

  it('returns 500 when update throws a generic (non-Zod, non-not-found) error', async () => {
    mockGetSavedSearch.mockResolvedValue(makeSearch());
    mockUpdateSavedSearch.mockRejectedValue(new Error('DB connection failed'));
    const req = makeReq('http://localhost/api/saved-searches/ss-1', { method: 'PATCH', body: { name: 'x' } });
    const handler = itemPATCH as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    const res = await handler(req, makeParams('ss-1'));
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('DB connection failed');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/saved-searches/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/saved-searches/[id]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 204 with null body', async () => {
    mockDeleteSavedSearch.mockResolvedValue(undefined);
    const req = makeReq('http://localhost/api/saved-searches/ss-1', { method: 'DELETE' });
    const handler = itemDELETE as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    const res = await handler(req, makeParams('ss-1'));
    expect(res.status).toBe(204);
  });

  it('returns 500 when delete throws', async () => {
    mockDeleteSavedSearch.mockRejectedValue(new Error('DB error'));
    const req = makeReq('http://localhost/api/saved-searches/ss-1', { method: 'DELETE' });
    const handler = itemDELETE as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    const res = await handler(req, makeParams('ss-1'));
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/saved-searches/[id]/run
// ---------------------------------------------------------------------------

describe('POST /api/saved-searches/[id]/run', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 404 when the search is not found', async () => {
    mockGetSavedSearch.mockResolvedValue(undefined);
    const req = makeReq('http://localhost/api/saved-searches/bad-id/run', { method: 'POST' });
    const handler = runPOST as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    const res = await handler(req, makeParams('bad-id'));
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('returns { openings: [] } when matcher finds nothing', async () => {
    mockGetSavedSearch.mockResolvedValue(makeSearch());
    mockMatchSavedSearch.mockResolvedValue([]);
    const req = makeReq('http://localhost/api/saved-searches/ss-1/run', { method: 'POST' });
    const handler = runPOST as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    const res = await handler(req, makeParams('ss-1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { openings: unknown[] };
    expect(body.openings).toEqual([]);
  });

  it('returns openings array from matchSavedSearch', async () => {
    const opening = {
      savedSearchId: 'ss-1',
      parkPageId: 'park-42',
      parkName: 'Angel Island SP',
      campgroundName: 'Camp',
      siteName: 'Site 4',
      arrivalDate: '2026-08-01',
      departureDate: '2026-08-02',
      nights: 1,
      bookingUrl: 'https://example.com/book',
    };
    mockGetSavedSearch.mockResolvedValue(makeSearch());
    mockMatchSavedSearch.mockResolvedValue([opening]);
    const req = makeReq('http://localhost/api/saved-searches/ss-1/run', { method: 'POST' });
    const handler = runPOST as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    const res = await handler(req, makeParams('ss-1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { openings: unknown[] };
    expect(body.openings).toHaveLength(1);
    expect((body.openings[0] as Record<string, unknown>)['parkName']).toBe('Angel Island SP');
  });

  it('returns 500 when matchSavedSearch throws', async () => {
    mockGetSavedSearch.mockResolvedValue(makeSearch());
    mockMatchSavedSearch.mockRejectedValue(new Error('cache unavailable'));
    const req = makeReq('http://localhost/api/saved-searches/ss-1/run', { method: 'POST' });
    const handler = runPOST as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    const res = await handler(req, makeParams('ss-1'));
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('cache unavailable');
  });

  it('passes a UTC-anchored today to matchSavedSearch (no dayjs local-time divergence)', async () => {
    mockGetSavedSearch.mockResolvedValue(makeSearch());
    mockMatchSavedSearch.mockResolvedValue([]);

    const req = makeReq('http://localhost/api/saved-searches/ss-1/run', { method: 'POST' });
    const handler = runPOST as RouteHandler<MockNextRequest, { params: Promise<{ id: string }> }>;
    await handler(req, makeParams('ss-1'));

    expect(mockMatchSavedSearch).toHaveBeenCalledOnce();
    const calledToday = mockMatchSavedSearch.mock.calls[0][2] as string;
    // Must be a valid YYYY-MM-DD string
    expect(calledToday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Must match what new Date().toISOString().slice(0, 10) returns (UTC date)
    expect(calledToday).toBe(new Date().toISOString().slice(0, 10));
  });
});
