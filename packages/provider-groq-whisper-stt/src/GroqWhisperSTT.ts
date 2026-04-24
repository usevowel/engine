/**
 * Groq Whisper STT Provider
 * 
 * Batch-mode transcription using Groq's Whisper API.
 * Does not support streaming or integrated VAD.
 */

import { BaseSTTProvider } from '../../../src/services/providers/base/BaseSTTProvider';
import {
  STTResult,
  STTTranscribeOptions,
  STTStreamCallbacks,
  STTStreamingSession,
  ProviderCapabilities,
} from '../../../src/types/providers';
import { transcribeAudio } from '../../../src/services/transcription';

import { getEventSystem, EventCategory } from '../../../src/events';

interface GroqWhisperConfig {
  apiKey: string;
  model?: string;
  whisperModel?: string;
}

export class GroqWhisperSTT extends BaseSTTProvider {
  readonly name = 'groq-whisper';
  readonly type = 'batch' as const;
  
  private apiKey: string;
  private config: GroqWhisperConfig;

  constructor(apiKey?: string, config?: Partial<GroqWhisperConfig>) {
    super();
    // Use provided API key/config, or fall back to global config (for Bun environments)
    if (apiKey || config?.apiKey) {
      this.apiKey = apiKey || config!.apiKey!;
      this.config = {
        apiKey: this.apiKey,
        model: config?.model,
        whisperModel: config?.whisperModel || 'whisper-large-v3',
      };
    } else {
      // Fallback to global config for Bun environments
      try {
        const { config: globalConfig } = require('../../../src/config/env');
        this.apiKey = globalConfig?.groq?.apiKey || '';
        this.config = {
          apiKey: this.apiKey,
          model: globalConfig?.groq?.model,
          whisperModel: globalConfig?.groq?.whisperModel || 'whisper-large-v3',
        };
      } catch {
        // Workers environment - API key must be provided
        this.apiKey = '';
        this.config = {
          apiKey: '',
          whisperModel: 'whisper-large-v3',
        };
      }
    }
  }

  async initialize(): Promise<void> {
    // Validate API key
    if (!this.apiKey) {
      throw new Error('Groq API key not configured');
    }
    
    getEventSystem().info(EventCategory.STT, '✅ Groq Whisper STT initialized');
    this.initialized = true;
  }

  async transcribe(
    audioBuffer: Uint8Array,
    options?: STTTranscribeOptions
  ): Promise<STTResult> {
    this.ensureInitialized();
    
    // Reuse existing transcription logic with provider-specific config
    const result = await transcribeAudio(
      audioBuffer,
      options?.language,
      this.apiKey,
      this.config.whisperModel,
      options?.sampleRate ?? 24000,
    );
    
    return {
      text: result.text,
      language: result.language,
      duration: result.duration,
    };
  }

  async startStream(callbacks: STTStreamCallbacks, _tokenTurnDetection?: any, _languageDetectionEnabled?: boolean): Promise<STTStreamingSession> {
    throw new Error('Groq Whisper does not support streaming transcription');
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,
      supportsVAD: false,
      supportsLanguageDetection: true,
      supportsMultipleVoices: false,
      requiresNetwork: true,
      supportsGPU: true, // Cloud-based
    };
  }
}
