/**
 * Language Detection Service
 * 
 * Uses Vercel AI SDK with Groq's gpt-oss-20b model to detect the intended language
 * from user transcripts. This is a non-blocking async service that sets the session
 * language so the right voice is used for TTS.
 * 
 * Replaces the setLanguage tool with automatic language detection.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { getProvider } from '../providers/llm/provider-registry';
import { getEventSystem, EventCategory } from '../../events';
import { selectVoiceForLanguageChange } from '../../lib/voice-selector';
import type { SessionData } from '../../session/types';

/**
 * Language detection result schema
 */
const LanguageDetectionSchema = z.object({
  languageCode: z.string().describe('ISO 639-1 language code (2-3 letters, e.g., "en", "es", "fr", "zh", "ja")'),
  confidence: z.number().min(0).max(1).describe('Confidence score between 0 and 1'),
  languageName: z.string().optional().describe('Full language name (e.g., "English", "Spanish")'),
});

type LanguageDetectionResult = z.infer<typeof LanguageDetectionSchema>;

/**
 * Language Detection Service
 * 
 * Detects language from user transcripts using Groq's gpt-oss-20b model
 * with structured output. Runs asynchronously and updates session language
 * for proper TTS voice selection.
 */
export class LanguageDetectionService {
  private groqApiKey: string;
  private model: string = 'openai/gpt-oss-20b';

  constructor(groqApiKey: string) {
    if (!groqApiKey) {
      throw new Error('Groq API key is required for language detection');
    }
    this.groqApiKey = groqApiKey;
  }

  /**
   * Detect language from user transcript
   * 
   * This is a non-blocking async operation that detects the language
   * and updates the session language state.
   * 
   * @param transcript - User transcript text
   * @param sessionData - Session data to update
   * @returns Promise that resolves when detection completes (doesn't block)
   */
  async detectAndSetLanguage(
    transcript: string,
    sessionData: SessionData
  ): Promise<void> {
    // Skip detection for very short transcripts
    if (!transcript || transcript.trim().length < 3) {
      return;
    }

    // Run detection asynchronously (non-blocking)
    this.detectLanguageAsync(transcript, sessionData).catch((error) => {
      getEventSystem().warn(EventCategory.SESSION,
        `⚠️  [LanguageDetection] Failed to detect language: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : new Error(String(error))
      );
    });
  }

  /**
   * Internal async language detection
   */
  private async detectLanguageAsync(
    transcript: string,
    sessionData: SessionData
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Get Groq provider
      const groqProvider = getProvider('groq', {
        apiKey: this.groqApiKey,
      });

      const model = groqProvider(this.model);

      // Build detection prompt
      const prompt = `Detect the language of the following user message. Return the ISO 639-1 language code (2-3 letters) and confidence score.

User message: "${transcript}"

Respond with the detected language code (e.g., "en" for English, "es" for Spanish, "fr" for French, "zh" for Chinese, "ja" for Japanese).`;

      // Use structured output to get language detection
      const { object: detection } = await generateObject({
        model,
        schema: LanguageDetectionSchema,
        prompt,
        temperature: 0.1, // Low temperature for consistent detection
      });

      const latency = Date.now() - startTime;

      getEventSystem().info(EventCategory.SESSION,
        `🌍 [LanguageDetection] Detected language: ${detection.languageCode} (confidence: ${detection.confidence.toFixed(2)}) in ${latency}ms`,
        {
          languageCode: detection.languageCode,
          confidence: detection.confidence,
          languageName: detection.languageName,
          transcriptPreview: transcript.substring(0, 50),
        }
      );

      // Normalize language code to lowercase
      const normalizedCode = detection.languageCode.toLowerCase().trim();

      // Update session language state
      if (!sessionData.language) {
        sessionData.language = {
          current: null,
          detected: null,
          configured: null,
          detectionEnabled: false,
        };
      }

      const previousLanguage = sessionData.language.current;

      // Only update if language changed
      if (previousLanguage !== normalizedCode) {
        sessionData.language.current = normalizedCode;
        sessionData.language.detected = normalizedCode;
        sessionData.language.configured = normalizedCode;

        // Update language detection service if available
        if (sessionData.languageDetectionService) {
          sessionData.languageDetectionService.setConfiguredLanguage(normalizedCode);
        }

        // Select appropriate voice for the language
        const initialVoice = sessionData.config?.voice;
        const currentVoice = sessionData.config?.voice;
        const languageVoiceMap = sessionData.languageVoiceMap;
        const lastVoicePerLanguage = sessionData.lastVoicePerLanguage;

        const newVoice = selectVoiceForLanguageChange(
          normalizedCode,
          initialVoice,
          initialVoice || 'Ashley', // Fallback to initial voice or default
          currentVoice,
          languageVoiceMap,
          lastVoicePerLanguage
        );

        // Track this voice as the last used voice for this language
        if (!sessionData.lastVoicePerLanguage) {
          sessionData.lastVoicePerLanguage = {};
        }
        sessionData.lastVoicePerLanguage[normalizedCode] = newVoice;

        // Update voice in session config
        if (sessionData.config) {
          const previousVoice = sessionData.config.voice;
          sessionData.config.voice = newVoice;

          if (newVoice !== previousVoice) {
            getEventSystem().info(EventCategory.SESSION,
              `🎤 [LanguageDetection] Voice changed: ${previousVoice || 'none'} → ${newVoice} (${normalizedCode})`
            );
          }
        }

        getEventSystem().info(EventCategory.SESSION,
          `✅ [LanguageDetection] Language updated: ${previousLanguage || 'none'} → ${normalizedCode}`
        );
      } else {
        getEventSystem().debug(EventCategory.SESSION,
          `🌍 [LanguageDetection] Language unchanged: ${normalizedCode}`
        );
      }
    } catch (error) {
      const latency = Date.now() - startTime;
      getEventSystem().warn(EventCategory.SESSION,
        `⚠️  [LanguageDetection] Detection failed after ${latency}ms: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : new Error(String(error))
      );
      // Don't throw - this is a non-blocking operation
    }
  }
}
