import { AwsClient } from 'aws4fetch';
import type { Env, BucketCreds } from './types';

/**
 * Opt-out sync buckets.
 *
 * Data flow:
 *   - PULL from  datadash-p2p            (vendors push opt-outs here for our client)
 *   - PUSH to    datadash-bigdogstrategies  AND  datadash-creativedirect
 *
 * Each bucket has its own IAM key pair, stored as a JSON-encoded BucketCreds
 * Worker secret. This module resolves those secrets into signed S3 clients.
 */

export type SyncRole = 'source' | 'bigdog' | 'creativedirect';

function parseCreds(raw: string | undefined, name: string, fallbackRegion: string): BucketCreds {
  if (!raw) throw new Error(`Missing S3 secret: ${name}`);
  let c: BucketCreds;
  try {
    c = JSON.parse(raw) as BucketCreds;
  } catch {
    throw new Error(`Invalid JSON in S3 secret: ${name}`);
  }
  if (!c.bucket || !c.accessKeyId || !c.secretAccessKey) {
    throw new Error(`Incomplete BucketCreds in secret: ${name}`);
  }
  c.region = c.region || fallbackRegion;
  return c;
}

export function bucketFor(env: Env, role: SyncRole): BucketCreds {
  const region = env.S3_REGION || 'us-east-1';
  switch (role) {
    case 'source':
      return parseCreds(env.S3_SOURCE_P2P, 'S3_SOURCE_P2P', region);
    case 'bigdog':
      return parseCreds(env.S3_DEST_BIGDOG, 'S3_DEST_BIGDOG', region);
    case 'creativedirect':
      return parseCreds(env.S3_DEST_CREATIVEDIRECT, 'S3_DEST_CREATIVEDIRECT', region);
  }
}

/** All PUSH destinations we fan opt-outs out to. */
export const PUSH_DESTINATIONS: SyncRole[] = ['bigdog', 'creativedirect'];

function client(c: BucketCreds): AwsClient {
  return new AwsClient({
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    region: c.region,
    service: 's3',
  });
}

function objectUrl(c: BucketCreds, key: string): string {
  return `https://${c.bucket}.s3.${c.region}.amazonaws.com/${encodeURIComponent(key)}`;
}

export async function getObject(env: Env, role: SyncRole, key: string): Promise<Response> {
  const c = bucketFor(env, role);
  return client(c).fetch(objectUrl(c, key), { method: 'GET' });
}

export async function putObject(
  env: Env,
  role: SyncRole,
  key: string,
  body: string | ArrayBuffer,
  contentType = 'application/json',
): Promise<Response> {
  const c = bucketFor(env, role);
  return client(c).fetch(objectUrl(c, key), {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
}

export async function listObjects(env: Env, role: SyncRole, prefix = ''): Promise<Response> {
  const c = bucketFor(env, role);
  const url = `https://${c.bucket}.s3.${c.region}.amazonaws.com/?list-type=2&prefix=${encodeURIComponent(prefix)}`;
  return client(c).fetch(url, { method: 'GET' });
}

/**
 * Fan-out push: write the same object to every PUSH destination.
 * Returns per-destination result status.
 */
export async function pushToAll(
  env: Env,
  key: string,
  body: string | ArrayBuffer,
  contentType = 'application/json',
): Promise<{ role: SyncRole; ok: boolean; status: number }[]> {
  const results = await Promise.all(
    PUSH_DESTINATIONS.map(async (role) => {
      const res = await putObject(env, role, key, body, contentType);
      return { role, ok: res.ok, status: res.status };
    }),
  );
  return results;
}
