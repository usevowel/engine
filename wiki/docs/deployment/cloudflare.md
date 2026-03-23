# Cloudflare Workers Deployment

## Prerequisites

- Cloudflare account
- Wrangler CLI installed
- API keys for providers

## Setup

```bash
# Install Wrangler
bun install -g wrangler

# Login to Cloudflare
wrangler login

# Set required secrets
wrangler secret put API_KEY --env production
wrangler secret put JWT_SECRET --env production
wrangler secret put GROQ_API_KEY --env production
```

## Deployment Commands

```bash
# Build the worker
bun run build

# Deploy to production
bun run deploy:production

# View logs
bun run tail:production
```

## Configuration

Update `wrangler.toml` for production:

```toml
[env.production]
name = "sndbrd-production"

[vars]
NODE_ENV = "production"
```

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Configure secure `JWT_SECRET` (32+ chars)
- [ ] Set production API keys via `wrangler secret put`
- [ ] Configure custom domain (optional)
- [ ] Set up monitoring via Cloudflare Dashboard
