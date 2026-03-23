/**
 * Text Utilities
 * 
 * Text processing utilities for session handling.
 */

/**
 * Normalize spoken text for duplicate detection.
 * Collapses whitespace and lowercases so we can detect repeated sentences.
 */
export function normalizeSpokenText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Text deduplicator using a sliding window approach
 */
export class TextDeduplicator {
  private recentChunks: string[] = [];
  private readonly windowSize: number;
  
  constructor(windowSize = 5) {
    this.windowSize = windowSize;
  }
  
  /**
   * Check if text is a duplicate of recent chunks
   */
  isDuplicate(text: string): boolean {
    const normalized = normalizeSpokenText(text);
    return this.recentChunks.includes(normalized);
  }
  
  /**
   * Add text to the recent chunks window
   */
  add(text: string): void {
    const normalized = normalizeSpokenText(text);
    this.recentChunks.push(normalized);
    if (this.recentChunks.length > this.windowSize) {
      this.recentChunks.shift();
    }
  }
  
  /**
   * Clear the recent chunks window
   */
  clear(): void {
    this.recentChunks = [];
  }
}
