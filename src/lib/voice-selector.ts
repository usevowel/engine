/**
 * Voice Selection Utility
 * 
 * Provides utilities for selecting appropriate TTS voices based on language
 * and maintaining gender preference across language switches.
 */

import { 
  INWORLD_VOICES_BY_LANGUAGE, 
  getVoicesForLanguage,
  isLanguageSupported,
  type VoiceGender 
} from '../config/tts-voices';
import { getEventSystem, EventCategory } from '../events';

/**
 * xAI Grok TTS voice IDs (lowercase). Must match `SUPPORTED_GROK_VOICES` in `packages/provider-grok-tts`.
 * Grok is multilingual per voice: language is passed separately; do not map through Inworld per-locale lists.
 */
const GROK_TTS_VOICE_IDS = new Set(['ara', 'eve', 'leo', 'rex', 'sal']);
const GROK_TTS_DEFAULT_VOICE = 'rex';

function isGrokTtsVoiceId(voice: string | null | undefined): boolean {
  if (!voice) {
    return false;
  }
  return GROK_TTS_VOICE_IDS.has(voice.toLowerCase());
}

export interface VoiceSelectorImplementation {
  detectVoiceGender: (voiceId: string) => VoiceGender | null;
  selectVoiceForLanguage: (
    language: string,
    preferredGender: VoiceGender | null,
    fallbackVoice?: string,
    currentVoice?: string | null
  ) => string;
}

let registeredImplementation: VoiceSelectorImplementation | null = null;

export function registerVoiceSelectorImplementation(
  implementation: VoiceSelectorImplementation | null
): void {
  registeredImplementation = implementation;
}

/**
 * Determine gender from a voice name (heuristic)
 * 
 * @param voiceId - The voice ID to analyze
 * @returns The detected gender, or null if unknown
 */
export function detectVoiceGender(voiceId: string): VoiceGender | null {
  if (registeredImplementation) {
    return registeredImplementation.detectVoiceGender(voiceId);
  }

  if (!voiceId) return null;
  
  const lowerVoice = voiceId.toLowerCase();
  
  // Check against known voice mappings
  for (const [lang, voices] of Object.entries(INWORLD_VOICES_BY_LANGUAGE)) {
    // Check if voice is in female list
    if (voices.female.some(v => v.toLowerCase() === lowerVoice)) {
      return 'female';
    }
    // Check if voice is in male list
    if (voices.male.some(v => v.toLowerCase() === lowerVoice)) {
      return 'male';
    }
  }
  
  // Fallback: use common name patterns
  const femalePatterns = [
    'ashley', 'athena', 'hera', 'artemis', 'deborah', 'elizabeth',
    'julia', 'olivia', 'priya', 'sarah', 'wendy', 'hana', 'luna',
    'lupita', 'hélène', 'johanna', 'katrien', 'lore', 'minji', 'yoona',
    'xiaoyin', 'xinyi', 'jing', 'asuka', 'svetlana', 'elena', 'maitê', 'orietta'
  ];
  
  const malePatterns = [
    'ronald', 'dennis', 'hades', 'zeus', 'apollo', 'poseidon', 'ryan',
    'alex', 'craig', 'edward', 'mark', 'shaun', 'theodore', 'timothy',
    'dominus', 'clive', 'carter', 'blake', 'diego', 'miguel', 'rafael',
    'alain', 'mathieu', 'étienne', 'josef', 'erik', 'lennart', 'gianni',
    'heitor', 'hyunwoo', 'seojun', 'yichen', 'satoshi', 'szymon', 'wojciech',
    'dmitry', 'nikolai'
  ];
  
  if (femalePatterns.some(pattern => lowerVoice.includes(pattern))) {
    return 'female';
  }
  
  if (malePatterns.some(pattern => lowerVoice.includes(pattern))) {
    return 'male';
  }
  
  return null;
}

/**
 * Select an appropriate voice for a language based on gender preference
 * 
 * @param language - ISO 639-1 language code (e.g., 'en', 'es', 'fr')
 * @param preferredGender - Preferred gender ('male' or 'female')
 * @param fallbackVoice - Fallback voice if language not supported (default: 'Ashley')
 * @param currentVoice - Optional current voice to check if it's already appropriate
 * @returns Selected voice ID, or fallback if language not supported
 */
export function selectVoiceForLanguage(
  language: string,
  preferredGender: VoiceGender | null,
  fallbackVoice: string = 'Ashley',
  currentVoice?: string | null
): string {
  if (registeredImplementation) {
    return registeredImplementation.selectVoiceForLanguage(
      language,
      preferredGender,
      fallbackVoice,
      currentVoice
    );
  }

  // Normalize language code
  const normalizedLang = language.toLowerCase();
  
  // Check if language is supported
  if (!isLanguageSupported(normalizedLang)) {
    getEventSystem().warn(EventCategory.TTS, 
      `⚠️ Language ${language} not supported for voice selection, using fallback: ${fallbackVoice}`);
    return fallbackVoice;
  }
  
  const voices = getVoicesForLanguage(normalizedLang);
  if (!voices) {
    getEventSystem().warn(EventCategory.TTS, 
      `⚠️ No voices found for language ${language}, using fallback: ${fallbackVoice}`);
    return fallbackVoice;
  }
  
  // Check if current voice is already appropriate for this language
  if (currentVoice) {
    const lowerCurrentVoice = currentVoice.toLowerCase();
    const allVoicesForLang = [...voices.male, ...voices.female];
    if (allVoicesForLang.some(v => v.toLowerCase() === lowerCurrentVoice)) {
      // Current voice is already appropriate for this language, keep it
      getEventSystem().info(EventCategory.TTS, 
        `🎤 Keeping current voice for ${language}: ${currentVoice}`);
      return currentVoice;
    }
  }
  
  // Select voice based on preferred gender
  if (preferredGender === 'female' && voices.female.length > 0) {
    const selectedVoice = voices.female[0];
    getEventSystem().info(EventCategory.TTS, 
      `🎤 Selected female voice for ${language}: ${selectedVoice}`);
    return selectedVoice;
  }
  
  if (preferredGender === 'male' && voices.male.length > 0) {
    const selectedVoice = voices.male[0];
    getEventSystem().info(EventCategory.TTS, 
      `🎤 Selected male voice for ${language}: ${selectedVoice}`);
    return selectedVoice;
  }
  
  // Fallback: use first available voice (prefer female, then male)
  const selectedVoice = voices.female.length > 0 
    ? voices.female[0] 
    : voices.male.length > 0 
      ? voices.male[0] 
      : fallbackVoice;
  
  getEventSystem().info(EventCategory.TTS, 
    `🎤 Selected voice for ${language} (gender preference ${preferredGender || 'none'}): ${selectedVoice}`);
  
  return selectedVoice;
}

/**
 * Get the gender preference from an initial voice
 * 
 * @param initialVoice - The voice ID used at conversation start
 * @returns Detected gender preference, or null if unknown
 */
export function getGenderPreferenceFromVoice(initialVoice: string | null | undefined): VoiceGender | null {
  if (!initialVoice) return null;
  return detectVoiceGender(initialVoice);
}

/**
 * Select voice for language change, maintaining gender preference
 * 
 * @param newLanguage - Target language code (ISO 639-1)
 * @param initialVoice - Voice used at conversation start
 * @param fallbackVoice - Fallback voice if selection fails
 * @param currentVoice - Optional current voice to check if it's already appropriate
 * @param languageVoiceMap - Optional map of language codes to preferred voices from token config
 * @param lastVoicePerLanguage - Optional map of language codes to last used voices (runtime tracking)
 * @param ttsProvider - When `"grok"`, uses xAI Grok voice IDs only (no Inworld per-locale lists).
 * @returns Selected voice ID for the new language
 */
export function selectVoiceForLanguageChange(
  newLanguage: string,
  initialVoice: string | null | undefined,
  fallbackVoice: string = 'Ashley',
  currentVoice?: string | null,
  languageVoiceMap?: Record<string, string>,
  lastVoicePerLanguage?: Record<string, string>,
  ttsProvider?: string
): string {
  const normalizedLang = newLanguage.toLowerCase();
  const isGrok = ttsProvider === 'grok';

  if (isGrok) {
    if (lastVoicePerLanguage && lastVoicePerLanguage[normalizedLang]) {
      const last = lastVoicePerLanguage[normalizedLang];
      if (isGrokTtsVoiceId(last)) {
        const v = last.toLowerCase();
        getEventSystem().info(
          EventCategory.TTS,
          `🎤 [Grok TTS] Using last voice for ${newLanguage} from session memory: ${v}`
        );
        return v;
      }
    }
    if (languageVoiceMap && languageVoiceMap[normalizedLang]) {
      const preferred = languageVoiceMap[normalizedLang];
      if (isGrokTtsVoiceId(preferred)) {
        const v = preferred.toLowerCase();
        getEventSystem().info(
          EventCategory.TTS,
          `🎤 [Grok TTS] Using preferred voice for ${newLanguage} from token config: ${v}`
        );
        return v;
      }
    }
    if (isGrokTtsVoiceId(currentVoice)) {
      const v = currentVoice!.toLowerCase();
      getEventSystem().info(
        EventCategory.TTS,
        `🎤 [Grok TTS] Keeping current Grok voice for ${newLanguage}: ${v}`
      );
      return v;
    }
    if (isGrokTtsVoiceId(initialVoice)) {
      const v = initialVoice!.toLowerCase();
      getEventSystem().info(
        EventCategory.TTS,
        `🎤 [Grok TTS] Using initial Grok voice for ${newLanguage}: ${v}`
      );
      return v;
    }
    getEventSystem().info(
      EventCategory.TTS,
      `🎤 [Grok TTS] No valid Grok voice in memory, using default: ${GROK_TTS_DEFAULT_VOICE}`
    );
    return GROK_TTS_DEFAULT_VOICE;
  }

  // --- Non-Grok: Inworld / generic voice selection ---

  // Priority 1: Check if this language was used before and has a last voice (session memory)
  if (lastVoicePerLanguage && lastVoicePerLanguage[normalizedLang]) {
    const lastVoice = lastVoicePerLanguage[normalizedLang];
    getEventSystem().info(
      EventCategory.TTS,
      `🎤 Using last voice for ${newLanguage} from session memory: ${lastVoice}`
    );
    return lastVoice;
  }

  // Priority 2: Check token config for preferred voice for this language
  if (languageVoiceMap && languageVoiceMap[normalizedLang]) {
    const preferredVoice = languageVoiceMap[normalizedLang];
    getEventSystem().info(
      EventCategory.TTS,
      `🎤 Using preferred voice for ${newLanguage} from token config: ${preferredVoice}`
    );
    return preferredVoice;
  }

  // Priority 3: Use gender-based selection
  // Detect gender preference from initial voice
  const genderPreference = getGenderPreferenceFromVoice(initialVoice);

  // Select appropriate voice for new language, checking if current voice is already appropriate
  return selectVoiceForLanguage(newLanguage, genderPreference, fallbackVoice, currentVoice);
}
