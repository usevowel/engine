/**
 * Response Filter Service Types
 * 
 * Type definitions for the Response Filter Service that uses a secondary LLM
 * to filter duplicates and translate responses.
 */

/**
 * Response Filter Configuration
 */
export interface ResponseFilterConfig {
  /** Enable/disable filtering (default: false) */
  enabled: boolean;
  
  /** Target language code (ISO 639-1, e.g., 'en', 'es', 'fr') */
  targetLanguage?: string;
  
  /** Filter LLM model (default: 'openai/gpt-oss-20b') */
  filterModel?: string;
  
  /** Buffer size in characters before filtering (default: 200) */
  bufferSize?: number;
  
  /** Maximum number of recent chunks to maintain for comparison (default: 10) */
  maxRecentChunks?: number;
  
  /** Filtering mode */
  mode?: 'deduplication' | 'translation' | 'both';
  
  /** System instructions/restrictions to enforce (e.g., "only speak in English", "use Shakespearean language") */
  systemInstructions?: string;
  
  /** Groq API key for filter LLM */
  groqApiKey: string;
  
  /** Last user message text (for language detection during translation) */
  lastUserMessage?: string;
}

/**
 * Filtered text delta result
 */
export interface FilteredTextDelta {
  /** Filtered text delta (empty string if chunk was skipped) */
  delta: string;
  
  /** Whether this chunk was skipped entirely (duplicate detected) */
  skipped: boolean;
  
  /** Whether this delta was modified by the filter */
  modified: boolean;
  
  /** Reason for modification or skipping (if modified/skipped) */
  reason?: 'duplicate' | 'repetition' | 'translation' | 'combined';
}
