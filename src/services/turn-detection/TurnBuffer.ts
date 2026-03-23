import { TurnDetectionService } from './TurnDetectionService';

import { getEventSystem, EventCategory } from '../../events';
/**
 * TurnBuffer - Accumulates speech transcripts and manages turn completion detection
 * 
 * This class buffers speech-to-text transcripts from streaming STT providers
 * and determines when a user's conversational turn is complete. It prevents
 * premature turn finalization by accumulating multiple transcript fragments
 * and using intelligent turn detection.
 * 
 * Key Features:
 * - Accumulates transcripts across multiple end_of_turn events
 * - Tracks speech_start and speech_end VAD events
 * - Implements forced timeout to prevent stuck turns
 * - Supports optional LLM-based turn detection (Layer 2)
 * - Provides clear logging for debugging
 */

export interface TurnBufferConfig {
  /**
   * Maximum time (ms) to wait after speech ends before forcing finalization
   * Default: 3000ms (3 seconds - natural conversation awkwardness threshold)
   */
  timeoutMs: number;
  
  /**
   * Debounce time (ms) to wait after speech_end before checking turn completion
   * Default: 150ms (allows brief pauses without premature finalization)
   * Note: Currently unused - LLM is called immediately on speech_end
   */
  debounceMs?: number;
  
  /**
   * Enable debug logging for turn buffer behavior
   * Default: false
   */
  debug?: boolean;
}

export type TurnFinalizeCallback = (text: string) => void;

/**
 * Metrics for turn detection performance (Layer 4)
 */
export interface TurnBufferMetrics {
  debounceCount: number;
  debounceCancelCount: number;
  llmCallCount: number;
  llmTrueCount: number;
  llmFalseCount: number;
  llmErrorCount: number;
  llmAccuracy: number; // Percentage of successful LLM calls
  llmErrorRate: number; // Percentage of failed LLM calls
}

/**
 * TurnBuffer manages transcript accumulation and turn completion detection
 */
export class TurnBuffer {
  private config: Required<TurnBufferConfig>;
  private onFinalize: TurnFinalizeCallback;
  private turnDetectionService: TurnDetectionService | null;
  
  // State
  private accumulatedText: string = '';
  private isSpeaking: boolean = false;
  private timeoutTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastTranscriptTime: number = 0;
  
  // Statistics (for debugging)
  private transcriptCount: number = 0;
  private turnStartTime: number = 0;
  private debounceCount: number = 0;
  private debounceCancelCount: number = 0;
  private llmCallCount: number = 0;
  private llmTrueCount: number = 0;
  private llmFalseCount: number = 0;
  private llmErrorCount: number = 0;
  
  constructor(
    config: TurnBufferConfig,
    onFinalize: TurnFinalizeCallback,
    turnDetectionService: TurnDetectionService | null = null
  ) {
    this.config = {
      timeoutMs: config.timeoutMs,
      debounceMs: config.debounceMs ?? 150,
      debug: config.debug ?? false,
    };
    this.onFinalize = onFinalize;
    this.turnDetectionService = turnDetectionService;
    
    this.log('🎯 TurnBuffer initialized', {
      timeoutMs: this.config.timeoutMs,
      debounceMs: this.config.debounceMs,
      llmEnabled: !!this.turnDetectionService,
      immediateCheck: true, // LLM called immediately on speech_end
    });
  }
  
  /**
   * Add a transcript fragment to the buffer
   * Called when STT provider sends end_of_turn event
   */
  addTranscript(text: string): void {
    if (!text || text.trim().length === 0) {
      this.log('⚠️  Ignoring empty transcript');
      return;
    }
    
    const trimmedText = text.trim();
    
    // First transcript in this turn
    if (this.accumulatedText.length === 0) {
      this.turnStartTime = Date.now();
      this.accumulatedText = trimmedText;
      this.log('🎤 Turn started', { text: trimmedText });
    } else {
      // Accumulate with space separator
      this.accumulatedText = trimmedText;
      this.log('📝 Transcript accumulated', {
        text: trimmedText,
        totalLength: this.accumulatedText.length,
      });
    }
    
    this.transcriptCount++;
    this.lastTranscriptTime = Date.now();
    
    // Reset timeout timer on new transcript
    this.resetTimeoutTimer();
  }
  
  /**
   * Called when speech starts (VAD event)
   * Cancels any pending finalization (both debounce and timeout)
   */
  onSpeechStart(): void {
    this.isSpeaking = true;
    this.log('🗣️  Speech started');
    
    // Cancel debounce if speech resumes
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
      this.debounceCancelCount++;
      this.log('⏸️  Debounce cancelled (speech resumed)', {
        debounceCancelCount: this.debounceCancelCount,
      });
    }
    
    // Cancel timeout if speech resumes
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
      this.log('⏸️  Timeout cancelled (speech resumed)');
    }
  }
  
  /**
   * Called when speech ends (VAD event)
   * If LLM is enabled: Immediately calls LLM turn detection (no debounce)
   * If LLM is disabled: Starts debounce timer before finalizing
   */
  onSpeechEnd(): void {
    this.isSpeaking = false;
    this.log('🔇 Speech ended');
    
    // Only check turn completion if we have accumulated text
    if (this.accumulatedText.length > 0) {
      if (this.turnDetectionService) {
        // LLM enabled: Call immediately (no debounce)
        this.onDebounceExpired();
      } else {
        // LLM disabled: Use simple debounce before finalizing
        this.startDebounce();
      }
    }
  }
  
  /**
   * Start debounce timer after speech_end
   * Waits for brief pause before checking turn completion
   */
  private startDebounce(): void {
    // Clear existing debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.debounceCount++;
    this.log('⏱️  Debounce timer started', {
      debounceMs: this.config.debounceMs,
      debounceCount: this.debounceCount,
    });
    
    // Start debounce timer
    this.debounceTimer = setTimeout(() => {
      this.log('⏰ Debounce expired - checking turn completion', {
        accumulatedText: this.accumulatedText,
      });
      
      // Debounce expired, now check if turn is complete
      // For Layer 1, we just start the timeout timer
      // In Layer 2, we'll call the LLM here
      this.onDebounceExpired();
    }, this.config.debounceMs);
  }
  
  /**
   * Called when debounce timer expires
   * Calls LLM to check if turn is complete (if enabled)
   * Falls back to immediate finalization if LLM is disabled
   */
  private async onDebounceExpired(): Promise<void> {
    this.debounceTimer = null;
    
    // If no LLM service, finalize immediately (simple debounce-only behavior)
    if (!this.turnDetectionService) {
      this.log('✅ No LLM service - finalizing after debounce');
      this.finalize('debounce-only');
      return;
    }
    
    // Call LLM to check if turn is complete
    try {
      this.llmCallCount++;
      this.log('🤖 Calling turn detection LLM', {
        transcript: this.accumulatedText,
        llmCallCount: this.llmCallCount,
      });
      
      const isComplete = await this.turnDetectionService.checkTurnComplete(this.accumulatedText);
      
      if (isComplete) {
        this.llmTrueCount++;
        this.log('✅ LLM says turn is COMPLETE', {
          llmTrueCount: this.llmTrueCount,
          llmFalseCount: this.llmFalseCount,
        });
        
        // Turn is complete - finalize immediately
        this.finalize('llm-complete');
      } else {
        this.llmFalseCount++;
        this.log('⏸️  LLM says turn is INCOMPLETE - waiting for more speech', {
          llmTrueCount: this.llmTrueCount,
          llmFalseCount: this.llmFalseCount,
        });
        
        // Turn is incomplete - start timeout as safety net
        // If user doesn't speak again, timeout will force finalization
        this.resetTimeoutTimer();
      }
      
    } catch (error) {
      this.llmErrorCount++;
      getEventSystem().error(EventCategory.LLM, '❌ [TurnBuffer] LLM error - falling back to timeout', error);
      this.log('⚠️  LLM error - falling back to timeout', {
        llmErrorCount: this.llmErrorCount,
      });
      
      // Fall back to timeout on LLM error
      this.resetTimeoutTimer();
    }
  }
  
  /**
   * Reset the timeout timer
   * Called after new transcript or speech_end
   */
  private resetTimeoutTimer(): void {
    // Clear existing timer
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
    }
    
    // Start new timeout
    this.timeoutTimer = setTimeout(() => {
      this.log('⏰ Timeout reached - forcing finalization', {
        timeoutMs: this.config.timeoutMs,
        accumulatedText: this.accumulatedText,
      });
      this.finalize('timeout');
    }, this.config.timeoutMs);
    
    this.log('⏱️  Timeout timer started', {
      timeoutMs: this.config.timeoutMs,
    });
  }
  
  /**
   * Finalize the current turn and call the callback
   * @param reason - Why the turn was finalized (for logging)
   */
  private finalize(reason: string): void {
    if (this.accumulatedText.length === 0) {
      this.log('⚠️  Cannot finalize - no accumulated text');
      return;
    }
    
    const finalText = this.accumulatedText;
    const duration = Date.now() - this.turnStartTime;
    
    this.log('✅ Turn finalized', {
      reason,
      text: finalText,
      transcriptCount: this.transcriptCount,
      durationMs: duration,
    });
    
    // Clear state before callback (in case callback triggers new turn)
    this.reset();
    
    // Call finalization callback
    this.onFinalize(finalText);
  }
  
  /**
   * Reset buffer state for next turn
   */
  reset(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    
    this.accumulatedText = '';
    this.isSpeaking = false;
    this.transcriptCount = 0;
    this.turnStartTime = 0;
    this.lastTranscriptTime = 0;
    this.debounceCount = 0;
    this.debounceCancelCount = 0;
    // Don't reset LLM statistics (keep across turns for debugging)
    
    this.log('🔄 Buffer reset');
  }
  
  /**
   * Get current accumulated text (for debugging)
   */
  getAccumulatedText(): string {
    return this.accumulatedText;
  }
  
  /**
   * Check if buffer is currently accumulating
   */
  isAccumulating(): boolean {
    return this.accumulatedText.length > 0;
  }
  
  /**
   * Get metrics summary (Layer 4)
   * Returns statistics about turn detection performance
   */
  getMetrics(): TurnBufferMetrics {
    return {
      debounceCount: this.debounceCount,
      debounceCancelCount: this.debounceCancelCount,
      llmCallCount: this.llmCallCount,
      llmTrueCount: this.llmTrueCount,
      llmFalseCount: this.llmFalseCount,
      llmErrorCount: this.llmErrorCount,
      llmAccuracy: this.llmCallCount > 0 
        ? ((this.llmTrueCount + this.llmFalseCount) / this.llmCallCount) * 100 
        : 0,
      llmErrorRate: this.llmCallCount > 0 
        ? (this.llmErrorCount / this.llmCallCount) * 100 
        : 0,
    };
  }
  
  /**
   * Log metrics summary
   */
  logMetrics(): void {
    const metrics = this.getMetrics();
    getEventSystem().info(EventCategory.LLM, '📊 [TurnBuffer] Metrics Summary:', {
      debounces: `${metrics.debounceCount} (${metrics.debounceCancelCount} cancelled)`,
      llmCalls: metrics.llmCallCount,
      llmDecisions: `${metrics.llmTrueCount} complete, ${metrics.llmFalseCount} incomplete`,
      llmErrors: metrics.llmErrorCount,
      llmAccuracy: `${metrics.llmAccuracy.toFixed(1)}%`,
      llmErrorRate: `${metrics.llmErrorRate.toFixed(1)}%`,
    });
  }
  
  /**
   * Log helper with optional debug mode
   */
  private log(message: string, data?: any): void {
    if (!this.config.debug) return;
    
    if (data) {
      getEventSystem().info(EventCategory.LLM, `[TurnBuffer] ${message}`, data);
    } else {
      getEventSystem().info(EventCategory.LLM, `[TurnBuffer] ${message}`);
    }
  }
}

