/**
 * Audio Utilities
 * 
 * Audio processing utilities for session handling.
 */

import { stripMarkdown } from '../../lib/text-utils';
import type { SessionProviders } from '../SessionManager';
import type { SessionData } from '../types';
import { selectVoiceForLanguageChange } from '../../lib/voice-selector';
import { getEventSystem, EventCategory } from '../../events';

/**
 * Map voice names to provider-specific voice names
 */
export function mapVoiceToProvider(voice: string | undefined, providerName: string): string | undefined {
  // Always pass through the provided voice string verbatim.
  // Provider-specific validation will surface any invalid voice errors upstream.
  return voice;
}

/**
 * Detect language from text using FRANC and update session state if needed
 * 
 * This function ensures that the proper language is used for TTS by:
 * 1. Detecting the language of the text using FRANC (via LanguageDetectionService)
 * 2. Comparing with the current session language
 * 3. If they don't match, updating the session language state and switching voice
 * 
 * @param text - Text to detect language from
 * @param sessionData - Session data containing language state and configuration
 * @param currentLanguage - Current language code (ISO 639-1)
 * @param minTextLength - Minimum text length for detection (default: 3)
 * @returns Updated language code (ISO 639-1) to use for TTS
 * 
 * @example
 * ```typescript
 * const language = await ensureLanguageForTTS(
 *   "Bonjour tout le monde!",
 *   sessionData,
 *   sessionData.language?.current || 'en'
 * );
 * // If text is French and current is English, switches to French and returns 'fr'
 * ```
 */
export async function ensureLanguageForTTS(
  text: string,
  sessionData: SessionData,
  currentLanguage: string | null,
  minTextLength: number = 3
): Promise<string> {
  // Skip detection if text is too short
  if (!text || text.trim().length < minTextLength) {
    return currentLanguage || 'en';
  }

  // Skip if language detection service is not available
  if (!sessionData.languageDetectionService) {
    return currentLanguage || 'en';
  }

  try {
    // Detect language from text using FRANC
    const detectionResult = sessionData.languageDetectionService.detectLanguageFromText(
      text,
      minTextLength
    );

    if (!detectionResult) {
      // Detection failed, use current language
      return currentLanguage || 'en';
    }

    const detectedLanguage = detectionResult.languageCode.toLowerCase();
    const normalizedCurrentLanguage = (currentLanguage || 'en').toLowerCase();

    // If detected language matches current language, no change needed
    if (detectedLanguage === normalizedCurrentLanguage) {
      getEventSystem().debug(EventCategory.TTS,
        `🌍 [TTS Language Check] Language matches: ${detectedLanguage} (no change needed)`);
      return detectedLanguage;
    }

    // Language mismatch detected - update session state
    getEventSystem().info(EventCategory.TTS,
      `🌍 [TTS Language Check] Language mismatch detected: current=${normalizedCurrentLanguage}, detected=${detectedLanguage}. Updating session language.`);

    // Initialize language state if not present
    if (!sessionData.language) {
      sessionData.language = {
        current: null,
        detected: null,
        configured: null,
        detectionEnabled: false,
      };
    }

    // Update language state
    const previousLanguage = sessionData.language.current;
    sessionData.language.current = detectedLanguage;
    sessionData.language.detected = detectedLanguage;

    // Update language detection service
    if (sessionData.languageDetectionService) {
      sessionData.languageDetectionService.setConfiguredLanguage(detectedLanguage);
    }

    // Select appropriate voice for the new language
    const initialVoice = sessionData.initialVoice || sessionData.config?.voice;
    const currentVoice = sessionData.config?.voice;
    const languageVoiceMap = sessionData.languageVoiceMap;
    const lastVoicePerLanguage = sessionData.lastVoicePerLanguage;

    const ttsProvider = sessionData.runtimeConfig?.providers?.tts?.provider;
    const newVoice = selectVoiceForLanguageChange(
      detectedLanguage,
      initialVoice,
      initialVoice || currentVoice || 'Ashley', // Fallback to configured/current voice or default
      currentVoice,
      languageVoiceMap,
      lastVoicePerLanguage,
      ttsProvider
    );

    // Track this voice as the last used voice for this language
    if (!sessionData.lastVoicePerLanguage) {
      sessionData.lastVoicePerLanguage = {};
    }
    sessionData.lastVoicePerLanguage[detectedLanguage] = newVoice;

    // Update voice in session config
    if (sessionData.config && newVoice !== currentVoice) {
      sessionData.config.voice = newVoice;
      getEventSystem().info(EventCategory.TTS,
        `🎤 [TTS Language Check] Voice changed for language switch: ${currentVoice || 'none'} → ${newVoice} (${detectedLanguage})`);
    } else if (sessionData.config) {
      getEventSystem().info(EventCategory.TTS,
        `🎤 [TTS Language Check] Voice unchanged: ${newVoice} (already appropriate for ${detectedLanguage})`);
    }

    getEventSystem().info(EventCategory.TTS,
      `✅ [TTS Language Check] Language updated: ${previousLanguage || 'none'} → ${detectedLanguage}`);

    return detectedLanguage;
  } catch (error) {
    // If detection fails, log error and use current language
    getEventSystem().error(EventCategory.TTS,
      `❌ [TTS Language Check] Error detecting language: ${error instanceof Error ? error.message : String(error)}. Using current language: ${currentLanguage || 'en'}`);
    return currentLanguage || 'en';
  }
}

/**
 * Synthesize text to audio chunks using configured TTS provider
 */
export async function synthesizeTextWithProvider(
  providers: SessionProviders,
  text: string,
  voice?: string,
  speakingRate?: number,
  traceId?: string,
  sessionId?: string,
  sessionKey?: string,
  connectionParadigm?: string,
  language?: string // ISO 639-1 language code
): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  
  // Strip markdown symbols before TTS synthesis to prevent TTS from speaking them
  // (e.g., asterisks are spoken as "asterisk" which disrupts the flow)
  const cleanedText = stripMarkdown(text);

  if (!cleanedText || cleanedText.trim().length === 0) {
    getEventSystem().debug(
      EventCategory.TTS,
      '⏭️ [TTS] Skipping synthesis for empty cleaned text'
    );
    return chunks;
  }
  
  // Map voice name to provider-specific voice
  const mappedVoice = mapVoiceToProvider(voice, providers.tts.name);
  
  // Build TTS options with analytics tracking
  const ttsOptions: any = {
    voice: mappedVoice,
    speakingRate,
    language, // Pass language for multilingual TTS
    traceId, // Pass trace ID for agent analytics
    sessionId,
    sessionKey,
    connectionParadigm,
  };
  
  // Use streaming synthesis if available
  if (providers.tts.type === 'streaming') {
    for await (const chunk of providers.tts.synthesizeStream(cleanedText, ttsOptions)) {
      chunks.push(chunk);
    }
  } else {
    // Batch synthesis - split into chunks for streaming
    const audio = await providers.tts.synthesize(cleanedText, ttsOptions);
    
    // Split into 16KB chunks for streaming (optimized for WebSocket efficiency)
    // Larger chunks reduce message count by 75% compared to 4KB chunks
    const chunkSize = 16384; // 16KB (was 4KB)
    for (let i = 0; i < audio.length; i += chunkSize) {
      chunks.push(audio.slice(i, i + chunkSize));
    }
  }
  
  return chunks;
}
