/**
 * TurnDetectionService - Interface for LLM-based turn completion detection
 * 
 * This service uses a small, fast LLM to intelligently determine if a user's
 * conversational turn is complete. It analyzes the transcript for:
 * - Grammatical completeness
 * - Trailing words suggesting continuation (and, but, um, etc.)
 * - Context clues about speaker intent
 * 
 * Implementations:
 * - GroqTurnDetection: Uses Groq's fast inference (Llama 3.1 8B)
 * - OpenRouterTurnDetection: Uses OpenRouter for model flexibility
 */

/**
 * Turn detection service interface
 */
export interface TurnDetectionService {
  /**
   * Check if the accumulated transcript represents a complete turn
   * 
   * @param transcript - The accumulated speech transcript
   * @returns true if turn is complete, false if incomplete
   * @throws Error if LLM call fails (caller should fall back to timeout)
   */
  checkTurnComplete(transcript: string): Promise<boolean>;
}

/**
 * System prompt for turn detection LLM
 * 
 * This prompt is carefully crafted to:
 * - Provide clear examples of complete vs incomplete turns
 * - Focus on grammatical and contextual clues
 * - Return only "true" or "false" for easy parsing
 */
export const TURN_DETECTION_PROMPT = `You are analyzing speech transcripts to detect if a speaker has finished their turn in a conversation.

A turn is COMPLETE when:
- The speaker has finished a complete thought or sentence
- The statement is grammatically complete
- No trailing words suggest continuation
- The speaker appears ready for a response

A turn is INCOMPLETE when:
- Ends with conjunctions (and, but, or, so, because)
- Ends with prepositions (at, in, on, with, to)
- Ends with hesitation (um, uh, er, like)
- Ends with articles (a, an, the)
- The thought is clearly unfinished
- Mid-sentence or mid-phrase

Examples:
COMPLETE:
- "My name is John Smith" → true
- "I live in New York" → true
- "The number is five five five one two three four" → true
- "Yes" → true
- "No thanks" → true

INCOMPLETE:
- "My name is John and" → false
- "I live in" → false
- "The number is um" → false
- "I need to" → false
- "Five five five" → false (partial phone number)
- "I think so" → false (may continue)

Transcript: "{transcript}"

Respond with ONLY "true" or "false".`;

