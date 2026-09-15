# Opt-Out Manager

Cloudflare Worker that manages opt-out records, gated behind Google auth
(restricted to `@coefficient.org` accounts) and syncing to a client S3 bucket.

## Stack

- **Cloudflare Workers** + **TypeScript**
- **Hono** for routing + middleware
- **Google OAuth** (hosted-domain restricted to `coefficient.org`)
- **aws4fetch** for SigV4-signed S3 access (push/pull to client bucket)
- Domain: `optouts.coefficient.org`

## Setup

```bash
npm install
```

### Secrets (never committed)

Set via Wrangler for production:

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put SESSION_SECRET        # long random string
wrangler secret put AWS_ACCESS_KEY_ID
wrangler secret put AWS_SECRET_ACCESS_KEY
```

For local dev, copy `.dev.vars.example` to `.dev.vars` and fill in.

### Vars (wrangler.toml)

- `GOOGLE_HOSTED_DOMAIN` = `coefficient.org`
- `S3_REGION`, `S3_BUCKET` — set to the client bucket.

### Google OAuth client

Create an OAuth 2.0 Web client in Google Cloud Console:
- Authorized redirect URI: `https://optouts.coefficient.org/auth/callback`
- (and `http://localhost:8787/auth/callback` for local dev)

## Develop

```bash
npm run dev        # wrangler dev at http://localhost:8787
npm run typecheck
```

## Deploy

```bash
npm run deploy
```

## Routes

- `GET /health` — public health check
- `GET /auth/login` — start Google OAuth
- `GET /auth/callback` — OAuth callback
- `GET /auth/logout`
- `GET /` — dashboard (auth required)
- `GET /api/optouts` — list opt-out records from S3
- `GET /api/optouts/:key` — pull one record
- `PUT /api/optouts/:key` — push one record
