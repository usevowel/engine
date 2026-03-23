# Environment Variables

## Required Variables

```bash
# API Key for token issuance
API_KEY="your-server-api-key"

# JWT secret (minimum 32 characters)
JWT_SECRET="your-secure-random-string-min-32-chars"

# LLM API key (required unless TEST_MODE=true)
GROQ_API_KEY="gsk_..."
# OR
OPENROUTER_API_KEY="sk-or-v1-..."
```

## LLM Configuration

```bash
# Provider: 'groq' (default) or 'openrouter'
LLM_PROVIDER="groq"

# Groq settings
GROQ_API_KEY="gsk_..."
GROQ_MODEL="moonshotai/kimi-k2-instruct-0905"

# OpenRouter settings
OPENROUTER_API_KEY="sk-or-v1-..."
OPENROUTER_MODEL="anthropic/claude-3-5-sonnet"
OPENROUTER_SITE_URL="https://yourdomain.com"
OPENROUTER_APP_NAME="YourApp"
```

## Optional Variables

```bash
# Server
PORT="3001"
NODE_ENV="development"

# Voice
INWORLD_VOICE="Ashley"

# VAD
VAD_ENABLED="true"
VAD_THRESHOLD="0.5"
VAD_MIN_SILENCE_MS="550"
VAD_SPEECH_PAD_MS="0"

# Test Mode (never enable in production!)
TEST_MODE="false"
```
