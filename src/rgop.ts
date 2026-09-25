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
