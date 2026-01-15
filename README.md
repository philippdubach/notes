# Notes

A minimal notes/blog application built on Cloudflare Workers and KV storage. Features Markdown support, admin authentication, and server-side rendering.

## Features

- Server-side rendered notes with Markdown support
- Admin dashboard for creating, editing, and deleting notes
- Session-based authentication with secure cookies
- XSS protection via HTML sanitization
- Security headers (CSP, X-Frame-Options, etc.)

## Prerequisites

- Node.js 18+
- Cloudflare account
- Wrangler CLI

## Setup

1. Clone and install dependencies:

```bash
git clone https://github.com/your-username/notes.git
cd notes
npm install
```

2. Copy the example config files:

```bash
cp wrangler.jsonc.example wrangler.jsonc
cp .dev.vars.example .dev.vars
```

3. Create a KV namespace:

```bash
npx wrangler kv namespace create NOTES_KV
```

4. Update `wrangler.jsonc` with your KV namespace ID from the output above.

5. Edit `.dev.vars` with your local admin password.

6. Set the production admin password:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

## Development

```bash
npm run dev
```

The app runs at `http://localhost:8787`. Access admin at `/admin/login`.

## Deployment

```bash
npm run deploy
```

To use a custom domain, add routes to your `wrangler.jsonc`:

```jsonc
"routes": [
  {
    "pattern": "notes.yourdomain.com",
    "custom_domain": true
  }
]
```

## Project Structure

```
src/
  index.ts      - Route handling and main logic
  auth.ts       - Session management and security
  db.ts         - KV storage operations
  templates.ts  - HTML templates
  types.ts      - TypeScript types
test/
  index.spec.ts - Security and integration tests
```

## Testing

```bash
npm test
```

## License

MIT
