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

## Public Access

For local testing, keep the server on `bun run dev` and point your client at `http://localhost:8787`.
If you need a public URL for a demo, use any standard reverse proxy you already have installed.

## Demo Application

```bash
cd demo
bun install
bun run dev
```

The demo provides a React-based UI for testing the voice engine.
