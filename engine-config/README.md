# Engine Configuration (R2)

YAML configuration for the sndbrd engine. Stored in R2 at `sndbrd-store/config/{environment}.yaml`.

## Structure

- `config/{environment}.yaml` in R2 bucket `sndbrd-store`
- Environments: `testing`, `dev`, `staging`, `production`, `billing-test`

## Billing

- **billing.enabled:** `false` = disable billing (same as TEST_MODE). `true` or omitted = enabled.
- **Meter name:** `voice_hours` (matches fixtures `meters[].name`)

## Secrets & Runtime Overrides

- **secrets:** API keys (GROQ, OpenRouter, Cerebras, AssemblyAI, Inworld, Fennec, Polar, PostHog). Env vars override YAML.
- **runtime:** Any env var override (TEST_MODE, STT_PROVIDER, etc.)
- **settings.agent:** Agent config (useModularAgents, defaultType, maxSteps, etc.)

## Pushing to R2

From the sndbrd engine root:

```bash
# Push all environments
bun run engine-config:push

# Push specific environment(s)
bun run engine-config:push testing dev staging production billing-test
```

Or from the engine-config directory:

```bash
cd engine-config
bun run scripts/push-to-r2.ts
```

**Prerequisites:**

- **S3 API mode:** Set `R2_ACCESS_KEY`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` in `.dev.vars`
- **Wrangler mode:** `bunx wrangler login` and `account_id` in wrangler.toml (or `CLOUDFLARE_ACCOUNT_ID`)

Or manually:

```bash
wrangler r2 object put sndbrd-store/config/production.yaml \
  --file=./engine-config/production.yaml \
  --content-type=text/yaml
```

## Config Format

Each YAML file contains:

1. **presets** – Provider stacks (LLM + TTS + STT) with billing metadata
2. **settings** – Engine runtime settings (VAD, turn detection, call limits, agent, etc.)
3. **billing** – Billing tiers, token conversion, Polar meter config. `billing.enabled: false` disables billing (same as TEST_MODE).

Hosted `platform` should consume preset metadata from this R2-backed source or a cache derived from it, while hosted token issuance should pass preset identifiers and let the engine resolve the provider/model/voice stack.

See [config-refactor plan](../../../.ai/plans/sndbrd-v2.0/config-refactor/README.md) for full schema.

## Fallback

When R2 config is unavailable, the engine uses env vars and `DEFAULT_BILLING_CONFIG` from `billing-config-loader.ts`.
