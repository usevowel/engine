/**
 * Response Filter Service
 * 
 * Filters LLM responses using a secondary LLM (GPT-OSS 20B) to:
 * - Skip duplicate chunks (chunk-level deduplication)
 * - Remove repetition within chunks
 * - Translate to target language if needed
 * 
 * Uses algorithmic pre-filtering to catch obvious duplicates and malformed text
 * before sending to the LLM filter, reducing latency and API costs.
 */

import { generateText } from 'ai';
import { getProvider } from '../providers/llm';
import { getEventSystem, EventCategory } from '../../events';
import { groqSupportsReasoningEffort } from '../providers/llm/reasoning-effort';
import type { ResponseFilterConfig, FilteredTextDelta } from './types';
import {
  getDeduplicationPrompt,
  getTranslationPrompt,
  getCombinedPrompt,
} from './prompts';
import { preFilter, type PreFilterConfig } from './pre-filter';

/**
 * Configuration: Whether to send system instructions to the filter LLM
 * 
 * When enabled, the filter will enforce system prompt restrictions (e.g., "only speak in English").
 * When disabled, the filter only performs deduplication and translation.
 * 
 * Default: false (disabled) - reduces prompt size and latency
 */
const ENABLE_SYSTEM_INSTRUCTIONS_IN_FILTER = false;

/**
 * Language code mappings for prompt generation
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
};

/**
 * Response Filter Service
 */
export class ResponseFilterService {
  private recentChunks: string[] = [];
  private readonly maxRecentChunks: number;

  constructor(maxRecentChunks: number = 10) {
    this.maxRecentChunks = maxRecentChunks;
  }

  /**
   * Filter a single text chunk (non-streaming)
   * 
   * @param text Text chunk to filter
   * @param config Filter configuration
   * @returns Filtered text (empty string if chunk should be skipped)
   */
  async filterChunk(
    text: string,
    config: ResponseFilterConfig
  ): Promise<string> {
    if (!config.enabled) {
      return text; // Pass through if filter disabled
    }

    // Skip filtering for very short chunks (less likely to be duplicates, saves latency)
    if (text.trim().length < 10) {
      getEventSystem().debug(EventCategory.RESPONSE_FILTER,
        `⏭️  [Filter] Skipping filter for very short chunk: "${text}"`);
      return text;
    }

    // Apply algorithmic pre-filter to determine if LLM deduplication is needed
    // Pattern checks clean text algorithmically, similarity/internal repetition trigger LLM call
    // Uses fuzzball.js for fuzzy duplicate detection (handles word reordering and partial duplicates)
    const preFilterConfig: PreFilterConfig = {
      similarityThreshold: 0.75, // If similarity >= 0.75, call LLM to deduplicate
      maxWhitespace: 5, // Clean if more than 5 consecutive whitespace chars
      maxDots: 5, // Clean if more than 5 consecutive dots
      maxRepeatedChars: 5, // Clean if any character repeats more than 5 times
      internalRepetitionThreshold: 0.7, // If internal repetition >= 0.7, call LLM
    };
    
    const preFilterResult = preFilter(text, this.recentChunks, preFilterConfig);
    
    // Use cleaned text if available (pattern issues were fixed)
    const textToProcess = preFilterResult.cleanedText ?? text;
    
    // Pattern checks (whitespace/dots/repeated chars) → skip only if cleaned text is empty
    if (preFilterResult.shouldSkip) {
      const reasonMessages: Record<string, string> = {
        whitespace: 'excessive whitespace (cleaned to empty)',
        dots: 'excessive dots (cleaned to empty)',
        repeated_chars: 'repeated characters (cleaned to empty)',
      };
      
      getEventSystem().info(EventCategory.RESPONSE_FILTER,
        `⏭️  [PreFilter] Chunk skipped (${reasonMessages[preFilterResult.reason ?? 'unknown']}): "${text.substring(0, 50)}..."`);
      return ''; // Skip chunk
    }
    
    // Log if text was cleaned
    if (preFilterResult.wasCleaned) {
      const reasonMessages: Record<string, string> = {
        whitespace: 'excessive whitespace',
        dots: 'excessive dots',
        repeated_chars: 'repeated characters',
      };
      
      getEventSystem().info(EventCategory.RESPONSE_FILTER,
        `🧹 [PreFilter] Text cleaned (${reasonMessages[preFilterResult.reason ?? 'unknown']}): "${text.substring(0, 30)}..." → "${textToProcess.substring(0, 30)}..."`);
    }
    
    // If no deduplication needed, pass through cleaned text without LLM call
    if (!preFilterResult.needsDeduplication) {
      getEventSystem().debug(EventCategory.RESPONSE_FILTER,
        `✅ [PreFilter] Chunk passed pre-filter (no deduplication needed): "${textToProcess.substring(0, 50)}..."`);
      return textToProcess; // Pass through cleaned text (or original if not cleaned)
    }
    
    // Deduplication needed - log reason and proceed to LLM filter (use cleaned text)
    const dedupReasonMessages: Record<string, string> = {
      similarity: `similarity score ${preFilterResult.similarityScore?.toFixed(2) ?? 'N/A'}`,
      internal_repetition: `internal repetition score ${preFilterResult.internalRepetitionScore?.toFixed(2) ?? 'N/A'}`,
    };
    
    getEventSystem().info(EventCategory.RESPONSE_FILTER,
      `🔍 [PreFilter] Deduplication needed (${dedupReasonMessages[preFilterResult.reason ?? 'unknown']}), calling LLM filter: "${textToProcess.substring(0, 50)}..."`);

    const startTime = Date.now();
    // const mode = config.mode || 'deduplication';
    const mode = "both" as any;
    // Default model: GPT-OSS 20B (more reliable than smaller models)
    const filterModel = config.filterModel || 'openai/gpt-oss-20b';

    try {
      // Get Groq provider
      const groqProvider = getProvider('groq', {
        apiKey: config.groqApiKey,
      });

      const model = groqProvider(filterModel);

      // Limit recent chunks to most recent 3-5 for faster processing (reduces prompt size)
      const limitedRecentChunks = this.recentChunks.slice(-5);

      // Build prompt based on mode (use cleaned text if available)
      // System instructions are disabled (ENABLE_SYSTEM_INSTRUCTIONS_IN_FILTER = false)
      // Language detection is handled by the LLM as part of translation
      
      let prompt: string;
      if (mode === 'deduplication') {
        prompt = getDeduplicationPrompt(textToProcess, limitedRecentChunks);
      } else if (mode === 'translation' && config.targetLanguage) {
        // Translation mode: LLM detects source language and determines target language
        const languageName = LANGUAGE_NAMES[config.targetLanguage] || config.targetLanguage;
        prompt = getTranslationPrompt(textToProcess, languageName, config.targetLanguage, config.lastUserMessage);
      } else if (mode === 'both' && config.targetLanguage) {
        // Combined mode: show recent chunks for deduplication, LLM handles language detection
        const languageName = LANGUAGE_NAMES[config.targetLanguage] || config.targetLanguage;
        prompt = getCombinedPrompt(textToProcess, limitedRecentChunks, languageName, config.targetLanguage, config.lastUserMessage);
      } else {
        // Fallback to deduplication if translation mode but no target language
        prompt = getDeduplicationPrompt(textToProcess, limitedRecentChunks);
      }

      getEventSystem().debug(EventCategory.RESPONSE_FILTER, 
        `🔍 [Filter] Processing chunk: "${textToProcess.substring(0, 50)}..." (mode: ${mode}, model: ${filterModel})`);

      // Apply reasoning effort for lowest latency (only if model supports it)
      const reasoningEffort = groqSupportsReasoningEffort(filterModel) ? 'low' : undefined;
      
      // Call filter LLM with optimized settings
      const result = await generateText({
        model: model as any, // Type assertion for AI SDK compatibility
        prompt,
        temperature: 0.1, // Lower temperature for faster, more deterministic responses
        ...(reasoningEffort && {
          providerOptions: {
            groq: {
              reasoningEffort: reasoningEffort,
            },
          },
        }),
      });

      const rawResponse = result.text.trim();
      const latency = Date.now() - startTime;

      // Log raw response for debugging (truncated for normal cases)
      getEventSystem().debug(EventCategory.RESPONSE_FILTER,
        `🔍 [Filter] Raw LLM response (${latency}ms): "${rawResponse.substring(0, 200)}..."`);

      // Parse structured output (XML-like tags)
      // Expected formats:
      // - <duplicate/> or <duplicate></duplicate> → skip chunk
      // - <text>...</text> or <translation>...</translation> → return content
      let filteredText: string | null = null;
      
      // Check for duplicate tag (case-insensitive, handle self-closing and paired tags)
      // Also check for explicit "duplicate" text (in case LLM doesn't use tags)
      const duplicatePattern = /<duplicate\s*\/?>|<\/duplicate>|^\s*duplicate\s*$/i;
      const isExplicitDuplicate = duplicatePattern.test(rawResponse) || 
                                   (rawResponse.toLowerCase().trim() === 'duplicate');
      
      if (isExplicitDuplicate) {
        getEventSystem().info(EventCategory.RESPONSE_FILTER,
          `⏭️  [Filter] Chunk skipped (duplicate detected) in ${latency}ms: "${text.substring(0, 50)}..."`);
        return ''; // Skip chunk
      }
      
      // Extract text from <text>...</text> or <translation>...</translation> tags
      // Use dotall flag (s) to match newlines, and make it non-greedy
      const textMatch = rawResponse.match(/<(?:text|translation)>(.*?)<\/(?:text|translation)>/is);
      if (textMatch && textMatch[1]) {
        filteredText = textMatch[1].trim();
        getEventSystem().debug(EventCategory.RESPONSE_FILTER,
          `✅ [Filter] Extracted text from structured output: "${filteredText.substring(0, 50)}..."`);
      } else {
        // Fallback: if no tags found, try to extract content between any angle brackets
        const fallbackMatch = rawResponse.match(/<([^>]+)>(.*?)<\/\1>/is);
        if (fallbackMatch && fallbackMatch[2]) {
          filteredText = fallbackMatch[2].trim();
          getEventSystem().debug(EventCategory.RESPONSE_FILTER,
            `✅ [Filter] Extracted text from fallback tag "${fallbackMatch[1]}": "${filteredText.substring(0, 50)}..."`);
        } else if (!rawResponse.includes('<') && !rawResponse.includes('>')) {
          // No XML tags at all, assume it's plain text (backward compatibility)
          // This handles cases where the LLM doesn't follow structured format
          filteredText = rawResponse;
          getEventSystem().debug(EventCategory.RESPONSE_FILTER,
            `✅ [Filter] No XML tags found, using raw response as plain text: "${filteredText.substring(0, 50)}..."`);
        } else {
          // Malformed response - check if it looks like it might be valid text without tags
          // Sometimes LLMs return text that looks like it should be valid but isn't wrapped
          const hasAngleBrackets = rawResponse.includes('<') || rawResponse.includes('>');
          if (hasAngleBrackets && rawResponse.length > 10) {
            // Try to extract text that's not in tags (might be outside tags)
            const textOutsideTags = rawResponse.replace(/<[^>]*>/g, '').trim();
            if (textOutsideTags.length > 0) {
              filteredText = textOutsideTags;
              getEventSystem().warn(EventCategory.RESPONSE_FILTER,
                `⚠️  [Filter] Malformed XML, extracted text outside tags: "${filteredText.substring(0, 50)}..."`);
              getEventSystem().warn(EventCategory.RESPONSE_FILTER,
                `⚠️  [Filter] FULL RAW RESPONSE: "${rawResponse}"`);
            } else {
              // Last resort: pass through cleaned text (or original if not cleaned)
              getEventSystem().warn(EventCategory.RESPONSE_FILTER,
                `⚠️  [Filter] Malformed structured output, passing through cleaned text. Response: "${rawResponse.substring(0, 100)}..."`);
              getEventSystem().warn(EventCategory.RESPONSE_FILTER,
                `⚠️  [Filter] FULL RAW RESPONSE: "${rawResponse}"`);
              filteredText = textToProcess; // Pass through cleaned text on parse failure
            }
          } else {
            // No tags found and response exists - treat as valid text (LLM might not be following structured format)
            // Only skip if response is truly empty or just whitespace
            if (rawResponse.trim().length === 0) {
              filteredText = null; // Will be caught below
            } else {
              filteredText = rawResponse;
              getEventSystem().debug(EventCategory.RESPONSE_FILTER,
                `✅ [Filter] Using raw response (no structured tags found): "${filteredText.substring(0, 50)}..."`);
            }
          }
        }
      }

      // Check if extracted text is empty (should be treated as duplicate)
      // Only skip if we explicitly got a duplicate signal OR if text is truly empty
      if (!filteredText || filteredText.trim() === '') {
        // If raw response exists but we couldn't extract text, it might be a parsing issue
        // In that case, be lenient and pass through original text rather than skipping
        if (rawResponse.trim().length > 0 && !isExplicitDuplicate) {
          getEventSystem().warn(EventCategory.RESPONSE_FILTER,
            `⚠️  [Filter] Parsing issue - raw response exists but couldn't extract text. Passing through cleaned text. Raw: "${rawResponse.substring(0, 100)}..."`);
          getEventSystem().warn(EventCategory.RESPONSE_FILTER,
            `⚠️  [Filter] FULL RAW RESPONSE: "${rawResponse}"`);
          filteredText = textToProcess; // Pass through cleaned text on parsing failure
        } else {
          getEventSystem().info(EventCategory.RESPONSE_FILTER,
            `⏭️  [Filter] Chunk skipped (empty after parsing) in ${latency}ms. Raw response: "${rawResponse.substring(0, 100)}..."`);
          getEventSystem().warn(EventCategory.RESPONSE_FILTER,
            `⚠️  [Filter] FULL RAW RESPONSE (empty result): "${rawResponse}"`);
          return ''; // Skip chunk
        }
      }

      // Chunk passed filter
      getEventSystem().info(EventCategory.RESPONSE_FILTER,
        `✅ [Filter] Chunk passed filter in ${latency}ms: "${filteredText.substring(0, 50)}..."`);

      return filteredText;

    } catch (error) {
      const latency = Date.now() - startTime;
      getEventSystem().warn(EventCategory.RESPONSE_FILTER,
        `⚠️  [Filter] Filter LLM failed after ${latency}ms, passing through cleaned text`, 
        error instanceof Error ? error : new Error(String(error)));
      
      // Log full error details
      if (error instanceof Error) {
        getEventSystem().warn(EventCategory.RESPONSE_FILTER,
          `⚠️  [Filter] FULL ERROR DETAILS: ${error.message}\nStack: ${error.stack}`);
      } else {
        getEventSystem().warn(EventCategory.RESPONSE_FILTER,
          `⚠️  [Filter] FULL ERROR OBJECT: ${JSON.stringify(error, null, 2)}`);
      }
      
      // On error, pass through cleaned text (or original if not cleaned)
      return textToProcess;
    }
  }

  /**
   * Add chunk to recent history (only if not skipped)
   * 
   * @param chunk Chunk to add to history
   */
  addChunkToHistory(chunk: string): void {
    if (chunk.trim().length === 0) {
      return; // Don't add empty chunks
    }

    this.recentChunks.push(chunk);
    
    // Maintain sliding window
    if (this.recentChunks.length > this.maxRecentChunks) {
      this.recentChunks.shift();
    }
  }

  /**
   * Get recent chunks for comparison
   * 
   * @param maxChunks Maximum number of chunks to return (default: all)
   * @returns Array of recent chunks
   */
  getRecentChunks(maxChunks?: number): string[] {
    if (maxChunks && maxChunks < this.recentChunks.length) {
      return this.recentChunks.slice(-maxChunks);
    }
    return [...this.recentChunks];
  }

  /**
   * Clear recent chunk history
   */
  clearHistory(): void {
    this.recentChunks = [];
  }

  /**
   * Reset filter service (clear history)
   */
  reset(): void {
    this.clearHistory();
  }

}
