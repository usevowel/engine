/**
 * Response Filter Pre-Filter
 * 
 * Algorithmic pre-filtering to determine if LLM deduplication is needed.
 * 
 * Logic:
 * - Pattern checks (whitespace/dots/repeated chars) → skip immediately (malformed)
 * - Similarity check → if HIGH similarity (duplicate detected), call LLM to deduplicate
 * - Internal repetition check → if detected within chunk, call LLM to deduplicate
 * - If no issues detected, pass through without LLM call
 * 
 * Uses:
 * - fuzzball.js for fuzzy duplicate detection (token-based, handles word reordering)
 * - Internal repetition detection (within same chunk)
 * - Pattern detection for long whitespace/dots/character repetition (skip immediately)
 */

import * as fuzzball from 'fuzzball';

/**
 * Configuration for pre-filter
 */
export interface PreFilterConfig {
  /** Similarity threshold (0.0-1.0) - if similarity >= threshold, call LLM to deduplicate (default: 0.75) */
  similarityThreshold?: number;
  
  /** Maximum consecutive whitespace characters before skipping (default: 5) */
  maxWhitespace?: number;
  
  /** Maximum consecutive dots before skipping (default: 5) */
  maxDots?: number;
  
  /** Maximum consecutive identical characters before skipping (default: 5) */
  maxRepeatedChars?: number;
  
  /** Threshold for internal repetition detection within same chunk (default: 0.7) */
  internalRepetitionThreshold?: number;
}

/**
 * Pre-filter result
 */
export interface PreFilterResult {
  /** Whether the chunk should be skipped entirely (only for truly malformed text) */
  shouldSkip: boolean;
  
  /** Whether LLM deduplication should be called (duplication detected) */
  needsDeduplication: boolean;
  
  /** Cleaned text (if pattern cleaning was applied) */
  cleanedText?: string;
  
  /** Whether text was cleaned (pattern issues fixed) */
  wasCleaned: boolean;
  
  /** Reason for skipping, cleaning, or needing deduplication */
  reason?: 'similarity' | 'internal_repetition' | 'whitespace' | 'dots' | 'repeated_chars';
  
  /** Similarity score (if similarity check was performed) */
  similarityScore?: number;
  
  /** Internal repetition score (if internal repetition check was performed) */
  internalRepetitionScore?: number;
}

/**
 * Split text into sentences
 * 
 * @param text Text to split
 * @returns Array of sentences
 */
function splitIntoSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+/g) || [text];
}

/**
 * Calculate fuzzy similarity between two strings using fuzzball.js
 * 
 * Uses token_set_ratio which handles:
 * - Word reordering ("Hello world" vs "world Hello" = 100%)
 * - Partial duplicates ("The quick brown fox" vs "quick brown fox" = high similarity)
 * - Fuzzy matching (typos, variations)
 * 
 * fuzzball returns 0-100, we convert to 0.0-1.0
 * 
 * @param text1 First text to compare
 * @param text2 Second text to compare
 * @returns Similarity score (0.0-1.0)
 */
function calculateSimilarity(text1: string, text2: string): number {
  if (!text1.trim() || !text2.trim()) {
    return 0.0;
  }
  
  // Use token_set_ratio - best for fuzzy duplicates with word reordering
  // Returns 0-100, convert to 0.0-1.0
  const score = fuzzball.token_set_ratio(text1, text2);
  return score / 100.0;
}

/**
 * Clean text by removing excessive whitespace, dots, and repeated characters
 * 
 * Instead of skipping, we clean the text and still send it to TTS.
 * 
 * @param text Text to clean
 * @param config Pre-filter configuration
 * @returns Cleaned text
 */
function cleanPatterns(
  text: string,
  config: PreFilterConfig
): string {
  const maxWhitespace = config.maxWhitespace ?? 5;
  const maxDots = config.maxDots ?? 5;
  const maxRepeatedChars = config.maxRepeatedChars ?? 5;
  
  let cleaned = text;
  
  // Replace excessive whitespace sequences with single space
  const whitespacePattern = new RegExp(`\\s{${maxWhitespace + 1},}`, 'g');
  cleaned = cleaned.replace(whitespacePattern, ' ');
  
  // Replace excessive dot sequences with single dot (or ellipsis if 3+ dots)
  const dotsPattern = new RegExp(`\\.{${maxDots + 1},}`, 'g');
  cleaned = cleaned.replace(dotsPattern, (match) => {
    // If it's a very long sequence, replace with ellipsis, otherwise single dot
    return match.length > 10 ? '...' : '.';
  });
  
  // Replace repeated characters (any character repeated more than maxRepeatedChars times)
  // This catches patterns like "aaaaa", "!!!!!", "-----", etc.
  // Keep up to maxRepeatedChars characters, remove the rest
  const repeatedCharPattern = new RegExp(`(.)\\1{${maxRepeatedChars},}`, 'g');
  cleaned = cleaned.replace(repeatedCharPattern, (match, char) => {
    // Keep the character repeated up to maxRepeatedChars times
    return char.repeat(Math.min(maxRepeatedChars, match.length));
  });
  
  // Trim and normalize whitespace
  cleaned = cleaned.trim().replace(/\s+/g, ' ');
  
  return cleaned;
}

/**
 * Check if text contains excessive whitespace, dots, or repeated characters
 * 
 * These patterns are cleaned algorithmically instead of skipping.
 * 
 * @param text Text to check
 * @param config Pre-filter configuration
 * @returns Pre-filter result with cleaned text if needed
 */
function checkPatterns(
  text: string,
  config: PreFilterConfig
): PreFilterResult {
  const maxWhitespace = config.maxWhitespace ?? 5;
  const maxDots = config.maxDots ?? 5;
  const maxRepeatedChars = config.maxRepeatedChars ?? 5;
  
  let needsCleaning = false;
  let reason: 'whitespace' | 'dots' | 'repeated_chars' | undefined;
  
  // Check for long whitespace sequences
  const whitespacePattern = new RegExp(`\\s{${maxWhitespace + 1},}`);
  if (whitespacePattern.test(text)) {
    needsCleaning = true;
    reason = 'whitespace';
  }
  
  // Check for long dot sequences
  const dotsPattern = new RegExp(`\\.{${maxDots + 1},}`);
  if (dotsPattern.test(text)) {
    needsCleaning = true;
    reason = reason || 'dots';
  }
  
  // Check for repeated characters (any character repeated more than maxRepeatedChars times)
  // This catches patterns like "aaaaa", "!!!!!", "-----", etc.
  const repeatedCharPattern = new RegExp(`(.)\\1{${maxRepeatedChars},}`);
  if (repeatedCharPattern.test(text)) {
    needsCleaning = true;
    reason = reason || 'repeated_chars';
  }
  
  if (needsCleaning) {
    const cleanedText = cleanPatterns(text, config);
    
    // If cleaned text is empty or just whitespace, skip it
    if (!cleanedText || cleanedText.trim().length === 0) {
      return {
        shouldSkip: true,
        needsDeduplication: false,
        wasCleaned: false,
        reason,
      };
    }
    
    return {
      shouldSkip: false,
      needsDeduplication: false,
      cleanedText,
      wasCleaned: true,
      reason,
    };
  }
  
  return {
    shouldSkip: false,
    needsDeduplication: false,
    wasCleaned: false,
  };
}

/**
 * Check if text contains internal repetition (duplication within the same chunk)
 * 
 * Splits text into sentences and checks for similarity between sentences within the chunk
 * using fuzzball.js token-based fuzzy matching.
 * 
 * @param text Text chunk to check
 * @param config Pre-filter configuration
 * @returns Pre-filter result with internal repetition score
 */
function checkInternalRepetition(
  text: string,
  config: PreFilterConfig
): PreFilterResult {
  const threshold = config.internalRepetitionThreshold ?? 0.7;
  
  const sentences = splitIntoSentences(text);
  
  // Need at least 2 sentences to check for repetition
  if (sentences.length < 2) {
    return {
      shouldSkip: false,
      needsDeduplication: false,
      wasCleaned: false,
      internalRepetitionScore: 0.0,
    };
  }
  
  // Check each sentence against all other sentences in the chunk
  let maxSimilarity = 0.0;
  
  for (let i = 0; i < sentences.length; i++) {
    for (let j = i + 1; j < sentences.length; j++) {
      const similarity = calculateSimilarity(sentences[i], sentences[j]);
      maxSimilarity = Math.max(maxSimilarity, similarity);
      
      if (similarity >= threshold) {
        return {
          shouldSkip: false,
          needsDeduplication: true,
          wasCleaned: false,
          reason: 'internal_repetition',
          internalRepetitionScore: similarity,
        };
      }
    }
  }
  
  return {
    shouldSkip: false,
    needsDeduplication: false,
    wasCleaned: false,
    internalRepetitionScore: maxSimilarity,
  };
}

/**
 * Check if text is similar to recent chunks using fuzzball.js fuzzy matching
 * 
 * Uses token_set_ratio which handles word reordering and partial duplicates.
 * If similarity >= threshold, LLM deduplication should be called.
 * 
 * @param text Text chunk to check
 * @param recentChunks Array of recent chunks to compare against
 * @param config Pre-filter configuration
 * @returns Pre-filter result with similarity score
 */
function checkSimilarity(
  text: string,
  recentChunks: string[],
  config: PreFilterConfig
): PreFilterResult {
  const threshold = config.similarityThreshold ?? 0.75;
  
  if (recentChunks.length === 0) {
    return {
      shouldSkip: false,
      needsDeduplication: false,
      wasCleaned: false,
      similarityScore: 0.0,
    };
  }
  
  if (!text.trim()) {
    return {
      shouldSkip: false,
      needsDeduplication: false,
      wasCleaned: false,
      similarityScore: 0.0,
    };
  }
  
  let maxSimilarity = 0.0;
  
  // Check against all recent chunks using fuzzball.js
  for (const recentChunk of recentChunks) {
    if (!recentChunk.trim()) {
      continue;
    }
    
    const similarity = calculateSimilarity(text, recentChunk);
    maxSimilarity = Math.max(maxSimilarity, similarity);
    
    if (similarity >= threshold) {
      return {
        shouldSkip: false,
        needsDeduplication: true,
        wasCleaned: false,
        reason: 'similarity',
        similarityScore: similarity,
      };
    }
  }
  
  return {
    shouldSkip: false,
    needsDeduplication: false,
    wasCleaned: false,
    similarityScore: maxSimilarity,
  };
}

/**
 * Pre-filter a text chunk using algorithmic checks
 * 
 * Performs fast algorithmic checks to determine if LLM deduplication is needed:
 * 1. Pattern detection (whitespace, dots, repeated characters) → skip immediately
 * 2. Similarity detection (between chunks) → if HIGH similarity, call LLM
 * 3. Internal repetition detection (within chunk) → if detected, call LLM
 * 
 * @param text Text chunk to pre-filter
 * @param recentChunks Recent chunks for similarity comparison
 * @param config Pre-filter configuration
 * @returns Pre-filter result
 */
export function preFilter(
  text: string,
  recentChunks: string[],
  config: PreFilterConfig = {}
): PreFilterResult {
  // First check for pattern issues and clean them (fastest check)
  const patternResult = checkPatterns(text, config);
  const textToProcess = patternResult.wasCleaned ? patternResult.cleanedText! : text;
  
  // If text was cleaned but is now empty, skip it
  if (patternResult.shouldSkip) {
    return {
      ...patternResult,
      needsDeduplication: false,
    };
  }
  
  // Check for internal repetition within the chunk (use cleaned text if available)
  const internalRepetitionResult = checkInternalRepetition(textToProcess, config);
  if (internalRepetitionResult.needsDeduplication) {
    return {
      ...internalRepetitionResult,
      cleanedText: patternResult.wasCleaned ? textToProcess : undefined,
      wasCleaned: patternResult.wasCleaned,
    };
  }
  
  // Check similarity against recent chunks (use cleaned text if available)
  const similarityResult = checkSimilarity(textToProcess, recentChunks, config);
  if (similarityResult.needsDeduplication) {
    return {
      ...similarityResult,
      cleanedText: patternResult.wasCleaned ? textToProcess : undefined,
      wasCleaned: patternResult.wasCleaned,
    };
  }
  
  // Text passed all pre-filter checks - no deduplication needed
  return {
    shouldSkip: false,
    needsDeduplication: false,
    cleanedText: patternResult.wasCleaned ? textToProcess : undefined,
    wasCleaned: patternResult.wasCleaned,
    similarityScore: similarityResult.similarityScore,
    internalRepetitionScore: internalRepetitionResult.internalRepetitionScore,
  };
}
