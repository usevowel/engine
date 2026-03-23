/**
 * Acknowledgement Response Service
 * 
 * Generates and sends indirect responses (like "okay", "let me check on that") 
 * when the AI takes more than a threshold time to respond. Uses R2 to cache 
 * TTS audio for these responses to avoid regenerating them constantly.
 * 
 * This service improves perceived responsiveness by giving users immediate 
 * feedback that their request is being processed, especially during long 
 * tool executions or LLM processing.
 */

import { ServerWebSocket } from 'bun';
import type { SessionData } from '../../session/types';
import { sendAudioDelta, sendContentPartAdded, sendAudioDone } from '../../session/utils/event-sender';
import { generateItemId } from '../../lib/protocol';
import { getEventSystem, EventCategory } from '../../events';
import { synthesizeTextWithProvider } from '../../session/utils/audio-utils';
import type { SessionProviders } from '../../session/SessionManager';

/**
 * Configuration for acknowledgement responses
 */
export interface AcknowledgementConfig {
  /** Enable acknowledgement responses (default: true) */
  enabled: boolean;
  /** Delay in milliseconds before sending acknowledgement (default: 300) */
  delayMs: number;
  /** List of acknowledgement phrases to use (rotated) */
  phrases: string[];
  /** Voice to use for acknowledgements (defaults to session voice) */
  voice?: string;
  /** Speaking rate for acknowledgements (defaults to session speaking rate) */
  speakingRate?: number;
  /** R2 bucket for caching audio (optional) */
  r2Bucket?: R2Bucket;
}

/**
 * Cached audio data
 */
interface CachedAudio {
  audio: Uint8Array;
  voice: string;
  speakingRate?: number;
}

/**
 * Acknowledgement Response Service
 * 
 * Monitors response latency and sends pre-generated acknowledgement audio
 * when responses take longer than the threshold.
 */
export class AcknowledgementResponseService {
  private config: AcknowledgementConfig;
  private currentPhraseIndex = 0;
  private activeTimeout: Timer | null = null;
  private acknowledgementSent = false;
  private acknowledgementResponseId: string | null = null;
  private acknowledgementItemId: string | null = null;
  /** Track the last phrase that was actually sent to avoid immediate repetition */
  private lastUsedPhrase: string | null = null;

  constructor(config: Partial<AcknowledgementConfig> = {}) {
    // Default phrases with variety to avoid repetition
    const defaultPhrases = [
      'okay',
      'give me a moment',
      'working on that',
      'let me check',
      'one second',
    ];

    this.config = {
      enabled: config.enabled ?? true,
      delayMs: config.delayMs ?? 300,
      phrases: config.phrases && config.phrases.length > 0 
        ? config.phrases 
        : defaultPhrases,
      voice: config.voice,
      speakingRate: config.speakingRate,
      r2Bucket: config.r2Bucket,
    };

    // Ensure we have at least 2 phrases to avoid repetition
    if (this.config.phrases.length < 2) {
      getEventSystem().warn(EventCategory.SESSION, '⚠️  [AcknowledgementService] Only one phrase provided, adding defaults', {
        providedPhrases: this.config.phrases,
      });
      // Add default phrases if only one was provided
      const uniquePhrases = new Set([...this.config.phrases, ...defaultPhrases]);
      this.config.phrases = Array.from(uniquePhrases);
    }

    getEventSystem().info(EventCategory.SESSION, '🔔 [AcknowledgementService] Initialized', {
      enabled: this.config.enabled,
      delayMs: this.config.delayMs,
      phraseCount: this.config.phrases.length,
      phrases: this.config.phrases,
    });
  }

  /**
   * Start monitoring for a response
   * If response takes longer than delayMs, sends acknowledgement
   */
  async startMonitoring(
    ws: ServerWebSocket<SessionData>,
    responseId: string,
    providers: SessionProviders,
    voice?: string,
    speakingRate?: number
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Reset state
    this.acknowledgementSent = false;
    this.acknowledgementResponseId = null;
    this.acknowledgementItemId = null;

    // Clear any existing timeout
    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = null;
    }

    // Set timeout to send acknowledgement
    this.activeTimeout = setTimeout(async () => {
      if (!this.acknowledgementSent) {
        await this.sendAcknowledgement(ws, responseId, providers, voice, speakingRate);
      }
    }, this.config.delayMs);

    getEventSystem().debug(EventCategory.SESSION, '⏱️  [AcknowledgementService] Started monitoring', {
      responseId,
      delayMs: this.config.delayMs,
    });
  }

  /**
   * Stop monitoring (called when actual response starts)
   * Also resets the last used phrase so we can use it again after AI speaks
   */
  stopMonitoring(): void {
    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = null;
    }
    
    // Reset last used phrase when AI starts speaking
    // This allows us to use "okay" again after the AI finishes speaking
    if (this.lastUsedPhrase !== null) {
      getEventSystem().debug(EventCategory.SESSION, '🔄 [AcknowledgementService] Resetting last used phrase', {
        previousPhrase: this.lastUsedPhrase,
      });
      this.lastUsedPhrase = null;
    }
    
    getEventSystem().debug(EventCategory.SESSION, '⏹️  [AcknowledgementService] Stopped monitoring');
  }

  /**
   * Check if acknowledgement was sent
   */
  wasAcknowledgementSent(): boolean {
    return this.acknowledgementSent;
  }

  /**
   * Get acknowledgement response/item IDs (for cleanup if needed)
   */
  getAcknowledgementIds(): { responseId: string | null; itemId: string | null } {
    return {
      responseId: this.acknowledgementResponseId,
      itemId: this.acknowledgementItemId,
    };
  }

  /**
   * Callback to notify when acknowledgement is sent (for typing sounds)
   */
  private onAcknowledgementSentCallback?: (responseId: string) => void;

  /**
   * Set callback for when acknowledgement is sent
   */
  setOnAcknowledgementSent(callback: (responseId: string) => void): void {
    this.onAcknowledgementSentCallback = callback;
  }

  /**
   * Send acknowledgement audio to client
   */
  private async sendAcknowledgement(
    ws: ServerWebSocket<SessionData>,
    responseId: string,
    providers: SessionProviders,
    voice?: string,
    speakingRate?: number
  ): Promise<void> {
    if (this.acknowledgementSent) {
      return; // Already sent
    }

    this.acknowledgementSent = true;
    this.acknowledgementResponseId = responseId;

    // Get phrase (avoid repeating the last used phrase)
    let phrase: string;
    const availablePhrases = this.config.phrases.filter(p => p !== this.lastUsedPhrase);
    
    if (availablePhrases.length === 0) {
      // Fallback: if all phrases were the same as last used, just rotate
      phrase = this.config.phrases[this.currentPhraseIndex % this.config.phrases.length];
      this.currentPhraseIndex++;
      getEventSystem().warn(EventCategory.SESSION, '⚠️  [AcknowledgementService] All phrases match last used, rotating anyway', {
        phrase,
        lastUsedPhrase: this.lastUsedPhrase,
      });
    } else {
      // Pick randomly from available phrases (excluding last used)
      const randomIndex = Math.floor(Math.random() * availablePhrases.length);
      phrase = availablePhrases[randomIndex];
      getEventSystem().debug(EventCategory.SESSION, '🔔 [AcknowledgementService] Selected phrase avoiding repetition', {
        phrase,
        lastUsedPhrase: this.lastUsedPhrase,
        availablePhrases,
      });
    }

    // Track this phrase as the last used
    this.lastUsedPhrase = phrase;

    // Use provided voice/speakingRate or fall back to config defaults
    const acknowledgementVoice = voice || this.config.voice || 'Ashley';
    const acknowledgementSpeakingRate = speakingRate ?? this.config.speakingRate;

    getEventSystem().info(EventCategory.SESSION, '🔔 [AcknowledgementService] Sending acknowledgement', {
      phrase,
      voice: acknowledgementVoice,
      speakingRate: acknowledgementSpeakingRate,
    });

    try {
      // Get or generate cached audio
      const audio = await this.getOrGenerateAudio(
        phrase,
        acknowledgementVoice,
        acknowledgementSpeakingRate,
        providers
      );

      // Create item for acknowledgement
      const itemId = generateItemId();
      this.acknowledgementItemId = itemId;

      // Send content part for audio
      sendContentPartAdded(ws, responseId, itemId, 0, 1, { type: 'audio', transcript: phrase });

      // Send audio chunks
      // Split into 16KB chunks for streaming (same as main response)
      const chunkSize = 16384;
      for (let i = 0; i < audio.length; i += chunkSize) {
        const chunk = audio.slice(i, i + chunkSize);
        sendAudioDelta(ws, responseId, itemId, chunk);
      }

      // Send audio done
      sendAudioDone(ws, responseId, itemId);

      getEventSystem().info(EventCategory.SESSION, '✅ [AcknowledgementService] Acknowledgement sent', {
        phrase,
        audioSize: audio.length,
      });

      // Notify callback (for typing sounds to start)
      if (this.onAcknowledgementSentCallback) {
        this.onAcknowledgementSentCallback(responseId);
      }
    } catch (error) {
      getEventSystem().error(
        EventCategory.SESSION,
        '❌ [AcknowledgementService] Failed to send acknowledgement',
        error instanceof Error ? error : new Error(String(error)),
        { phrase }
      );
    }
  }

  /**
   * Get cached audio from R2 or generate new audio
   */
  private async getOrGenerateAudio(
    phrase: string,
    voice: string,
    speakingRate: number | undefined,
    providers: SessionProviders
  ): Promise<Uint8Array> {
    // Create cache key
    const cacheKey = this.getCacheKey(phrase, voice, speakingRate);

    // Try to get from R2 cache if available
    if (this.config.r2Bucket) {
      try {
        const cached = await this.config.r2Bucket.get(cacheKey);
        if (cached) {
          const audio = new Uint8Array(await cached.arrayBuffer());
          getEventSystem().debug(EventCategory.SESSION, '💾 [AcknowledgementService] Cache hit', {
            cacheKey,
            audioSize: audio.length,
          });
          return audio;
        }
      } catch (error) {
        getEventSystem().warn(EventCategory.SESSION, '⚠️  [AcknowledgementService] Cache read failed', {
          cacheKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Generate new audio via TTS
    getEventSystem().debug(EventCategory.SESSION, '🎤 [AcknowledgementService] Generating audio', {
      phrase,
      voice,
      speakingRate,
    });

    const chunks = await synthesizeTextWithProvider(
      providers,
      phrase,
      voice,
      speakingRate,
      undefined, // traceId (acknowledgements don't need analytics)
      undefined, // sessionId
      undefined, // sessionKey
      'direct' // connectionParadigm
    );

    // Concatenate chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const audio = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }

    // Cache in R2 if available
    if (this.config.r2Bucket) {
      try {
        await this.config.r2Bucket.put(cacheKey, audio, {
          httpMetadata: {
            contentType: 'audio/pcm',
          },
        });
        getEventSystem().debug(EventCategory.SESSION, '💾 [AcknowledgementService] Cached audio', {
          cacheKey,
          audioSize: audio.length,
        });
      } catch (error) {
        getEventSystem().warn(EventCategory.SESSION, '⚠️  [AcknowledgementService] Cache write failed', {
          cacheKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return audio;
  }

  /**
   * Generate cache key for R2
   */
  private getCacheKey(phrase: string, voice: string, speakingRate: number | undefined): string {
    // Create deterministic key
    const key = `ack/${voice}/${speakingRate ?? 'default'}/${phrase}`;
    // Sanitize for R2 (no special chars)
    return key.replace(/[^a-zA-Z0-9/_-]/g, '_');
  }
}
