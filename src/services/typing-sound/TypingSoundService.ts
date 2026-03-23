/**
 * Typing Sound Service
 * 
 * Plays randomized typing/clicking sound segments to simulate real typing behavior.
 * These filler sounds start playing immediately after the acknowledgement 
 * response and continue until the AI's actual response begins.
 * 
 * Instead of continuous looping, this plays randomized segments of randomized
 * duration with randomized pauses between them, simulating natural typing patterns.
 * 
 * This service improves perceived responsiveness by eliminating dead air
 * during long processing times, especially during tool executions.
 */

import { ServerWebSocket } from 'bun';
import type { SessionData } from '../../session/types';
import { sendAudioDelta, sendContentPartAdded, sendAudioDone } from '../../session/utils/event-sender';
import { generateItemId } from '../../lib/protocol';
import { getEventSystem, EventCategory } from '../../events';

/**
 * Configuration for typing sounds
 */
export interface TypingSoundConfig {
  /** Enable typing sounds (default: false) */
  enabled: boolean;
  /** Typing sound audio data (PCM16, 24kHz, mono) */
  soundData: Uint8Array | null;
  /** Click sound audio data (PCM16, 24kHz, mono) - optional */
  clickSoundData?: Uint8Array | null;
  /** Duration of one loop in milliseconds (used to calculate sound duration) */
  loopDurationMs: number;
  /** Volume multiplier (0.0 to 1.0, default: 0.3 for subtle background) */
  volume: number;
  /** Minimum segment duration in milliseconds (default: 200ms) */
  minSegmentDurationMs?: number;
  /** Maximum segment duration in milliseconds (default: 800ms) */
  maxSegmentDurationMs?: number;
  /** Minimum pause duration in milliseconds (default: 300ms) */
  minPauseDurationMs?: number;
  /** Maximum pause duration in milliseconds (default: 1500ms) */
  maxPauseDurationMs?: number;
  /** Probability of playing click sound instead of typing (0.0 to 1.0, default: 0.15 = 15%) */
  clickSoundProbability?: number;
}

/**
 * Typing Sound Service
 * 
 * Manages looping typing sounds that play during AI processing.
 */
export class TypingSoundService {
  private config: Required<TypingSoundConfig>;
  private isPlaying = false;
  private activeTimeout: Timer | null = null;
  private typingResponseId: string | null = null;
  private typingItemId: string | null = null;
  private ws: ServerWebSocket<SessionData> | null = null;
  private soundDurationMs: number = 0; // Calculated from sound data
  private clickSoundDurationMs: number = 0; // Calculated from click sound data

  constructor(config: Partial<TypingSoundConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? false,
      soundData: config.soundData ?? null,
      clickSoundData: config.clickSoundData ?? null,
      loopDurationMs: config.loopDurationMs ?? 2000, // 2 seconds default
      volume: config.volume ?? 0.3, // 30% volume for subtle background
      minSegmentDurationMs: config.minSegmentDurationMs ?? 200, // 200ms minimum
      maxSegmentDurationMs: config.maxSegmentDurationMs ?? 800, // 800ms maximum
      minPauseDurationMs: config.minPauseDurationMs ?? 300, // 300ms minimum pause
      maxPauseDurationMs: config.maxPauseDurationMs ?? 1500, // 1.5s maximum pause
      clickSoundProbability: config.clickSoundProbability ?? 0.15, // 15% chance of click
    };

    // Calculate sound duration from sound data (PCM16, 24kHz, mono = 2 bytes per sample)
    if (this.config.soundData) {
      const samples = this.config.soundData.length / 2;
      const sampleRate = 24000; // 24kHz
      this.soundDurationMs = (samples / sampleRate) * 1000;
    }

    // Calculate click sound duration
    if (this.config.clickSoundData) {
      const samples = this.config.clickSoundData.length / 2;
      const sampleRate = 24000; // 24kHz
      this.clickSoundDurationMs = (samples / sampleRate) * 1000;
    }

    getEventSystem().info(EventCategory.SESSION, '⌨️  [TypingSoundService] Initialized', {
      enabled: this.config.enabled,
      hasSoundData: this.config.soundData !== null,
      hasClickSoundData: this.config.clickSoundData !== null,
      soundDurationMs: this.soundDurationMs,
      clickSoundDurationMs: this.clickSoundDurationMs,
      loopDurationMs: this.config.loopDurationMs,
      volume: this.config.volume,
      minSegmentDurationMs: this.config.minSegmentDurationMs,
      maxSegmentDurationMs: this.config.maxSegmentDurationMs,
      minPauseDurationMs: this.config.minPauseDurationMs,
      maxPauseDurationMs: this.config.maxPauseDurationMs,
      clickSoundProbability: this.config.clickSoundProbability,
    });
  }

  /**
   * Start playing typing sounds
   * Should be called immediately after acknowledgement response
   */
  startPlaying(
    ws: ServerWebSocket<SessionData>,
    responseId: string
  ): void {
    // Need at least typing sound or click sound to play
    if (!this.config.enabled || (!this.config.soundData && !this.config.clickSoundData)) {
      return;
    }

    if (this.isPlaying) {
      // Already playing, just update response ID
      this.typingResponseId = responseId;
      return;
    }

    this.ws = ws;
    this.typingResponseId = responseId;
    this.isPlaying = true;

    // Create item for typing sound
    const itemId = generateItemId();
    this.typingItemId = itemId;

    // Send content part for audio
    sendContentPartAdded(ws, responseId, itemId, 0, 2, { 
      type: 'audio', 
      transcript: '' // Typing sounds have no transcript
    });

    getEventSystem().info(EventCategory.SESSION, '⌨️  [TypingSoundService] Starting typing sounds', {
      responseId,
      itemId,
    });

    // Start playing randomized segments
    this.playRandomSegment();
  }

  /**
   * Stop playing typing sounds
   * Should be called when actual AI response starts
   */
  stopPlaying(): void {
    if (!this.isPlaying) {
      return;
    }

    this.isPlaying = false;

    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = null;
    }

    // Send audio done if we have active connection
    if (this.ws && this.typingResponseId && this.typingItemId) {
      sendAudioDone(this.ws, this.typingResponseId, this.typingItemId, 0, 2);
    }

    getEventSystem().info(EventCategory.SESSION, '⏹️  [TypingSoundService] Stopped typing sounds', {
      responseId: this.typingResponseId,
    });

    // Reset state
    this.ws = null;
    this.typingResponseId = null;
    this.typingItemId = null;
  }

  /**
   * Check if currently playing
   */
  isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Play randomized typing sound segments
   * Simulates natural typing patterns with random segments and pauses
   * Randomly intersperses click sounds to simulate mouse clicks or checking things
   */
  private playRandomSegment(): void {
    if (!this.ws || !this.typingResponseId || !this.typingItemId || !this.isPlaying) {
      return;
    }

    // Decide whether to play typing sound or click sound
    // Only consider click if we have both sounds, otherwise use what's available
    const hasBothSounds = this.config.soundData && this.config.clickSoundData;
    const useClickSound = hasBothSounds && 
                         Math.random() < this.config.clickSoundProbability;
    
    let segmentData: Uint8Array;
    
    if (useClickSound && this.config.clickSoundData) {
      // Play full click sound (clicks are short, play them completely)
      segmentData = this.config.clickSoundData;
      
      getEventSystem().debug(EventCategory.SESSION, '🖱️  [TypingSoundService] Playing click sound');
    } else if (this.config.soundData) {
      // Play random typing segment
      // Generate random segment duration
      const segmentDurationMs = this.randomBetween(
        this.config.minSegmentDurationMs,
        this.config.maxSegmentDurationMs
      );

      // Calculate how many bytes correspond to this duration
      // PCM16, 24kHz, mono = 2 bytes per sample, 24000 samples per second
      const bytesPerMs = (24000 * 2) / 1000; // 48 bytes per millisecond
      const segmentBytes = Math.floor(segmentDurationMs * bytesPerMs);
      
      // CRITICAL: Round to even byte boundary (PCM16 samples are 2 bytes)
      // This prevents cutting in the middle of a sample which causes distortion
      const segmentBytesAligned = Math.floor(segmentBytes / 2) * 2;
      
      // Ensure we don't exceed sound data length
      const maxSegmentBytes = Math.min(segmentBytesAligned, this.config.soundData.length);
      
      // Generate random start position (allow starting anywhere in the sound)
      // CRITICAL: Start position must also be aligned to sample boundaries (even bytes)
      const maxStartPosition = Math.max(0, this.config.soundData.length - maxSegmentBytes);
      const startPositionAligned = Math.floor(Math.random() * Math.floor(maxStartPosition / 2)) * 2;
      const endPosition = startPositionAligned + maxSegmentBytes;

      // Extract segment at aligned boundaries
      segmentData = this.config.soundData.slice(startPositionAligned, endPosition);
      
      // Apply fade-in and fade-out to prevent clicks/pops at segment boundaries
      segmentData = this.applyFadeInOut(segmentData, 50); // 50ms fade
    } else if (this.config.clickSoundData) {
      // Only click sound available, use it
      segmentData = this.config.clickSoundData;
      getEventSystem().debug(EventCategory.SESSION, '🖱️  [TypingSoundService] Playing click sound (only sound available)');
    } else {
      // No sound data available
      return;
    }

    // Apply volume adjustment if needed
    if (this.config.volume !== 1.0) {
      segmentData = this.adjustVolume(segmentData, this.config.volume);
    }

    // Send audio chunks (split into 16KB chunks for transmission)
    const chunkSize = 16384;
    for (let i = 0; i < segmentData.length; i += chunkSize) {
      if (!this.isPlaying) {
        return; // Stop if interrupted
      }
      const chunk = segmentData.slice(i, i + chunkSize);
      sendAudioDelta(this.ws, this.typingResponseId, this.typingItemId, chunk, 0, 2);
    }

    // Schedule next segment (either another segment or a pause)
    if (this.isPlaying) {
      // If we just played a click, shorter pause (clicks are quick actions)
      if (useClickSound) {
        const clickPauseMs = this.randomBetween(100, 400);
        this.activeTimeout = setTimeout(() => {
          if (this.isPlaying) {
            this.playRandomSegment();
          }
        }, clickPauseMs);
      } else {
        // Randomly decide: pause or continue immediately (70% chance of pause)
        const shouldPause = Math.random() > 0.3;
        
        if (shouldPause) {
          // Random pause duration
          const pauseDurationMs = this.randomBetween(
            this.config.minPauseDurationMs,
            this.config.maxPauseDurationMs
          );
          
          this.activeTimeout = setTimeout(() => {
            if (this.isPlaying) {
              this.playRandomSegment();
            }
          }, pauseDurationMs);
        } else {
          // Continue immediately (short pause, like rapid typing)
          const shortPauseMs = this.randomBetween(50, 200);
          this.activeTimeout = setTimeout(() => {
            if (this.isPlaying) {
              this.playRandomSegment();
            }
          }, shortPauseMs);
        }
      }
    }
  }

  /**
   * Generate random number between min and max (inclusive)
   */
  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Apply fade-in and fade-out to audio segment to prevent clicks/pops
   * @param audio PCM16 audio data (must be aligned to sample boundaries)
   * @param fadeMs Fade duration in milliseconds
   * @returns Audio with fade applied
   */
  private applyFadeInOut(audio: Uint8Array, fadeMs: number): Uint8Array {
    // Convert to Int16Array for easier manipulation
    const int16Array = new Int16Array(audio.buffer, audio.byteOffset, audio.length / 2);
    const faded = new Int16Array(int16Array.length);
    
    // Calculate fade samples (PCM16, 24kHz = 24000 samples per second)
    const fadeSamples = Math.floor((fadeMs / 1000) * 24000);
    const fadeLength = Math.min(fadeSamples, Math.floor(int16Array.length / 2));
    
    // Apply fade-in (first fadeLength samples)
    for (let i = 0; i < fadeLength; i++) {
      const fadeFactor = i / fadeLength; // 0.0 to 1.0
      faded[i] = Math.round(int16Array[i] * fadeFactor);
    }
    
    // Copy middle section without fade
    for (let i = fadeLength; i < int16Array.length - fadeLength; i++) {
      faded[i] = int16Array[i];
    }
    
    // Apply fade-out (last fadeLength samples)
    for (let i = 0; i < fadeLength; i++) {
      const fadeIndex = int16Array.length - fadeLength + i;
      const fadeFactor = 1.0 - (i / fadeLength); // 1.0 to 0.0
      faded[fadeIndex] = Math.round(int16Array[fadeIndex] * fadeFactor);
    }
    
    // Convert back to Uint8Array
    return new Uint8Array(faded.buffer);
  }

  /**
   * Adjust audio volume
   * PCM16 format: 16-bit signed integers (-32768 to 32767)
   */
  private adjustVolume(audio: Uint8Array, volume: number): Uint8Array {
    // Convert to Int16Array for easier manipulation
    const int16Array = new Int16Array(audio.buffer, audio.byteOffset, audio.length / 2);
    const adjusted = new Int16Array(int16Array.length);

    for (let i = 0; i < int16Array.length; i++) {
      adjusted[i] = Math.round(int16Array[i] * volume);
    }

    // Convert back to Uint8Array
    return new Uint8Array(adjusted.buffer);
  }

  /**
   * Load typing sound from R2 or URL
   */
  static async loadSoundFromR2(r2Bucket: R2Bucket, key: string): Promise<Uint8Array | null> {
    try {
      const object = await r2Bucket.get(key);
      if (!object) {
        return null;
      }
      return new Uint8Array(await object.arrayBuffer());
    } catch (error) {
      getEventSystem().error(
        EventCategory.SESSION,
        '❌ [TypingSoundService] Failed to load sound from R2',
        error instanceof Error ? error : new Error(String(error)),
        { key }
      );
      return null;
    }
  }

  /**
   * Load typing sound from URL (for initial setup)
   */
  static async loadSoundFromUrl(url: string): Promise<Uint8Array | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      getEventSystem().error(
        EventCategory.SESSION,
        '❌ [TypingSoundService] Failed to load sound from URL',
        error instanceof Error ? error : new Error(String(error)),
        { url }
      );
      return null;
    }
  }
}
