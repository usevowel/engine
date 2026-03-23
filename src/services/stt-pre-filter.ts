/**
 * STT Pre-Filter Service
 * 
 * Cleans up STT transcriptions before they reach the main LLM.
 * This handles dictation artifacts, whitespace issues, and formatting problems
 * that are common in speech-to-text output.
 * 
 * Two modes:
 * - Algorithmic (default): Fast, language-agnostic text normalization
 * - LLM-based: Uses Llama 8B for more sophisticated cleanup (fallback)
 */

import { generateText } from 'ai';
import { getProvider } from './providers/llm';
import { getEventSystem, EventCategory } from '../events';

/**
 * Use algorithmic NLP-based cleanup instead of LLM
 * Set to true to use fast regex-based normalization (default)
 * Set to false to use LLM-based cleanup (slower but more sophisticated)
 */
const USE_ALGORITHMIC_CLEANUP = true;

/**
 * Algorithmic text cleanup using regex-based normalization
 * 
 * Handles:
 * - Whitespace normalization (multiple spaces -> single space)
 * - Punctuation spacing (add spaces before punctuation if missing)
 * - Sentence capitalization (capitalize first letter of sentences)
 * - Dictation artifacts (e.g., "period" -> ".", "comma" -> ",")
 * - Language-agnostic (preserves original language)
 * 
 * @param text Raw STT transcription
 * @returns Cleaned transcription
 */
function cleanupTextAlgorithmically(text: string): string {
  if (!text.trim()) {
    return text;
  }

  let cleaned = text.trim();

  // 1. Replace common dictation artifacts
  const dictationArtifacts: Record<string, string> = {
    ' period': '.',
    'period ': '.',
    ' comma': ',',
    'comma ': ',',
    ' question mark': '?',
    'question mark ': '?',
    ' exclamation mark': '!',
    'exclamation mark ': '!',
    ' exclamation point': '!',
    'exclamation point ': '!',
    ' colon': ':',
    'colon ': ':',
    ' semicolon': ';',
    'semicolon ': ';',
  };

  for (const [artifact, replacement] of Object.entries(dictationArtifacts)) {
    // Case-insensitive replacement
    const regex = new RegExp(artifact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    cleaned = cleaned.replace(regex, replacement);
  }

  // 2. Normalize whitespace (multiple spaces/tabs/newlines -> single space)
  cleaned = cleaned.replace(/\s+/g, ' ');

  // 3. Fix punctuation spacing (ensure space before punctuation if it's attached to word)
  // But preserve common cases like "Mr.", "Dr.", "etc."
  cleaned = cleaned.replace(/([^\s])([.!?])(\s|$)/g, (match, before, punct, after) => {
    // Don't add space for abbreviations (single letter + period)
    if (/^[A-Za-z]$/.test(before)) {
      return match;
    }
    return `${before}${punct}${after}`;
  });

  // 4. Fix missing spaces after punctuation
  cleaned = cleaned.replace(/([.!?,:;])([A-Za-z])/g, '$1 $2');

  // 5. Fix missing spaces before punctuation (if word is attached)
  cleaned = cleaned.replace(/([A-Za-z])([.!?,:;])/g, '$1 $2');

  // 6. Normalize whitespace again after punctuation fixes
  cleaned = cleaned.replace(/\s+/g, ' ');

  // 7. Capitalize first letter of sentences (preserve existing capitalization for proper nouns)
  // Split by sentence-ending punctuation, but keep the punctuation
  const sentenceEndings = /([.!?])\s+/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = sentenceEndings.exec(cleaned)) !== null) {
    parts.push(cleaned.substring(lastIndex, match.index + match[0].length));
    lastIndex = match.index + match[0].length;
  }
  parts.push(cleaned.substring(lastIndex));

  cleaned = parts
    .map((part, index) => {
      if (index === 0 || /[.!?]\s+$/.test(parts[index - 1])) {
        // Capitalize first letter of sentence (only if it's lowercase)
        const firstChar = part.charAt(0);
        if (firstChar && firstChar === firstChar.toLowerCase() && /[a-z]/.test(firstChar)) {
          return firstChar.toUpperCase() + part.slice(1);
        }
      }
      return part;
    })
    .join('');

  // 8. Capitalize first letter of entire text (only if lowercase)
  const firstChar = cleaned.charAt(0);
  if (firstChar && firstChar === firstChar.toLowerCase() && /[a-z]/.test(firstChar)) {
    cleaned = firstChar.toUpperCase() + cleaned.slice(1);
  }

  // 9. Final trim
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Language code to language name mapping
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ru: 'Russian',
  nl: 'Dutch',
  pl: 'Polish',
  ar: 'Arabic',
  hi: 'Hindi',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  sv: 'Swedish',
  no: 'Norwegian',
  da: 'Danish',
  fi: 'Finnish',
  el: 'Greek',
  he: 'Hebrew',
  cs: 'Czech',
  ro: 'Romanian',
  hu: 'Hungarian',
};

/**
 * Prompt for cleaning up STT/dictation output
 */
function getSTTCleanupPrompt(text: string, targetLanguage?: string | null): string {
  const languageGuidance = targetLanguage
    ? `\n\nCRITICAL LANGUAGE PRESERVATION RULE:
- The text is in ${LANGUAGE_NAMES[targetLanguage] || targetLanguage.toUpperCase()}
- You MUST preserve the original language - do NOT translate to English or any other language
- Clean up formatting and punctuation while keeping the exact same language
- If the text is in ${LANGUAGE_NAMES[targetLanguage] || targetLanguage.toUpperCase()}, return cleaned text in ${LANGUAGE_NAMES[targetLanguage] || targetLanguage.toUpperCase()}
- Only fix whitespace, punctuation, and capitalization - do NOT change the language`
    : `\n\nCRITICAL LANGUAGE PRESERVATION RULE:
- Preserve the original language of the text - do NOT translate to English or any other language
- Detect what language the text is in and keep it in that same language
- Only fix whitespace, punctuation, and capitalization - do NOT change the language`;

  return `You are cleaning up text that came from speech-to-text (dictation). This text may have:
- Extra whitespace or missing spaces
- Incorrect punctuation
- Run-on sentences that should be split
- Missing capitalization
- Dictation artifacts (like "period" instead of ".", "comma" instead of ",")

Your task:
1. Clean up whitespace (remove extra spaces, add missing spaces)
2. Fix punctuation and capitalization
3. Format as natural, readable text
4. Do NOT change the meaning or content
5. Do NOT add information that wasn't there
6. Return ONLY the cleaned text, no explanations${languageGuidance}

Text to clean up:
${text}

Return ONLY the cleaned text:`;
}

/**
 * Clean up STT transcription using LLM (Llama 8B)
 * 
 * @param text Raw STT transcription
 * @param groqApiKey Groq API key for Llama 8B
 * @param targetLanguage Optional target language code (ISO 639-1, e.g., 'en', 'es', 'fr') to preserve language
 * @returns Cleaned transcription
 */
async function cleanupSTTTranscriptionWithLLM(
  text: string,
  groqApiKey: string,
  targetLanguage?: string | null
): Promise<string> {
  if (!text.trim() || text.trim().length < 3) {
    return text; // Skip very short text
  }

  const startTime = Date.now();
  const model = 'llama-3.1-8b-instant'; // Use Llama 8B for fast cleanup

  try {
    // Get Groq provider
    const groqProvider = getProvider('groq', {
      apiKey: groqApiKey,
    });

    const llmModel = groqProvider(model);

    // Build cleanup prompt with language preservation
    const prompt = getSTTCleanupPrompt(text, targetLanguage);

    // Call Llama 8B for cleanup
    const result = await generateText({
      model: llmModel as any,
      prompt,
      temperature: 0.1, // Very low temperature for consistent cleanup
    });

    const cleanedText = result.text.trim();
    const latency = Date.now() - startTime;

    getEventSystem().info(EventCategory.STT,
      `🧹 [STT Pre-Filter] Cleaned transcription (LLM) in ${latency}ms: "${text.substring(0, 50)}..." → "${cleanedText.substring(0, 50)}..."`);

    return cleanedText;

  } catch (error) {
    const latency = Date.now() - startTime;
    getEventSystem().warn(EventCategory.STT,
      `⚠️  [STT Pre-Filter] LLM cleanup failed after ${latency}ms, using original text`, 
      error instanceof Error ? error : new Error(String(error)));
    
    // Return original text on error
    return text;
  }
}

/**
 * Clean up STT transcription
 * 
 * Uses algorithmic cleanup by default (fast, language-agnostic).
 * Falls back to LLM-based cleanup if USE_ALGORITHMIC_CLEANUP is false.
 * 
 * @param text Raw STT transcription
 * @param groqApiKey Groq API key for Llama 8B (required if using LLM cleanup)
 * @param targetLanguage Optional target language code (ISO 639-1, e.g., 'en', 'es', 'fr') to preserve language
 * @returns Cleaned transcription
 */
export async function cleanupSTTTranscription(
  text: string,
  groqApiKey: string,
  targetLanguage?: string | null
): Promise<string> {
  if (!text.trim() || text.trim().length < 3) {
    return text; // Skip very short text
  }

  // Use algorithmic cleanup by default
  if (USE_ALGORITHMIC_CLEANUP) {
    const startTime = Date.now();
    const cleanedText = cleanupTextAlgorithmically(text);
    const latency = Date.now() - startTime;

    getEventSystem().info(EventCategory.STT,
      `🧹 [STT Pre-Filter] Cleaned transcription (algorithmic) in ${latency}ms: "${text.substring(0, 50)}..." → "${cleanedText.substring(0, 50)}..."`);

    return cleanedText;
  }

  // Fall back to LLM-based cleanup
  return cleanupSTTTranscriptionWithLLM(text, groqApiKey, targetLanguage);
}
