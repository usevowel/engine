/**
 * Set Language Tool Executor
 * 
 * Server-side executor for the 'setLanguage' tool.
 * Allows the AI to set the current language for the session.
 * 
 * **CRITICAL:** This tool should be called BEFORE EVERY RESPONSE to ensure
 * the AI is speaking in the same language as the user, with the correct TTS voice.
 * 
 * Also automatically selects an appropriate TTS voice for the language,
 * maintaining gender preference when possible.
 * 
 * Supports all 99+ languages from OpenAI Whisper (Groq Whisper Large V3).
 */

import { getEventSystem, EventCategory } from '../../events';
import type { ServerToolContext, ServerToolResult } from '../server-tool-registry';
import { selectVoiceForLanguageChange } from '../voice-selector';

/**
 * Supported languages from OpenAI Whisper
 * Source: https://github.com/openai/whisper/blob/main/whisper/tokenizer.py
 */
const WHISPER_LANGUAGES: Record<string, string> = {
  "en": "english",
  "zh": "chinese",
  "de": "german",
  "es": "spanish",
  "ru": "russian",
  "ko": "korean",
  "fr": "french",
  "ja": "japanese",
  "pt": "portuguese",
  "tr": "turkish",
  "pl": "polish",
  "ca": "catalan",
  "nl": "dutch",
  "ar": "arabic",
  "sv": "swedish",
  "it": "italian",
  "id": "indonesian",
  "hi": "hindi",
  "fi": "finnish",
  "vi": "vietnamese",
  "he": "hebrew",
  "uk": "ukrainian",
  "el": "greek",
  "ms": "malay",
  "cs": "czech",
  "ro": "romanian",
  "da": "danish",
  "hu": "hungarian",
  "ta": "tamil",
  "no": "norwegian",
  "th": "thai",
  "ur": "urdu",
  "hr": "croatian",
  "bg": "bulgarian",
  "lt": "lithuanian",
  "la": "latin",
  "mi": "maori",
  "ml": "malayalam",
  "cy": "welsh",
  "sk": "slovak",
  "te": "telugu",
  "fa": "persian",
  "lv": "latvian",
  "bn": "bengali",
  "sr": "serbian",
  "az": "azerbaijani",
  "sl": "slovenian",
  "kn": "kannada",
  "et": "estonian",
  "mk": "macedonian",
  "br": "breton",
  "eu": "basque",
  "is": "icelandic",
  "hy": "armenian",
  "ne": "nepali",
  "mn": "mongolian",
  "bs": "bosnian",
  "kk": "kazakh",
  "sq": "albanian",
  "sw": "swahili",
  "gl": "galician",
  "mr": "marathi",
  "pa": "punjabi",
  "si": "sinhala",
  "km": "khmer",
  "sn": "shona",
  "yo": "yoruba",
  "so": "somali",
  "af": "afrikaans",
  "oc": "occitan",
  "ka": "georgian",
  "be": "belarusian",
  "tg": "tajik",
  "sd": "sindhi",
  "gu": "gujarati",
  "am": "amharic",
  "yi": "yiddish",
  "lo": "lao",
  "uz": "uzbek",
  "fo": "faroese",
  "ht": "haitian creole",
  "ps": "pashto",
  "tk": "turkmen",
  "nn": "nynorsk",
  "mt": "maltese",
  "sa": "sanskrit",
  "lb": "luxembourgish",
  "my": "myanmar",
  "bo": "tibetan",
  "tl": "tagalog",
  "mg": "malagasy",
  "as": "assamese",
  "tt": "tatar",
  "haw": "hawaiian",
  "ln": "lingala",
  "ha": "hausa",
  "ba": "bashkir",
  "jw": "javanese",
  "su": "sundanese",
  "yue": "cantonese",
};

/**
 * Language code aliases for easier lookup
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  "burmese": "my",
  "valencian": "ca",
  "flemish": "nl",
  "haitian": "ht",
  "letzeburgesch": "lb",
  "pushto": "ps",
  "panjabi": "pa",
  "moldavian": "ro",
  "moldovan": "ro",
  "sinhalese": "si",
  "castilian": "es",
  "mandarin": "zh",
};

/**
 * Execute the setLanguage tool
 * 
 * Sets the current language for TTS and STT.
 * This updates the session's language state and notifies the language detection service.
 * 
 * **IMPORTANT:** This tool should be called BEFORE EVERY RESPONSE to ensure the AI
 * is speaking in the correct language with the correct TTS voice.
 * 
 * @param args - Tool arguments (must contain 'languageCode' field)
 * @param context - Server tool execution context
 * @returns Tool execution result
 */
export async function executeSetLanguageTool(
  args: Record<string, any>,
  context: ServerToolContext
): Promise<ServerToolResult> {
  const languageCode = args?.languageCode;
  const { sessionData } = context;
  
  // Validate language code
  if (!languageCode || typeof languageCode !== 'string') {
    getEventSystem().error(EventCategory.SESSION, `❌ [SetLanguage] Invalid language code: ${languageCode}`);
    return {
      success: false,
      error: 'Invalid language code. Must be a non-empty string (e.g., "en", "es", "fr").',
      addToHistory: false,
    };
  }
  
  // Normalize to lowercase and extract 2-3 letter code
  let normalizedCode = languageCode.toLowerCase().trim();
  
  // Check if it's a language name (resolve alias or full name)
  if (normalizedCode.length > 3) {
    // Try alias first
    if (LANGUAGE_ALIASES[normalizedCode]) {
      normalizedCode = LANGUAGE_ALIASES[normalizedCode];
    } else {
      // Try to find by full language name
      const foundCode = Object.entries(WHISPER_LANGUAGES).find(
        ([_, name]) => name.toLowerCase() === normalizedCode
      )?.[0];
      
      if (foundCode) {
        normalizedCode = foundCode;
      } else {
        // Invalid language name
        getEventSystem().error(EventCategory.SESSION, 
          `❌ [SetLanguage] Unknown language: ${languageCode}`);
        return {
          success: false,
          error: `Unknown language: ${languageCode}. Use ISO 639-1 code (e.g., "en", "es") or full name (e.g., "english", "spanish").`,
          addToHistory: false,
        };
      }
    }
  }
  
  // Validate against Whisper supported languages
  if (!WHISPER_LANGUAGES[normalizedCode]) {
    const supported = Object.keys(WHISPER_LANGUAGES).slice(0, 20).join(', ') + '...';
    getEventSystem().error(EventCategory.SESSION, 
      `❌ [SetLanguage] Unsupported language code: ${normalizedCode}`);
    return {
      success: false,
      error: `Unsupported language code: ${normalizedCode}. Supported codes: ${supported}`,
      addToHistory: false,
    };
  }
  
  const languageName = WHISPER_LANGUAGES[normalizedCode];
  
  getEventSystem().info(EventCategory.SESSION, 
    `🌍 [SetLanguage] Setting language: ${normalizedCode} (${languageName}, original: ${languageCode})`);
  
  // Initialize language state if not present
  if (!sessionData.language) {
    sessionData.language = {
      current: null,
      detected: null,
      configured: null,
      detectionEnabled: false,
    };
  }
  
  // Store previous language for logging
  const previousLanguage = sessionData.language.current;
  const previousVoice = sessionData.config?.voice;
  
  // Update language state
  sessionData.language.current = normalizedCode;
  sessionData.language.configured = normalizedCode;
  
  // Update language detection service if available
  if (sessionData.languageDetectionService) {
    sessionData.languageDetectionService.setConfiguredLanguage(normalizedCode);
    getEventSystem().info(EventCategory.SESSION, 
      `✅ [SetLanguage] Updated language detection service: ${normalizedCode}`);
  }
  
  // Select appropriate voice for the language
  // Priority order:
  // 1. Last used voice for this language (session memory)
  // 2. Token config preferred voice for this language
  // 3. Gender-based selection (maintains gender from initial voice)
  const initialVoice = sessionData.initialVoice || sessionData.config?.voice;
  const currentVoice = sessionData.config?.voice;
  const languageVoiceMap = sessionData.languageVoiceMap;
  const lastVoicePerLanguage = sessionData.lastVoicePerLanguage;
  
  const newVoice = selectVoiceForLanguageChange(
    normalizedCode,
    initialVoice,
    initialVoice || currentVoice || 'Ashley', // Fallback to configured/current voice or default
    currentVoice,
    languageVoiceMap,
    lastVoicePerLanguage
  );
  
  // Track this voice as the last used voice for this language
  if (!sessionData.lastVoicePerLanguage) {
    sessionData.lastVoicePerLanguage = {};
  }
  sessionData.lastVoicePerLanguage[normalizedCode] = newVoice;
  
  getEventSystem().info(EventCategory.SESSION, 
    `📝 [SetLanguage] Tracked ${newVoice} as last voice for ${normalizedCode}`);
  
  // Update voice in session config
  if (sessionData.config) {
    sessionData.config.voice = newVoice;
    
    if (newVoice !== previousVoice) {
      getEventSystem().info(EventCategory.SESSION, 
        `🎤 [SetLanguage] Voice changed: ${previousVoice || 'none'} → ${newVoice}`);
    } else {
      getEventSystem().info(EventCategory.SESSION, 
        `🎤 [SetLanguage] Voice unchanged: ${newVoice} (already appropriate for ${normalizedCode})`);
    }
  }
  
  getEventSystem().info(EventCategory.SESSION, 
    `✅ [SetLanguage] Language set: ${previousLanguage || 'none'} → ${normalizedCode} (${languageName})`);
  
  return {
    success: true,
    data: {
      previousLanguage: previousLanguage || 'none',
      newLanguage: normalizedCode,
      languageName,
      previousVoice: previousVoice || 'none',
      newVoice,
      voiceChanged: newVoice !== previousVoice,
      message: `Language successfully set to ${languageName} (${normalizedCode}) with voice ${newVoice}. Please continue with your response to the user in ${languageName}.`,
    },
    addToHistory: true,
  };
}
