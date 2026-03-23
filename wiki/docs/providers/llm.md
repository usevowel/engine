# LLM (Language Model)

## Supported Providers

| Provider | Models |
|----------|--------|
| `groq` | Moonshot Kimi K2, Llama variants |
| `openrouter` | Claude, GPT-4, Llama, 100+ models |

## Configuration

### Groq (Default)
```bash
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...
GROQ_MODEL=moonshotai/kimi-k2-instruct-0905
```

### OpenRouter
```bash
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=anthropic/claude-3-5-sonnet
```

## Model Recommendations

### Groq Models
- `moonshotai/kimi-k2-instruct-0905` - Fast, high quality
- `meta-llama/llama-4-scout-17b-16e-instruct` - Open source

### OpenRouter Models
- `anthropic/claude-3-5-sonnet` - Balanced performance
- `openai/gpt-4o` - High capability
- `meta-llama/llama-3.1-405b-instruct` - Open source
