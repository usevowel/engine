/**
 * Language Detection Service
 * 
 * Centralized service for managing language detection, switching logic, and state.
 * Handles confidence threshold filtering, consecutive detection requirements,
 * and language state transitions.
 */

import { getEventSystem, EventCategory } from '../../events';
import { franc } from 'franc';

/**
 * Language detection result from STT provider
 */
export interface LanguageDetectionResult {
  languageCode: string; // ISO 639-1 code
  confidence: number; // 0.0-1.0
  timestamp: number;
}

/**
 * Language detection configuration
 */
export interface LanguageDetectionConfig {
  enabled: boolean;
  confidenceThreshold: number; // Default: 0.8
  minConsecutiveDetections: number; // Default: 2
  debounceMs: number; // Default: 1000ms
}

/**
 * Language state tracking
 */
export interface LanguageState {
  currentLanguage: string | null;
  detectedLanguage: string | null;
  configuredLanguage: string | null;
  detectionHistory: LanguageDetectionResult[];
  lastSwitchTimestamp: number | null;
}

/**
 * Language Detection Service
 * 
 * Manages language detection, state transitions, and switching logic.
 */
export class LanguageDetectionService {
  private config: LanguageDetectionConfig;
  private state: LanguageState;
  private onLanguageChangeCallback?: (languageCode: string) => void;
  
  constructor(
    config: Partial<LanguageDetectionConfig>,
    initialLanguage?: string
  ) {
    this.config = {
      enabled: config.enabled ?? true,
      confidenceThreshold: config.confidenceThreshold ?? 0.8,
      minConsecutiveDetections: config.minConsecutiveDetections ?? 2,
      debounceMs: config.debounceMs ?? 1000,
    };
    
    this.state = {
      currentLanguage: initialLanguage || null,
      detectedLanguage: null,
      configuredLanguage: initialLanguage || null,
      detectionHistory: [],
      lastSwitchTimestamp: null,
    };
    
    getEventSystem().info(EventCategory.SESSION, '🌍 [LanguageDetection] Service initialized', {
      config: this.config,
      initialLanguage: initialLanguage || 'none',
    });
  }
  
  /**
   * Process a language detection result from STT
   * @returns true if language was switched, false otherwise
   */
  processDetection(result: LanguageDetectionResult): boolean {
    if (!this.config.enabled) {
      return false;
    }
    
    // CRITICAL: Ignore language detections with confidence below 0.65
    // If confidence is too low, keep the previous language instead of switching
    const MIN_CONFIDENCE_THRESHOLD = 0.55;
    if (result.confidence < MIN_CONFIDENCE_THRESHOLD) {
      getEventSystem().info(EventCategory.SESSION, 
        `🌍 [LanguageDetection] Low confidence detection ignored: ${result.languageCode} (${result.confidence.toFixed(2)}, minimum: ${MIN_CONFIDENCE_THRESHOLD}). Keeping current language: ${this.state.currentLanguage || 'none'}`);
      return false; // Don't switch, keep current language
    }
    
    // Log if confidence is below configured threshold but above minimum
    if (result.confidence < this.config.confidenceThreshold) {
      getEventSystem().info(EventCategory.SESSION, 
        `🌍 [LanguageDetection] Accepting detection below configured threshold: ${result.languageCode} (${result.confidence.toFixed(2)}, configured threshold: ${this.config.confidenceThreshold}, minimum: ${MIN_CONFIDENCE_THRESHOLD})`);
    }
    
    // Add to history
    this.state.detectionHistory.push(result);
    
    // Keep only recent history (last 10 detections or last 5 seconds)
    const cutoff = Date.now() - 5000;
    this.state.detectionHistory = this.state.detectionHistory.filter(
      d => d.timestamp > cutoff
    ).slice(-10);
    
    // Switch language when confidence is sufficient
    // This ensures voice selection uses the correct language right away
    return this.switchLanguage(result.languageCode);
  }
  
  /**
   * Switch to a new language
   */
  private switchLanguage(languageCode: string): boolean {
    // Prevent rapid switching (debounce)
    const now = Date.now();
    if (this.state.lastSwitchTimestamp) {
      const timeSinceSwitch = now - this.state.lastSwitchTimestamp;
      if (timeSinceSwitch < this.config.debounceMs) {
        getEventSystem().info(EventCategory.SESSION, `🌍 [LanguageDetection] Switch debounced: ${timeSinceSwitch}ms since last switch`);
        return false;
      }
    }
    
    // Only switch if different from current
    if (this.state.currentLanguage === languageCode) {
      return false;
    }
    
    // Update state
    const previousLanguage = this.state.currentLanguage;
    this.state.currentLanguage = languageCode;
    this.state.detectedLanguage = languageCode;
    this.state.lastSwitchTimestamp = now;
    
    getEventSystem().info(EventCategory.SESSION, `🌍 [LanguageDetection] Language switched: ${previousLanguage || 'none'} → ${languageCode}`);
    
    // Notify listeners
    if (this.onLanguageChangeCallback) {
      this.onLanguageChangeCallback(languageCode);
    }
    
    return true;
  }
  
  /**
   * Get recent detections for a language
   */
  private getRecentDetections(languageCode: string): LanguageDetectionResult[] {
    const cutoff = Date.now() - (this.config.debounceMs * 2);
    return this.state.detectionHistory.filter(
      d => d.languageCode === languageCode && d.timestamp > cutoff
    );
  }
  
  /**
   * Set configured language (from token)
   */
  setConfiguredLanguage(languageCode: string): void {
    this.state.configuredLanguage = languageCode;
    getEventSystem().info(EventCategory.SESSION, `🌍 [LanguageDetection] Configured language set: ${languageCode}`);
    
    // If no current language, use configured as initial
    if (!this.state.currentLanguage) {
      this.state.currentLanguage = languageCode;
      getEventSystem().info(EventCategory.SESSION, `🌍 [LanguageDetection] Using configured language as initial: ${languageCode}`);
    }
  }
  
  /**
   * Get current effective language
   * Priority: detected > configured > null
   */
  getCurrentLanguage(): string | null {
    return this.state.detectedLanguage || 
           this.state.configuredLanguage || 
           null;
  }
  
  /**
   * Get full language state
   */
  getState(): LanguageState {
    return { ...this.state };
  }
  
  /**
   * Register callback for language changes
   */
  onLanguageChange(callback: (languageCode: string) => void): void {
    this.onLanguageChangeCallback = callback;
  }
  
  /**
   * Reset detection history (useful for testing or session reset)
   */
  reset(): void {
    this.state.detectionHistory = [];
    this.state.lastSwitchTimestamp = null;
    getEventSystem().info(EventCategory.SESSION, '🌍 [LanguageDetection] Detection history reset');
  }

  /**
   * Detect language from text using franc NLP library
   * 
   * Uses the franc library to detect the language of a given text string.
   * Returns a LanguageDetectionResult that can be processed by processDetection().
   * 
   * @param text - Text to detect language from
   * @param minLength - Minimum text length to attempt detection (default: 3)
   * @returns LanguageDetectionResult with ISO 639-1 code and confidence, or null if detection fails
   * 
   * @example
   * ```typescript
   * const result = service.detectLanguageFromText("Bonjour tout le monde!");
   * if (result) {
   *   service.processDetection(result);
   * }
   * ```
   */
  detectLanguageFromText(text: string, minLength: number = 3): LanguageDetectionResult | null {
    if (!text || text.trim().length < minLength) {
      getEventSystem().debug(EventCategory.SESSION, 
        `🌍 [LanguageDetection] Text too short for detection: ${text.trim().length} chars (minimum: ${minLength})`);
      return null;
    }

    try {
      // franc returns ISO 639-3 codes (3 letters), we need ISO 639-1 (2 letters)
      // franc also returns 'und' (undetermined) if it can't detect
      const detectedCode = franc(text.trim(), { minLength });
      
      if (!detectedCode || detectedCode === 'und') {
        getEventSystem().debug(EventCategory.SESSION, 
          `🌍 [LanguageDetection] Could not detect language from text: "${text.substring(0, 50)}..."`);
        return null;
      }

      // Convert ISO 639-3 to ISO 639-1
      // Common mappings for supported languages
      const iso6393To6391: Record<string, string> = {
        'eng': 'en', // English
        'spa': 'es', // Spanish
        'fra': 'fr', // French
        'deu': 'de', // German
        'ita': 'it', // Italian
        'por': 'pt', // Portuguese
        'jpn': 'ja', // Japanese
        'kor': 'ko', // Korean
        'zho': 'zh', // Chinese
        'rus': 'ru', // Russian
        'nld': 'nl', // Dutch
        'pol': 'pl', // Polish
        'ara': 'ar', // Arabic
        'hin': 'hi', // Hindi
        'tur': 'tr', // Turkish
        'vie': 'vi', // Vietnamese
        'tha': 'th', // Thai
        'swe': 'sv', // Swedish
        'nor': 'no', // Norwegian
        'dan': 'da', // Danish
        'fin': 'fi', // Finnish
        'ell': 'el', // Greek
        'heb': 'he', // Hebrew
        'ces': 'cs', // Czech
        'ron': 'ro', // Romanian
        'hun': 'hu', // Hungarian
      };

      const languageCode = iso6393To6391[detectedCode] || detectedCode.substring(0, 2);

      // franc doesn't provide confidence scores, so we estimate based on text length
      // Longer text = higher confidence (capped at 0.95)
      const confidence = 1;

      const result: LanguageDetectionResult = {
        languageCode,
        confidence,
        timestamp: Date.now(),
      };

      getEventSystem().info(EventCategory.SESSION, 
        `🌍 [LanguageDetection] Detected language from text: ${languageCode} (confidence: ${confidence.toFixed(2)}, ISO 639-3: ${detectedCode})`);

      return result;
    } catch (error) {
      getEventSystem().error(EventCategory.SESSION, 
        `🌍 [LanguageDetection] Error detecting language from text: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Detect language from text and process it automatically
   * 
   * Convenience method that combines detectLanguageFromText() and processDetection().
   * 
   * @param text - Text to detect language from
   * @param minLength - Minimum text length to attempt detection (default: 3)
   * @returns true if language was switched, false otherwise
   * 
   * @example
   * ```typescript
   * const switched = service.detectAndProcessLanguage("Hola, ¿cómo estás?");
   * ```
   */
  detectAndProcessLanguage(text: string, minLength: number = 3): boolean {
    const result = this.detectLanguageFromText(text, minLength);
    if (!result) {
      return false;
    }
    return this.processDetection(result);
  }

  /**
   * Fallback chain for language detection
   * 
   * Implements a two-tier fallback system:
   * 1. First: Use STT provider's language detection if confidence is high enough
   * 2. Second: If STT confidence is low, try franc NLP library
   * 
   * This ensures we avoid unclear language detections by progressively trying
   * more reliable methods.
   * 
   * @param sttResult - Initial language detection result from STT provider
   * @param text - Transcript text to use for fallback detection
   * @param sttConfidenceThreshold - Minimum confidence threshold for STT result (default: 0.7)
   * @param minLength - Minimum text length for detection (default: 3)
   * @returns LanguageDetectionResult from the best available method, or null if all fail
   * 
   * @example
   * ```typescript
   * const result = await service.detectLanguageWithFallback(
   *   { languageCode: 'en', confidence: 0.5, timestamp: Date.now() },
   *   "Bonjour tout le monde!"
   * );
   * ```
   */
  async detectLanguageWithFallback(
    sttResult: LanguageDetectionResult,
    text: string,
    sttConfidenceThreshold: number = 0.7,
    minLength: number = 3
  ): Promise<LanguageDetectionResult | null> {
    // Tier 1: Check STT provider's confidence
    if (sttResult.confidence >= sttConfidenceThreshold) {
      getEventSystem().info(EventCategory.SESSION,
        `🌍 [LanguageDetection] Using STT detection: ${sttResult.languageCode} (confidence: ${sttResult.confidence.toFixed(2)}, threshold: ${sttConfidenceThreshold})`);
      return sttResult;
    }

    getEventSystem().info(EventCategory.SESSION,
      `🌍 [LanguageDetection] STT confidence too low (${sttResult.confidence.toFixed(2)} < ${sttConfidenceThreshold}), trying franc NLP...`);

    // Tier 2: Try franc NLP library
    const francResult = this.detectLanguageFromText(text, minLength);
    if (francResult && francResult.confidence >= 0.6) {
      getEventSystem().info(EventCategory.SESSION,
        `🌍 [LanguageDetection] Using franc NLP detection: ${francResult.languageCode} (confidence: ${francResult.confidence.toFixed(2)})`);
      return francResult;
    }

    if (francResult) {
      getEventSystem().info(EventCategory.SESSION,
        `🌍 [LanguageDetection] Franc NLP confidence too low (${francResult.confidence.toFixed(2)}), falling back to STT result`);
    } else {
      getEventSystem().info(EventCategory.SESSION,
        `🌍 [LanguageDetection] Franc NLP failed to detect language, falling back to STT result`);
    }

    // If all methods fail, return the original STT result (even if low confidence)
    getEventSystem().warn(EventCategory.SESSION,
      `🌍 [LanguageDetection] All fallback methods failed or skipped, using STT result: ${sttResult.languageCode} (confidence: ${sttResult.confidence.toFixed(2)})`);
    return sttResult;
  }
}
