import { AwsClient } from 'aws4fetch';
import type { Env } from './types';

/**
 * Thin S3 client for pushing/pulling opt-out data to a client bucket.
 * Uses aws4fetch for SigV4 signing (Workers-compatible, no Node deps).
 */
export function s3Client(env: Env): AwsClient {
  return new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: env.S3_REGION,
    service: 's3',
  });
}

function endpoint(env: Env, key: string): string {
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET not configured');
  // Virtual-hosted-style URL
  return `https://${bucket}.s3.${env.S3_REGION}.amazonaws.com/${encodeURIComponent(key)}`;
}

export async function getObject(env: Env, key: string): Promise<Response> {
  const client = s3Client(env);
  return client.fetch(endpoint(env, key), { method: 'GET' });
}

export async function putObject(
  env: Env,
  key: string,
  body: string | ArrayBuffer,
  contentType = 'application/json',
): Promise<Response> {
  const client = s3Client(env);
  return client.fetch(endpoint(env, key), {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
}

export async function listObjects(env: Env, prefix = ''): Promise<Response> {
  const client = s3Client(env);
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET not configured');
  const url = `https://${bucket}.s3.${env.S3_REGION}.amazonaws.com/?list-type=2&prefix=${encodeURIComponent(prefix)}`;
  return client.fetch(url, { method: 'GET' });
}
