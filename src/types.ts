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
  // Secret - shared bearer token so an external scheduler (GitHub Actions cron)
  // can trigger a run without a Google login.
  CRON_SECRET?: string;

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
}

export interface SessionUser {
  email: string;
  name: string;
  picture?: string;
  hd?: string;
  exp: number;
}
