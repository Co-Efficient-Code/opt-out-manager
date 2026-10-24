import type { Env } from './types';

/**
 * ReadyGOP client — READ ONLY.
 *
 * Pulls opt-outs for a client via Walker's proxy at tools.coefficient.org,
 * which is a pass-through to api.readygop.com/graphql (the proxy injects the
 * bearer token). We send raw GraphQL.
 *
 * The full proxy URL (including ?api_key=...) is stored as the RGOP_PROXY_URL
 * Worker secret so the key never lands in code or git.
 *
 * NOTE: never use client(id).optOuts — it is unpaginated and 504s on large
 * clients. Use the root optOuts(first, after, filters) with cursor pagination.
 */

export const MAGA_CLIENT = {
  name: 'MAGA, Inc.',
  id: '23681c8f-88d4-461a-89bd-42e5f2a5df6b',
};

export interface RgopOptOut {
  phone: string | null;
  project: string;
  createdAt: string | null;
  // Which texting platform this opt-out came from. Set by each pull source so
  // the run log / email can attribute each project to its platform. Projects
  // are unique to one platform, so this is a clean 1:1 label per project.
  platform?: 'ReadyGOP' | 'co/nnect';
}

const OPTOUTS_QUERY = `query($f:[OptOutQueryFilterInput!],$first:Int,$after:String){
  optOuts(first:$first,after:$after,filters:$f,sortBy:CreatedAt,sortOrder:DESC){
    totalCount cursors nodes{ createdAt phone{ number } project{ name } } } }`;

async function gql(env: Env, query: string, variables: unknown): Promise<any> {
  const url = env.RGOP_PROXY_URL;
  if (!url) throw new Error('RGOP_PROXY_URL secret is not configured');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ReadyGOP proxy HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as any;
  if (data.errors) {
    throw new Error(`ReadyGOP GraphQL error: ${JSON.stringify(data.errors).slice(0, 300)}`);
  }
  return data;
}

/**
 * gql with bounded retry/backoff. The proxy occasionally returns a transient
 * 5xx; with ~500 pages a single blip would fail the whole pull, so retry a few
 * times before giving up. Keeps total added latency small.
 */
async function gqlRetry(env: Env, query: string, variables: unknown, attempts = 4): Promise<any> {
  let lastErr: unknown;
  for (let a = 0; a < attempts; a++) {
    try {
      return await gql(env, query, variables);
    } catch (e) {
      lastErr = e;
      // linear-ish backoff: 300ms, 600ms, 900ms
      if (a < attempts - 1) await new Promise((r) => setTimeout(r, 300 * (a + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface PullProgress {
  page: number;
  pulled: number;
  totalCount: number;
}

/**
 * Pull ALL opt-outs for a client, newest first, via cursor pagination.
 *
 * Full pull every time (no cap). Pass onProgress to get a callback after each
 * page so the caller can stream live status to the UI. maxRows defaults to 0
 * (unlimited); set it only for tests.
 */
export async function pullOptOuts(
  env: Env,
  clientId: string,
  opts: { pageSize?: number; maxRows?: number; onProgress?: (p: PullProgress) => void | Promise<void> } = {},
): Promise<{ rows: RgopOptOut[]; totalCount: number }> {
  const pageSize = opts.pageSize ?? 500;
  const maxRows = opts.maxRows ?? 0; // 0 = pull everything
  const filters = [{ field: 'clientId', operation: 'EQUAL', value: clientId }];
  const rows: RgopOptOut[] = [];
  let cursor = 'MA';
  const seen = new Set<string>(['MA']);
  let totalCount = 0;

  for (let i = 0; i < 1000; i++) {
    const d = await gql(env, OPTOUTS_QUERY, { first: pageSize, after: cursor, f: filters });
    const oo = d?.data?.optOuts;
    if (!oo) break;
    totalCount = oo.totalCount ?? totalCount;
    for (const n of oo.nodes || []) {
      // The project number is embedded in name, tab-separated:
      // "261185\tTX CD 28 Big Dog SAG MMS 9.15". Keep the WHOLE thing (number
      // included) as the display name; just swap the tab for a space.
      const nm = (n?.project?.name ?? '').replace(/\t/g, ' ').trim();
      rows.push({
        phone: n?.phone?.number ?? null,
        project: nm,
        createdAt: n?.createdAt ?? null,
        platform: 'ReadyGOP',
      });
    }
    if (opts.onProgress) await opts.onProgress({ page: i + 1, pulled: rows.length, totalCount });
    if (maxRows && rows.length >= maxRows) break;
    const next = (oo.cursors || []).find((c: string) => !seen.has(c));
    if (!next) break;
    seen.add(next);
    cursor = next;
  }
  return { rows, totalCount };
}

// ReadyGOP hard-caps every page at 250 rows regardless of the requested `first`
// (verified against the proxy). The `after` cursor is simply base64(offset), so
// we can compute every page offset up front and fetch pages CONCURRENTLY in
// batches instead of walking one cursor at a time. This is the fix for the
// nightly 503 / Cloudflare 1102 (Worker exceeded wall-clock): ~500 sequential
// 0.66s round-trips (~5.6 min) exceeded the 5-minute limit; batched concurrency
// brings it to well under a minute.
export const RGOP_PAGE_ROWS = 250;

function offsetCursor(off: number): string {
  // base64 of the decimal offset, matching the proxy's cursor scheme.
  return btoa(String(off));
}

/**
 * Parallel full pull. Step 1: one request to learn totalCount. Step 2: compute
 * all page offsets (0, 250, 500, ...) and fetch them in concurrency-limited
 * batches, accumulating rows. Deterministic (offset cursors), order-independent.
 *
 * `concurrency` controls how many pages are in flight at once (default 12).
 * Keeps us comfortably under the Workers subrequest ceiling (~1000) since page
 * count is ~500, and well under the wall-clock limit.
 */
export async function pullOptOutsParallel(
  env: Env,
  clientId: string,
  opts: {
    concurrency?: number;
    maxRows?: number;
    onProgress?: (p: PullProgress) => void | Promise<void>;
    // When provided, each row is handed to onRow and NOT accumulated. This keeps
    // memory bounded (no 126k-row array) -- used by the nightly runner, which
    // streams rows straight into the run-log accumulator. When omitted, the full
    // array is returned (back-compat for array callers).
    onRow?: (r: RgopOptOut) => void;
  } = {},
): Promise<{ rows: RgopOptOut[]; totalCount: number }> {
  const concurrency = Math.max(1, opts.concurrency ?? 12);
  const filters = [{ field: 'clientId', operation: 'EQUAL', value: clientId }];
  const streaming = typeof opts.onRow === 'function';

  const mapNode = (n: any): RgopOptOut => ({
    phone: n?.phone?.number ?? null,
    project: (n?.project?.name ?? '').replace(/\t/g, ' ').trim(),
    createdAt: n?.createdAt ?? null,
    platform: 'ReadyGOP',
  });
  const rows: RgopOptOut[] = [];
  let pulled = 0;
  const take = (n: any) => {
    const row = mapNode(n);
    pulled += 1;
    if (streaming) opts.onRow!(row);
    else rows.push(row);
  };

  // Step 1: probe totalCount (and consume the first page while we're here).
  const firstPage = await gqlRetry(env, OPTOUTS_QUERY, { first: RGOP_PAGE_ROWS, after: offsetCursor(0), f: filters });
  const firstOO = firstPage?.data?.optOuts;
  const totalCount: number = firstOO?.totalCount ?? 0;
  for (const n of firstOO?.nodes || []) take(n);
  if (opts.onProgress) await opts.onProgress({ page: 1, pulled, totalCount });

  // Build the remaining page offsets (page 0 already fetched above).
  const cap = opts.maxRows && opts.maxRows > 0 ? Math.min(opts.maxRows, totalCount) : totalCount;
  const offsets: number[] = [];
  for (let off = RGOP_PAGE_ROWS; off < cap; off += RGOP_PAGE_ROWS) offsets.push(off);

  // Step 2: fetch remaining offsets in concurrency-limited batches. Each batch's
  // responses are consumed then dropped, so at most `concurrency` pages of raw
  // JSON are alive at once.
  let done = 1; // first page counted
  for (let i = 0; i < offsets.length; i += concurrency) {
    const batch = offsets.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((off) => gqlRetry(env, OPTOUTS_QUERY, { first: RGOP_PAGE_ROWS, after: offsetCursor(off), f: filters })),
    );
    for (const d of results) {
      const oo = d?.data?.optOuts;
      for (const n of oo?.nodes || []) take(n);
    }
    done += batch.length;
    if (opts.onProgress) await opts.onProgress({ page: done, pulled, totalCount });
    if (opts.maxRows && pulled >= opts.maxRows) break;
  }

  return { rows, totalCount };
}

/**
 * Memory-bounded variant: pull ALL opt-outs page by page, invoking `onRow` for
 * each row and DISCARDING it (never accumulates the full array). Use this when
 * the caller only needs a reduced view (e.g. a filtered phone Set + per-project
 * counts), so the 70k+ row array never lives in memory at once.
 */
export async function pullOptOutsReduce(
  env: Env,
  clientId: string,
  onRow: (row: RgopOptOut) => void,
  onProgress?: (pulled: number, totalCount: number) => void | Promise<void>,
  pageSize = 500,
): Promise<{ pulled: number; totalCount: number }> {
  const filters = [{ field: 'clientId', operation: 'EQUAL', value: clientId }];
  let cursor = 'MA';
  const seen = new Set<string>(['MA']);
  let totalCount = 0;
  let pulled = 0;
  for (let i = 0; i < 2000; i++) {
    const d = await gql(env, OPTOUTS_QUERY, { first: pageSize, after: cursor, f: filters });
    const oo = d?.data?.optOuts;
    if (!oo) break;
    totalCount = oo.totalCount ?? totalCount;
    for (const n of oo.nodes || []) {
      const nm = (n?.project?.name ?? '').replace(/\t/g, ' ').trim();
      onRow({
        phone: n?.phone?.number ?? null,
        project: nm,
        createdAt: n?.createdAt ?? null,
        platform: 'ReadyGOP',
      });
      pulled++;
    }
    if (onProgress) await onProgress(pulled, totalCount);
    const next = (oo.cursors || []).find((c: string) => !seen.has(c));
    if (!next) break;
    seen.add(next);
    cursor = next;
  }
  return { pulled, totalCount };
}
