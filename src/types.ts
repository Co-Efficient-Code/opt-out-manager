export interface Env {
  // Vars
  GOOGLE_HOSTED_DOMAIN: string;
  S3_REGION: string;
  S3_BUCKET?: string;

  // Secrets
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;

  // Optional bindings
  SESSIONS?: KVNamespace;
}

export interface SessionUser {
  email: string;
  name: string;
  picture?: string;
  hd?: string;
  exp: number;
}
