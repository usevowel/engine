# Engine Configuration

YAML configuration for the vowel engine. Used for runtime presets and settings.

## Structure

- `config/{environment}.yaml` - Environment-specific configurations
- Environments: `testing`, `dev`, `staging`, `production`

## Secrets & Runtime Overrides

- **secrets:** API keys (GROQ, OpenRouter, Cerebras). Env vars override YAML.
- **runtime:** Any env var override (TEST_MODE, STT_PROVIDER, etc.)
- **settings.agent:** Agent config (useModularAgents, defaultType, maxSteps, etc.)

## Pushing Configuration

From the engine root:

```bash
# Push all environments
bun run engine-config:push

# Push specific environment(s)
bun run engine-config:push testing dev staging production
```

Or from the engine-config directory:

```bash
cd engine-config
bun run scripts/push-to-r2.ts
```

**Prerequisites:**
- Set `R2_ACCESS_KEY`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` in environment

## Config Format

Each YAML file contains:

1. **presets** - Provider stacks (LLM + TTS + STT)
2. **settings** - Engine runtime settings (VAD, turn detection, call limits, agent, etc.)

## Fallback

When external config is unavailable, the engine uses env vars.