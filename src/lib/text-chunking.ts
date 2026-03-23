/**
 * Text Chunking Utilities
 * 
 * Utilities for chunking text into TTS-friendly segments.
 */

/**
 * Chunk text by sentences for streaming TTS.
 * This function accumulates text and yields complete sentences or clauses
 * to enable real-time TTS while the LLM is still generating.
 */
export class TextChunker {
  private buffer = '';
  private sentenceEndRegex = /[.!?]+[\s\n]/g;
  private clauseEndRegex = /[,;:][\s\n]/g;
  private minChunkLength = 15; // Minimum characters before yielding (reduced for faster streaming)
  private maxBufferLength = 80; // Maximum buffer before forcing yield (reduced for faster streaming)

  /**
   * Add text to the buffer and yield complete chunks
   * 
   * @param text Text to add to buffer
   * @returns Array of complete chunks ready for TTS
   */
  addText(text: string): string[] {
    this.buffer += text;
    return this.extractChunks();
  }

  /**
   * Flush remaining buffer (call at end of stream)
   * 
   * @returns Final chunk(s)
   */
  flush(): string[] {
    if (this.buffer.trim().length > 0) {
      const chunk = this.buffer.trim();
      this.buffer = '';
      return [chunk];
    }
    return [];
  }

  /**
   * Extract complete chunks from buffer
   */
  private extractChunks(): string[] {
    const chunks: string[] = [];

    // Try to find sentence boundaries
    let lastSentenceEnd = -1;
    const sentenceMatches = Array.from(this.buffer.matchAll(this.sentenceEndRegex));
    
    for (const match of sentenceMatches) {
      const endPos = match.index! + match[0].length;
      if (endPos >= this.minChunkLength) {
        lastSentenceEnd = endPos;
      }
    }

    // If we found a sentence boundary, yield up to that point
    if (lastSentenceEnd > 0) {
      chunks.push(this.buffer.substring(0, lastSentenceEnd).trim());
      this.buffer = this.buffer.substring(lastSentenceEnd);
      return chunks;
    }

    // If buffer is getting too long, try clause boundaries
    if (this.buffer.length >= this.maxBufferLength) {
      let lastClauseEnd = -1;
      const clauseMatches = Array.from(this.buffer.matchAll(this.clauseEndRegex));
      
      for (const match of clauseMatches) {
        const endPos = match.index! + match[0].length;
        if (endPos >= this.minChunkLength) {
          lastClauseEnd = endPos;
        }
      }

      if (lastClauseEnd > 0) {
        chunks.push(this.buffer.substring(0, lastClauseEnd).trim());
        this.buffer = this.buffer.substring(lastClauseEnd);
        return chunks;
      }

      // Force yield if buffer is too long
      if (this.buffer.length >= this.maxBufferLength * 1.5) {
        // Find last space
        const lastSpace = this.buffer.lastIndexOf(' ', this.maxBufferLength);
        if (lastSpace > this.minChunkLength) {
          chunks.push(this.buffer.substring(0, lastSpace).trim());
          this.buffer = this.buffer.substring(lastSpace + 1);
          return chunks;
        }
      }
    }

    return chunks;
  }

  /**
   * Reset the chunker
   */
  reset(): void {
    this.buffer = '';
  }
}

