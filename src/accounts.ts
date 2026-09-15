import type { Env } from './types';
import { listObjects } from './s3';
import type { SyncRole } from './s3';

export interface AccountFile {
  key: string;        // full S3 key: optouts/<org>/<file>.csv
  file: string;       // filename only
  size: number;       // bytes
  lastModified: string;
}

export interface Account {
  org: string;               // e.g. sag-pac
  fileCount: number;
  latestFile?: string;
  latestModified?: string;
  totalBytes: number;
}

// Minimal XML parse of an S3 ListBucketV2 response (Workers-safe, no deps).
function parseListXml(xml: string): AccountFile[] {
  const out: AccountFile[] = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const key = (/<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1] ?? '').trim();
    const size = parseInt(/<Size>([\s\S]*?)<\/Size>/.exec(block)?.[1] ?? '0', 10);
    const lm = (/<LastModified>([\s\S]*?)<\/LastModified>/.exec(block)?.[1] ?? '').trim();
    if (!key || key.endsWith('/')) continue; // skip folder markers
    const file = key.split('/').pop() ?? key;
    out.push({ key, file, size, lastModified: lm });
  }
  return out;
}

function orgFromKey(key: string): string | null {
  // optouts/<org>/<file>
  const parts = key.split('/');
  if (parts.length < 3 || parts[0] !== 'optouts') return null;
  return parts[1] || null;
}

/** List all opt-out files in a given bucket role. Read-only. */
export async function listFilesForRole(env: Env, role: SyncRole): Promise<AccountFile[]> {
  const res = await listObjects(env, role, 'optouts/');
  const xml = await res.text();
  if (!res.ok) throw new Error(`${role} list failed: ${res.status}`);
  return parseListXml(xml);
}

/** List all opt-out files in the SOURCE (p2p) bucket. Read-only. */
export async function listSourceFiles(env: Env): Promise<AccountFile[]> {
  return listFilesForRole(env, 'source');
}

/** Derive the account (PAC) list from a bucket role's prefixes. */
export async function listAccountsForRole(env: Env, role: SyncRole): Promise<Account[]> {
  const files = await listFilesForRole(env, role);
  return buildAccounts(files);
}

/** Derive the account (PAC) list from the source bucket prefixes. */
export async function listAccounts(env: Env): Promise<Account[]> {
  const files = await listSourceFiles(env);
  return buildAccounts(files);
}

function buildAccounts(files: AccountFile[]): Account[] {
  const byOrg = new Map<string, AccountFile[]>();
  for (const f of files) {
    const org = orgFromKey(f.key);
    if (!org) continue;
    const arr = byOrg.get(org) ?? [];
    arr.push(f);
    byOrg.set(org, arr);
  }
  const accounts: Account[] = [];
  for (const [org, arr] of byOrg) {
    arr.sort((a, b) => a.lastModified.localeCompare(b.lastModified));
    const latest = arr[arr.length - 1];
    accounts.push({
      org,
      fileCount: arr.length,
      latestFile: latest?.file,
      latestModified: latest?.lastModified,
      totalBytes: arr.reduce((s, f) => s + f.size, 0),
    });
  }
  accounts.sort((a, b) => a.org.localeCompare(b.org));
  return accounts;
}

/** Files for a single org, newest first. */
export async function filesForOrg(env: Env, org: string): Promise<AccountFile[]> {
  const files = await listSourceFiles(env);
  return files
    .filter((f) => orgFromKey(f.key) === org)
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
}
