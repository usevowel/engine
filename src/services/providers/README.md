# Provider System

This directory contains the shared provider abstractions and factories.
Concrete public/shared provider implementations now live in `engine/packages/provider-*`.
Hosted-only provider implementations live in `engine-hosted/packages/provider-*`.

## Structure

```
providers/
├── index.ts                  # Main exports
├── ProviderFactory.ts        # Workers-compatible provider factory
├── ProviderFactoryNode.ts    # Node/Bun provider factory (Silero/ONNX only)
├── base/                     # Base classes
│   ├── BaseSTTProvider.ts
│   ├── BaseTTSProvider.ts
│   └── BaseVADProvider.ts
├── llm/                      # LLM provider helpers
│   ├── index.ts
│   ├── provider-registry.ts
│   └── reasoning-effort.ts
└── README.md
```

## Concrete Provider Packages

- `packages/provider-groq-whisper-stt`
- `engine-hosted/packages/provider-fennec-stt`
- `engine-hosted/packages/provider-assemblyai-stt`
- `packages/provider-mistral-voxtral-realtime-stt`
- `engine-hosted/packages/provider-inworld-tts`
- `engine-hosted/packages/provider-fennec-vad`
- `packages/provider-silero-vad`

## Usage

### Using the Factory

```typescript
import { ProviderFactory } from './services/providers';

// Create all providers based on configuration
const { stt, tts, vad } = await ProviderFactory.createAll(providerConfig, runtimeConfig);

// Use providers
const transcript = await stt.transcribe(audioBuffer);
const audio = await tts.synthesize(text);
if (vad) {
  const event = await vad.detectSpeech(audioChunk, timestamp);
}
```

### Using Individual Providers

```typescript
import { GroqWhisperSTT } from './services/providers';

const stt = new GroqWhisperSTT();
await stt.initialize();

const result = await stt.transcribe(audioBuffer);
console.log(result.text);
```

`SileroVADProvider` is intentionally not exported from `src/services/providers` because it is Node/Bun-only. Use `ProviderFactoryNode` when the runtime needs Silero support.

## Provider Interfaces

### ISTTProvider

```typescript
interface ISTTProvider {
  readonly name: string;
  readonly type: 'streaming' | 'batch';
  
  initialize(): Promise<void>;
  transcribe(audioBuffer: Uint8Array, options?: STTTranscribeOptions): Promise<STTResult>;
  startStream(callbacks: STTStreamCallbacks): Promise<STTStreamingSession>;
  isReady(): boolean;
  dispose(): Promise<void>;
  getCapabilities(): ProviderCapabilities;
}
```

### ITTSProvider

```typescript
interface ITTSProvider {
  readonly name: string;
  readonly type: 'streaming' | 'batch';
  
  initialize(): Promise<void>;
  synthesize(text: string, options?: TTSSynthesizeOptions): Promise<Uint8Array>;
  synthesizeStream(text: string, options?: TTSSynthesizeOptions): AsyncIterableIterator<Uint8Array>;
  getSampleRate(): number;
  getAvailableVoices(): Promise<string[]>;
  isReady(): boolean;
  dispose(): Promise<void>;
  getCapabilities(): ProviderCapabilities;
}
```

### IVADProvider

```typescript
interface IVADProvider {
  readonly name: string;
  readonly mode: 'local' | 'remote' | 'integrated';
  
  initialize(): Promise<void>;
  detectSpeech(audioChunk: Float32Array, timestampMs: number): Promise<VADEvent | null>;
  getState(): VADState;
  resetState(): Promise<void>;
  updateConfig(config: Partial<VADConfig>): void;
  isReady(): boolean;
  dispose(): Promise<void>;
  getCapabilities(): ProviderCapabilities;
}
```

## Implementing a New Provider

### 1. Create Provider Class

```typescript
import { BaseSTTProvider } from '../base/BaseSTTProvider';
import { STTResult, ProviderCapabilities } from '../../../types/providers';

export class MySTTProvider extends BaseSTTProvider {
  readonly name = 'my-stt';
  readonly type = 'batch' as const;

  async initialize(): Promise<void> {
    // Initialize provider
    this.initialized = true;
  }

  async transcribe(audioBuffer: Uint8Array): Promise<STTResult> {
    this.ensureInitialized();
    // Implement transcription
    return { text: 'transcribed text' };
  }

  async startStream() {
    throw new Error('Streaming not supported');
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,
      supportsVAD: false,
      supportsLanguageDetection: true,
      supportsMultipleVoices: false,
      requiresNetwork: true,
      supportsGPU: false,
    };
  }
}
```

### 2. Add to Factory

```typescript
// In ProviderFactory.ts
case 'my-stt':
  return new MySTTProvider(config.mySTT.apiKey);
```

### 3. Add Configuration

```typescript
// In src/config/providers.ts
const MySTTConfig = z.object({
  apiKey: z.string().min(1),
});
```

### 4. Package and Export

```typescript
// In packages/provider-my-stt/src/index.ts
export { MySTTProvider } from './MySTTProvider';
```

## Provider Capabilities

Each provider reports its capabilities:

```typescript
{
  supportsStreaming: boolean;      // Can stream results in real-time
  supportsVAD: boolean;            // Has integrated VAD
  supportsLanguageDetection: boolean; // Can detect language
  supportsMultipleVoices: boolean; // Supports multiple voices
  requiresNetwork: boolean;        // Requires internet connection
  supportsGPU: boolean;           // Can use GPU acceleration
}
```

## Error Handling

Providers use custom error types:

```typescript
import { ProviderError, ProviderInitError, ProviderNetworkError } from '../../types/providers';

throw new ProviderInitError('my-stt', 'Failed to initialize');
throw new ProviderNetworkError('my-stt', 'Connection failed');
```

## Testing

Test providers individually:

```typescript
const provider = new GroqWhisperSTT();
await provider.initialize();

// Test transcription
const result = await provider.transcribe(testAudio);
expect(result.text).toBeTruthy();

// Test capabilities
const caps = provider.getCapabilities();
expect(caps.supportsStreaming).toBe(false);

// Cleanup
await provider.dispose();
```

## Best Practices

1. **Always call `initialize()`** before using a provider
2. **Check `isReady()`** before operations
3. **Call `dispose()`** when done to free resources
4. **Use `ensureInitialized()`** in methods to validate state
5. **Handle errors gracefully** with try-catch
6. **Report accurate capabilities** for client negotiation
7. **Support both batch and streaming** when possible
8. **Validate configuration** in constructor
9. **Log important events** for debugging
10. **Document provider-specific quirks**

## Performance Tips

- **Reuse provider instances** across sessions
- **Initialize providers at startup** to avoid cold starts
- **Use streaming** for lower latency
- **Batch small requests** to reduce overhead
- **Cache results** when appropriate
- **Monitor resource usage** (memory, CPU, GPU)
- **Implement timeouts** for network operations
- **Use connection pooling** for HTTP providers

## Debugging

Enable debug logging:

```typescript
// In provider code
console.log(`🔧 [${this.name}] Initializing...`);
console.log(`✅ [${this.name}] Ready`);
console.error(`❌ [${this.name}] Error:`, error);
```

Check provider state:

```typescript
console.log('Provider ready:', provider.isReady());
console.log('Capabilities:', provider.getCapabilities());
if (provider instanceof BaseVADProvider) {
  console.log('VAD state:', provider.getState());
}
```
