# Quick Start Guide

Get up and running with sndbrd in 5 minutes.

## Prerequisites

Before you begin, ensure you have:

- Node.js 18+ or Bun 1.0+
- A Cloudflare account (for deployment)
- API keys for LLM provider (Groq or OpenRouter)

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/sndbrd.git
cd sndbrd

# Install dependencies
bun install
```

## Configuration

Create a `.env` file in the root directory:

```bash
# Required
API_KEY="your-server-api-key"
JWT_SECRET="your-secure-random-min-32-chars"

# LLM Provider (choose one)
GROQ_API_KEY="gsk_..."  # for Groq
# OR
OPENROUTER_API_KEY="sk-or-v1-..."  # for OpenRouter
```

## Validate Setup

```bash
bun run setup
```

This validates your environment configuration and reports any issues.

## Start Development Server

```bash
bun run dev
```

The server starts on `http://localhost:8787`.

## Test the Connection

```bash
# Generate a test token
curl -X POST http://localhost:8787/v1/realtime/sessions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"moonshotai/kimi-k2-instruct-0905","voice":"Ashley"}'
```

## What's Next?

- Read the [Architecture Overview](/architecture/overview) to understand the system
- Check [API Reference](/api/websocket) for integration details
- Explore [Connection Paradigms](/architecture/connection-paradigms) for advanced patterns
- See [Tutorials](/tutorials/voice-agent) for example implementations

## Troubleshooting

### Port Already in Use

If you see "Port 8787 is in use", run:

```bash
# Find and kill the process
lsof -ti:8787 | xargs kill -9

# Or use a different port
PORT=3001 bun run dev
```

### API Key Invalid

Ensure your API key has the correct format:
- `ek_` prefix for ephemeral tokens
- `vkey_` prefix for API keys

### Audio Not Streaming

Check your audio format:
- Sample rate: 24,000 Hz
- Format: PCM16
- Channels: Mono (1)
