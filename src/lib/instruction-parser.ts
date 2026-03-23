/**
 * Instruction Parser
 * 
 * Parses combined instructions from client library and separates them for main/subagent.
 * 
 * Client library sends instructions with tags:
 * - <<main_instructions>...</main_instructions>
 * - <<tool_instructions>...</tool_instructions>
 * 
 * This function is called EVERY TIME session.update is called with instructions,
 * allowing clients to update instructions mid-conversation.
 */

import { getEventSystem, EventCategory } from '../events';

/**
 * Parse combined instructions and separate for main/subagent
 * 
 * Client library sends instructions with tags:
 * - <<main_instructions>...</main_instructions>
 * - <<tool_instructions>...</tool_instructions>
 * 
 * This function is called EVERY TIME session.update is called with instructions,
 * allowing clients to update instructions mid-conversation.
 * 
 * When subagent mode disabled, return all instructions for main agent.
 * 
 * @param combinedInstructions - Combined instructions from client
 * @param subagentMode - Whether subagent mode is enabled
 * @returns Separated instructions
 */
export function parseInstructions(
  combinedInstructions: string | undefined,
  subagentMode: boolean
): { mainInstructions: string; toolInstructions: string } {
  if (!combinedInstructions || combinedInstructions.trim().length === 0) {
    return { mainInstructions: '', toolInstructions: '' };
  }
  
  // If subagent mode disabled, return all instructions for main agent
  if (!subagentMode) {
    // Strip tags if present (for backward compatibility)
    const cleaned = combinedInstructions
      .replace(/<<main_instructions>/gi, '')
      .replace(/<\/main_instructions>/gi, '')
      .replace(/<<tool_instructions>/gi, '')
      .replace(/<\/tool_instructions>/gi, '')
      .trim();
    return { mainInstructions: cleaned, toolInstructions: '' };
  }
  
  // Parse tags in subagent mode
  const mainMatch = combinedInstructions.match(/<<main_instructions>([\s\S]*?)<\/main_instructions>/i);
  const toolMatch = combinedInstructions.match(/<<tool_instructions>([\s\S]*?)<\/tool_instructions>/i);
  
  const mainInstructions = mainMatch ? mainMatch[1].trim() : '';
  const toolInstructions = toolMatch ? toolMatch[1].trim() : '';
  
  // If no tags found but subagent mode enabled, treat all as main instructions
  // (backward compatibility - client may not have updated)
  if (!mainMatch && !toolMatch) {
    getEventSystem().warn(EventCategory.SESSION, 
      `⚠️ [InstructionParser] No instruction tags found in subagent mode, treating all as main instructions`);
    return { mainInstructions: combinedInstructions.trim(), toolInstructions: '' };
  }
  
  return { mainInstructions, toolInstructions };
}
