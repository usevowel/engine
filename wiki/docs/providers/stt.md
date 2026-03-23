# Speech-to-Text (STT)

## Supported Providers

| Provider | Features |
|----------|----------|
| `groq-whisper` | Groq Whisper Large V3, batch mode, high quality |
| `fennec` | Fennec ASR, streaming, integrated VAD |
| `assemblyai` | AssemblyAI, streaming, integrated VAD, advanced features |

## Configuration

```bash
STT_PROVIDER=groq-whisper
```

## Provider Details

### Groq Whisper
- **Model:** Whisper Large V3
- **Mode:** Batch processing
- **Quality:** High
- **Latency:** Moderate

### Fennec ASR
- **Mode:** Streaming with integrated VAD
- **Best for:** Real-time applications
- **Latency:** Low

### AssemblyAI
- **Mode:** Streaming with integrated VAD
- **Features:** Speaker detection, punctuation, custom vocabulary
- **Latency:** Low to moderate
