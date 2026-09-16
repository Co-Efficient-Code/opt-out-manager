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
 * Pull opt-outs for a client, newest first, via cursor pagination.
 * maxRows caps the pull so a dry-run UI call stays fast; pass 0 for all.
 */
export async function pullOptOuts(
  env: Env,
  clientId: string,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<{ rows: RgopOptOut[]; totalCount: number }> {
  const pageSize = opts.pageSize ?? 500;
  const maxRows = opts.maxRows ?? 2000;
  const filters = [{ field: 'clientId', operation: 'EQUAL', value: clientId }];
  const rows: RgopOptOut[] = [];
  let cursor = 'MA';
  const seen = new Set<string>(['MA']);
  let totalCount = 0;

  for (let i = 0; i < 500; i++) {
    const d = await gql(env, OPTOUTS_QUERY, { first: pageSize, after: cursor, f: filters });
    const oo = d?.data?.optOuts;
    if (!oo) break;
    totalCount = oo.totalCount ?? totalCount;
    for (const n of oo.nodes || []) {
      rows.push({
        phone: n?.phone?.number ?? null,
        project: n?.project?.name ?? '',
        createdAt: n?.createdAt ?? null,
      });
    }
    if (maxRows && rows.length >= maxRows) break;
    const next = (oo.cursors || []).find((c: string) => !seen.has(c));
    if (!next) break;
    seen.add(next);
    cursor = next;
  }
  return { rows, totalCount };
}
