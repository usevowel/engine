# Troubleshooting

Solutions to common issues when working with sndbrd.

## Connection Issues

### "Port 8787 is in use"

**Cause:** Another process is using the port.

**Solutions:**
```bash
# Find and kill the process
lsof -ti:8787 | xargs kill -9

# Or use a different port
PORT=3001 bun run dev

# Or stop all bun processes
pkill -f bun
```

### "WebSocket connection failed"

**Cause:** Incorrect URL, network issues, or firewall blocking.

**Solutions:**
1. Check URL format:
   ```typescript
   // ✅ Correct
   url: 'wss://api.example.com/v1/realtime'
   
   // ❌ Incorrect
   url: 'ws://api.example.com/v1/realtime'  // Missing 's'
   ```

2. Check network connectivity:
   ```bash
   curl -I https://api.example.com/v1/health
   ```

3. Check firewall settings - Ensure port 443 (WSS) is not blocked.

### "Token expired" immediately after generation

**Cause:** System clock out of sync or token generation issue.

**Solutions:**
```bash
# Check system time (Linux/Mac)
timedatectl status

# Sync time (Linux)
sudo ntpdate pool.ntp.org

# Or check time in browser
console.log(new Date().toISOString())
```

## Audio Issues

### Microphone not working

**Cause:** Browser permission denied or no microphone device.

**Solutions:**
```typescript
// Check permissions
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    console.log('Microphone granted');
  })
  .catch(error => {
    console.error('Microphone error:', error.name);
    
    if (error.name === 'NotAllowedError') {
      alert('Please allow microphone access in your browser settings.');
      // Instructions for enabling
      window.open('chrome://settings/content/microphone', '_blank');
    } else if (error.name === 'NotFoundError') {
      alert('No microphone detected. Please connect one.');
    }
  });

// List available microphones
navigator.mediaDevices.enumerateDevices()
  .then(devices => {
    devices.forEach(device => {
      if (device.kind === 'audioinput') {
        console.log('Microphone:', device.label);
      }
    });
  });
```

### Echo in audio output

**Cause:** Audio playback and microphone are on same device.

**Solutions:**
```typescript
// Use headphones to prevent echo
// Or use audio cancellation
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,    // Software echo cancellation
    noiseSuppression: true,      // Noise reduction
    sampleRate: 24000
  }
});
```

### Choppy audio

**Cause:** VAD triggering too early or audio buffer issues.

**Solutions:**
```typescript
// Increase speech pad to prevent cutoff
const sessionConfig = {
  turn_detection: {
    type: 'server_vad',
    silence_duration_ms: 800,      // Increase from default
    threshold: 0.5,
    speech_pad_ms: 300            // Add padding
  }
};
```

## LLM Issues

### "Model not found" error

**Cause:** Specified model is not available.

**Solutions:**
```bash
# List available models
curl https://api.example.com/v1/models \
  -H "Authorization: Bearer $API_KEY"

# Use default model if unsure
# Groq: moonshotai/kimi-k2-instruct-0905
# OpenRouter: anthropic/claude-3-5-sonnet
```

### Slow responses from LLM

**Cause:** High max tokens, slow model, or network latency.

**Solutions:**
```typescript
// Reduce max tokens for faster responses
const config = {
  model: 'moonshotai/kimi-k2-instruct-0905',
  max_response_output_tokens: 128,  // Reduced
  temperature: 0.7
};

// Or use faster models
const FAST_MODELS = [
  'moonshotai/kimi-k2-instruct-0905',
  'gpt-4o-mini',
  'llama-3.1-8b-instruct'
];
```

### LLM not responding

**Cause:** API quota exceeded, invalid key, or network issue.

**Solutions:**
```typescript
// Add error handling
client.on('error', (error) => {
  if (error.code === 'QUOTA_EXCEEDED') {
    alert('API quota exceeded. Please wait for reset.');
  } else if (error.code === 'INVALID_API_KEY') {
    alert('Invalid API key. Please check configuration.');
  } else if (error.code === 'RATE_LIMIT') {
    alert('Rate limited. Please try again later.');
  } else {
    console.error('Unknown error:', error);
  }
});

// Check API key status
async function checkApiKey() {
  const response = await fetch('/api/check-key', {
    method: 'POST',
    body: JSON.stringify({ key: apiKey })
  });
  return response.json();
}
```

## TTS Issues

### No audio output

**Cause:** TTS not generating audio or playback failed.

**Solutions:**
```typescript
// Check if TTS is enabled
client.on('response.created', (response) => {
  if (response.status === 'completed' && !response.has_audio) {
    console.warn('No audio generated. Audio might be disabled.');
  }
});

// Check audio context
const audioContext = new AudioContext({ 
  sampleRate: 24000
});

// Ensure audio context is resumed after user interaction
function ensureAudioContext() {
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

// Call on user gesture
document.addEventListener('click', ensureAudioContext);
```

### TTS voice not available

**Cause:** Specified voice doesn't exist.

**Solutions:**
```bash
# Check available voices (if provider supports)
curl https://inworld.ai/api/voices \
  -H "Authorization: Bearer $INWORLD_API_KEY"

# Use default voice
INWORLD_VOICE=Ashley  # Default available voice
```

## Performance Issues

### High latency (> 1s)

**Diagnosis:** Measure each stage
```typescript
const timestamps = {
  speech_end: 0,
  transcription_complete: 0,
  llm_first_token: 0,
  tts_complete: 0,
  audio_playback: 0
};

client.on('speech_stopped', () => {
  timestamps.speech_end = Date.now();
});

client.on('transcript', () => {
  timestamps.transcription_complete = Date.now();
  console.log(`Transcription: ${timestamps.transcription_complete - timestamps.speech_end}ms`);
});

client.on('text_delta', () => {
  if (!timestamps.llm_first_token) {
    timestamps.llm_first_token = Date.now();
    console.log(`LLM TTF: ${timestamps.llm_first_token - timestamps.transcription_complete}ms`);
  }
});

client.on('response.done', () => {
  timestamps.tts_complete = Date.now();
  console.log(`TTS: ${timestamps.tts_complete - timestamps.llm_first_token}ms`);
});

// Playback timing
audioSource.onended = () => {
  timestamps.audio_playback = Date.now();
  const totalLatency = timestamps.audio_playback - timestamps.speech_end;
  console.log(`Total latency: ${totalLatency}ms`);
};
```

**Solutions for high latency:**
- Switch to streaming STT (when available)
- Use faster LLM model
- Reduce audio chunk size
- Enable WebSocket compression
- Deploy closer to users (edge)

### High CPU usage

**Cause:** Continuous audio processing or too large audio buffers.

**Solutions:**
```typescript
// Reduce audio chunk size
const SMALL_CHUNK_SIZE = 2048;  // ~85ms instead of 170ms

// Use Web Audio API instead of manual processing
const audioContext = new AudioContext({ latencyHint: 'interactive' });

// Stop processing when not needed
client.on('disconnected', () => {
  audioContext.suspend();
});
```

## Development Issues

### "wrangler command not found"

**Cause:** Wrangler CLI not installed globally.

**Solutions:**
```bash
# Install Wrangler
bun install -g wrangler

# Or use bunx
bunx wrangler --version

# Or add to devDependencies
bun add -D wrangler
```

### "TypeScript errors in Cloudflare Workers"

**Cause:** Using Node.js APIs not available in Workers.

**Solutions:**
```typescript
// ❌ NOT AVAILABLE in Workers
const fs = require('fs');

// ✅ AVAILABLE alternatives
// Use fetch instead of HTTP module
// Use KV storage instead of file system
// Use Web APIs instead of Node.js APIs
```

### Build failures

**Cause:** Missing dependencies or syntax errors.

**Solutions:**
```bash
# Clear cache and reinstall
rm -rf node_modules bun.lock
bun install

# Check TypeScript errors
bun run build -- --logLevel verbose

# Check Wrangler config
wrangler dev --dry-run
```

## Debug Mode

Enable verbose logging to troubleshoot:

```typescript
const client = new Vowel({
  url: 'wss://api.example.com/v1/realtime',
  token: sessionToken,
  debug: true,  // Enable verbose logging
  logLevel: 'debug'  // Show all events
});

// Log all events
client.on('*', (event, data) => {
  console.log(`[${event}]`, data);
});
```

## Getting Help

If you can't resolve your issue:

1. **Search existing issues:**
   https://github.com/your-org/sndbrd/issues

2. **Check documentation:**
   - [Architecture](/architecture/overview)
   - [API Reference](/api/websocket)
   - [Guides](/guides)

3. **Create a new issue:**
   Include:
   - Error message
   - Steps to reproduce
   - Environment (browser, OS, Node version)
   - Configuration used
   - Console logs

4. **Community support:**
   - [Discord](https://discord.gg) (if available)
   - [Twitter/X](https://twitter.com)

## Common Error Codes

| Code | Description | Solution |
|-------|-------------|----------|
| `ECONNREFUSED` | Server not accessible | Check URL and network |
| `ENOTFOUND` | Invalid endpoint | Verify API URL |
| `TOKEN_EXPIRED` | Token too old | Refresh token |
| `INVALID_TOKEN` | Bad token format | Regenerate token |
| `RATE_LIMIT` | Too many requests | Wait and retry |
| `MODEL_UNAVAILABLE` | Model doesn't exist | Use different model |
| `VAD_ERROR` | VAD failed | Check audio format |
| `TTS_ERROR` | TTS failed | Check voice/model |

## Related

- [Error Handling Guide](/guides/error-handling) - Comprehensive error patterns
- [Performance Guide](/guides/performance) - Optimization strategies
- [Connection Debugging](/guides/debugging) - Advanced debugging techniques
