# Speech-to-Text (STT)

## Supported Providers

| Provider | Features |
|----------|----------|
| `groq-whisper` | Groq Whisper Large V3, batch mode, high quality |
| `deepgram` | Deepgram Nova-3, streaming + batch, low latency |

## Configuration

```bash
# Groq Whisper (default)
STT_PROVIDER=groq-whisper

# Deepgram
STT_PROVIDER=deepgram
DEEPGRAM_API_KEY=your_key_here
DEEPGRAM_STT_MODEL=nova-3
DEEPGRAM_STT_LANGUAGE=en-US
```

## Provider Details

### Groq Whisper
- **Model:** Whisper Large V3
- **Mode:** Batch processing
- **Quality:** High
- **Latency:** Moderate

### Deepgram Nova-3
- **Model:** Nova-3
- **Mode:** Streaming + batch
- **Quality:** High
- **Latency:** Low (streaming)
- **Features:** Real-time streaming, language detection