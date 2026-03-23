/**
 * Text Utilities
 * 
 * Utility functions for text processing, especially for TTS preparation.
 */

/**
 * Strips markdown formatting symbols from text to make it TTS-friendly.
 * 
 * Removes common markdown symbols that TTS engines might speak as words:
 * - Asterisks (*, **) for bold/italic
 * - Underscores (_, __) for italic/bold
 * - Backticks (`) for code
 * - Hashtags (#) for headers
 * - Brackets ([], ()) for links
 * - Other markdown symbols (~, >, etc.)
 * 
 * @param text - Text that may contain markdown symbols
 * @returns Text with markdown symbols removed
 * 
 * @example
 * ```typescript
 * stripMarkdown("*Hello* world") // "Hello world"
 * stripMarkdown("**Bold** text") // "Bold text"
 * stripMarkdown("`code` example") // "code example"
 * ```
 */
export function stripMarkdown(text: string): string {
  if (!text) return text;
  
  return text
    // Remove code blocks first (they may contain markdown symbols)
    .replace(/```[\s\S]*?```/g, '')    // ```code blocks```
    // Remove inline code but preserve content
    .replace(/`([^`]+)`/g, '$1')       // `inline code`
    // Remove links [text](url) and [text][ref] - preserve link text
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // [text](url)
    .replace(/\[([^\]]+)\]\[[^\]]+\]/g, '$1') // [text][ref]
    // Remove images ![alt](url) - preserve alt text
    .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '$1')
    // Remove markdown headers (# ## ### etc.)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic markers - handle nested cases by removing pairs iteratively
    // Use a more aggressive approach: remove all markdown symbols
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **bold** (non-nested)
    .replace(/\*([^*\n]+?)\*/g, '$1')  // *italic* (non-nested, non-greedy)
    .replace(/__([^_]+)__/g, '$1')     // __bold__
    .replace(/_([^_\n]+?)_/g, '$1')   // _italic_ (non-nested, non-greedy)
    // Remove strikethrough
    .replace(/~~([^~]+)~~/g, '$1')     // ~~strikethrough~~
    // Remove blockquote markers
    .replace(/^>\s+/gm, '')            // > blockquote
    // Remove horizontal rules
    .replace(/^[-*_]{3,}$/gm, '')      // --- or *** or ___
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, '')  // - * + list items
    .replace(/^[\s]*\d+\.\s+/gm, '')   // 1. numbered lists
    // Remove any remaining standalone markdown symbols
    .replace(/\*+/g, '')               // Any remaining asterisks
    .replace(/_+/g, '')                // Any remaining underscores
    .replace(/~+/g, '')                // Any remaining tildes
    .replace(/#+/g, '')                // Any remaining hashtags
    // Clean up extra whitespace
    .replace(/\s+/g, ' ')               // Multiple spaces to single
    .trim();
}

