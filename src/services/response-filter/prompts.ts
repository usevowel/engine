/**
 * Response Filter Prompts
 * 
 * System prompts for the filter LLM (GPT-OSS 20B) to handle
 * chunk-level deduplication and translation.
 */

/**
 * Chunk-level deduplication prompt
 * 
 * Instructs the filter LLM to compare a new chunk against recent chunks
 * and return empty string if duplicate, filtered text if unique.
 * Also enforces system instructions/restrictions if provided.
 */
export function getDeduplicationPrompt(
  newChunk: string,
  recentChunks: string[]
): string {
  const recentChunksText = recentChunks.length > 0
    ? recentChunks.map((chunk, idx) => `${idx + 1}. ${chunk}`).join('\n')
    : '(No recent chunks)';

  return `Filter text chunk. Compare against recent chunks.

Rules:
- If duplicate/similar to recent chunks → return <duplicate/>
- If unique:
  - Return text verbatim
  - Remove internal repetition
  - Return <text>filtered text here</text>

Recent: ${recentChunksText || 'none'}

New: ${newChunk}

Return ONLY <text>filtered text</text> or <duplicate/>. No other text.`;
}

/**
 * Translation prompt
 * 
 * Instructs the filter LLM to translate text to target language.
 * Also enforces system instructions/restrictions if provided.
 */
export function getTranslationPrompt(
  text: string,
  targetLanguage: string,
  targetLanguageCode: string,
  lastUserMessage?: string
): string {
  const contextSection = lastUserMessage
    ? `\nLast user message (for language context): ${lastUserMessage}`
    : '';

  return `Translate text chunk.

LANGUAGE DETECTION:
1. Detect the SOURCE language of the text chunk (what language is it currently in?)
2. Determine the TARGET language (what language should it be translated to?)
   - Use the last user message as context for target language
   - If last user message is in a specific language, translate to that language
   - If no clear target language, use suggested target: ${targetLanguage} (${targetLanguageCode})
3. If source language matches target language, return text verbatim (no translation needed)

CRITICAL TRANSLATION RULES - YOU MUST FOLLOW THESE EXACTLY:
- Translate ONLY - do NOT change tone, style, or content
- Translate VERBATIM - preserve exact meaning, formality level, and style
- Do NOT "improve" or "fix" the text
- Do NOT change casual to formal or vice versa
- Do NOT add or remove words unless necessary for translation
- Do NOT change punctuation or structure unless required by target language
- If text is strange, weird, or unusual - translate it EXACTLY as-is
- Return <translation>translated text here</translation>

Text to translate: ${text}${contextSection}

Return ONLY <translation>translated text</translation>. No other text.`;
}

/**
 * Combined prompt (deduplication + translation)
 * 
 * Handles both deduplication and translation in a single pass.
 * Also enforces system instructions/restrictions if provided.
 */
export function getCombinedPrompt(
  newChunk: string,
  recentChunks: string[],
  targetLanguage: string,
  targetLanguageCode: string,
  lastUserMessage?: string
): string {
  const recentChunksText = recentChunks.length > 0
    ? recentChunks.map((chunk, idx) => `${idx + 1}. ${chunk}`).join('\n')
    : '(No recent chunks)';

  const contextSection = lastUserMessage
    ? `\nLast user message (for language context): ${lastUserMessage}`
    : '';

  return `Filter and translate text chunk.

CRITICAL RULES - YOU MUST FOLLOW THESE EXACTLY:
1. DEDUPLICATION: Compare new chunk against recent chunks
   - If duplicate/similar to recent chunks → return <duplicate/>
   - Recent chunks are ONLY for deduplication, NOT for translation context

2. LANGUAGE DETECTION (if unique, not duplicate):
   - Detect the SOURCE language of the new chunk (what language is it currently in?)
   - Determine the TARGET language (what language should it be translated to?)
     * Use the last user message as context for target language
     * If last user message is in a specific language, translate to that language
     * If no clear target language, use suggested target: ${targetLanguage} (${targetLanguageCode})
   - If source language matches target language, return text verbatim (no translation needed)

3. IF UNIQUE (not duplicate):
   - Remove ONLY internal repetition (same words/phrases repeated within THIS chunk)
   - Translate to target language (determined above)
   - Translate VERBATIM - do NOT change tone, style, or content
   - Do NOT "improve" or "fix" the text
   - Do NOT change formality level or style
   - Do NOT add explanations or clarifications
   - If text is strange, weird, or unusual - translate it EXACTLY as-is
   - Preserve exact meaning, structure, and tone
   - Return <translation>processed text here</translation>

Recent chunks (for deduplication comparison ONLY - ignore for translation): ${recentChunksText || 'none'}

New chunk to process: ${newChunk}${contextSection}

Return ONLY <translation>processed text</translation> or <duplicate/>. No other text.`;
}

