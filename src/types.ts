export interface BucketCreds {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface Env {
  // Vars
  GOOGLE_HOSTED_DOMAIN: string;
  S3_REGION: string;
  APP_ENV?: string;
  APP_URL?: string; // base URL for email links (cron has no request origin)
  ALLOW_S3_WRITES?: string; // 'true' enables real writes to client S3 buckets
  DRIVE_ROOT_FOLDER?: string;
  DRIVE_FOLDER_BIGDOG?: string;
  DRIVE_FOLDER_CREATIVEDIRECT?: string;

  // Secrets - Google
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  GOOGLE_SA_KEY: string; // service account JSON (for Drive writes)

  // Secret - ReadyGOP proxy (full URL incl. ?api_key=...). READ ONLY pulls.
  RGOP_PROXY_URL: string;
  // co/nnect (txt.coefficient.org) opt-out export. READ ONLY pull.
  //   CONNECT_API_URL: export endpoint (var). Defaults to the known export.csv.
  //   CONNECT_API_TOKEN: Bearer token (secret). If unset, the co/nnect pull is
  //   skipped (non-fatal) and the run proceeds with ReadyGOP only.
  CONNECT_API_URL?: string;
  CONNECT_API_TOKEN?: string;
  // Secret - shared bearer token so an external scheduler (GitHub Actions cron)
  // can trigger a run without a Google login.
  CRON_SECRET?: string;

  // L2 voter-file API (early-vote scrub). READ ONLY pulls.
  //   L2_API_KEY: the api key (secret). If unset, the early-vote scrub is
  //   disabled (the toggle still shows but a run reports it as unavailable).
  //   L2_CUSTOMER_ID: customer id (var, default '1QEP').
  //   L2_API_BASE: base URL (var, default 'https://api.l2datamapping.com/api/v2').
  //   L2_APP: application to pull (var, default 'VM_US', the national app
  //   filtered per state).
  L2_API_KEY?: string;
  L2_CUSTOMER_ID?: string;
  L2_API_BASE?: string;
  L2_APP?: string;
  // Comma-separated USPS codes to refresh in the daily early-vote pull.
  EV_STATES?: string;

  // Secrets - S3 sync targets (JSON-encoded BucketCreds each)
  // Source we PULL vendor opt-outs from:
  S3_SOURCE_P2P: string;
  // Destinations we PUSH opt-outs to:
  S3_DEST_BIGDOG: string;
  S3_DEST_CREATIVEDIRECT: string;

  // Optional bindings
  SESSIONS?: KVNamespace;
  // Project -> (pac, destination) mapping overrides (human-assigned).
  OPTOUT_MAPPING?: KVNamespace;
  // Early-vote cache: daily already-voted phone sets per state (R2).
  EV_CACHE?: R2Bucket;
}

export interface SessionUser {
  email: string;
  name: string;
  picture?: string;
  hd?: string;
  exp: number;
}
