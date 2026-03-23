# Local Development

## Setup

```bash
# Install dependencies
bun install

# Setup and validate environment
bun run setup

# Start development server
bun run dev
```

## Local Testing

```bash
# Generate a test token
bun run test:token

# Connection test
bun run test:connection

# Browser test
bun run test:browser
```

## Cloudflare Tunnel

For testing with a public URL:

```bash
# Install cloudflared
# https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/

# Start tunnel
./scripts/start-worker-tunnel.sh
```

## Demo Application

```bash
cd demo
bun install
bun run dev
```

The demo provides a React-based UI for testing the voice engine.
