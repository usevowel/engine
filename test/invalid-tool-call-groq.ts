/**
 * Script: invalid-tool-call-groq.ts
 *
 * Purpose: Test correct and incorrect tool calls against Groq GPT-OSS 120B
 * using the Vercel AI SDK Agent class with streaming and error handling.
 *
 * This script:
 * 1. Calls the tool correctly (city="New York", unit="f")
 * 2. Calls the tool incorrectly (town=123, wrong arg name and type)
 * 3. Handles errors gracefully using stream error parts (error, tool-error)
 * 4. Retries with preserved context if stream crashes
 * 5. Asks the LLM to summarize both results and any errors
 *
 * Error Handling:
 * - Uses streaming mode to catch errors as stream parts
 * - Handles 'error' and 'tool-error' parts without stopping
 * - Retries up to 3 times with preserved conversation context if stream crashes
 * - Continues until completion to get final results
 *
 * How to run (from repo root):
 *   bun run tsx engines/sndbrd/test/invalid-tool-call-groq.ts
 *
 * VS Code debug tip:
 * - Set breakpoints in the stream processing loop to inspect error handling.
 * - Use the Node debugger (Bun supports --inspect).
 */

import { Experimental_Agent as Agent, tool, stepCountIs, generateObject, NoSuchToolError, CoreMessage } from 'ai';
import { z } from 'zod';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { getProvider } from '../src/services/providers/llm';

async function loadDevVarsIfNeeded() {
  if (process.env.GROQ_API_KEY) return;
  const devVarsPath = resolve(__dirname, '../.dev.vars');
  try {
    const raw = await readFile(devVarsPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
    console.log(`🔑 Loaded env from ${devVarsPath}`);
  } catch (err) {
    console.warn(`⚠️ Could not load ${devVarsPath}:`, err instanceof Error ? err.message : err);
  }
}

async function main() {
  await loadDevVarsIfNeeded();

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('Set GROQ_API_KEY before running this script.');
  }

  // Provider + model (explicitly use GPT-OSS 120B)
  const groq = getProvider('groq', { apiKey });
  const model = groq('openai/gpt-oss-120b');

  // Define a strict tool schema with error handling
  // The execute function validates internally and returns error results instead of throwing
  const tools = {
    getWeather: tool({
      name: 'getWeather',
      description: 'Get the weather for a city',
      inputSchema: z.object({
        city: z.string().describe('City name'),
        unit: z.enum(['c', 'f']).default('c'),
      }),
      
      // Wrap execute to catch errors and return structured error results
      execute: async (args: any) => {
        try {
          // Check if this is a repair-failed call (from experimental_repairToolCall)
          // The repair handler sets city to '__REPAIR_FAILED__' when repair fails
          if (args.city === '__REPAIR_FAILED__') {
            console.log(`❌ [Tool] Repair failed, returning error result`);
            return {
              error: true,
              message: 'Tool call validation failed and repair attempt failed',
              originalError: args._originalError,
              received: args._originalInput || args,
            };
          }
          
          // Validate input against schema
          const schema = z.object({
            city: z.string().min(1).describe('City name'),
            unit: z.enum(['c', 'f']).default('c'),
          });
          
          const validated = schema.parse(args);
          
          // Additional semantic validation (e.g., check if city is actually a valid city name)
          // This catches cases where schema validation passes but values are invalid
          if (!validated.city || validated.city.trim().length === 0) {
            return {
              error: true,
              message: 'City name is required and cannot be empty',
              received: args,
            };
          }
          
          // Success case - return normal result
          return { 
            ok: true, 
            city: validated.city, 
            unit: validated.unit, 
            temperature: 72 
          };
        } catch (error) {
          // Error case - return structured error result instead of throwing
          if (error instanceof z.ZodError) {
            console.log(`❌ [Tool] Validation error caught:`, error.issues);
            return {
              error: true,
              message: 'Tool call validation failed',
              details: error.issues.map(issue => ({
                path: issue.path.join('.'),
                message: issue.message,
                code: issue.code,
              })),
              received: args,
            };
          }
          
          // Other errors
          console.log(`❌ [Tool] Execution error caught:`, error);
          return {
            error: true,
            message: error instanceof Error ? error.message : 'Unknown error occurred',
            received: args,
          };
        }
      },
    } as any),
  };

  console.log('🧪 Starting tool-call test against Groq GPT-OSS-120B');
  console.log('   Step 1: Call tool correctly');
  console.log('   Step 2: Call tool incorrectly');
  console.log('   Step 3: Summarize what happened\n');

  // Step 1: Call correctly, then incorrectly, then ask to summarize
  const prompt = `
You will call the tool "getWeather" TWICE:

1. FIRST CALL (correct): Call getWeather with city="New York" and unit="f"
2. SECOND CALL (incorrect): Call getWeather with town=123 (wrong arg name, wrong type) and unit="c"

After both calls complete, summarize:
- What was the result of the first (correct) call?
- What was the result of the second (incorrect) call?
- What errors occurred, if any?
`;

  // Use Agent class for multi-step tool calling support
  const agent = new Agent({
    model,
    system: 'You are a helpful assistant that follows instructions precisely.',
    stopWhen: stepCountIs(5), // Allow up to 5 steps
    tools,
    
    // Handle tool call validation errors gracefully
    // Attempt repair first, but if repair fails, return error result instead of failing
    experimental_repairToolCall: async ({
      toolCall,
      tools: toolsParam,
      inputSchema,
      error,
    }: any) => {
      console.log(`\n🔧 [Agent] Tool call repair triggered for: ${toolCall.toolName}`);
      console.log(`🔧 [Agent] Error type: ${error?.constructor?.name || typeof error}`);
      console.log(`🔧 [Agent] Error message: ${error?.message || String(error)}`);
      console.log(`🔧 [Agent] Tool call input:`, JSON.stringify(toolCall.input, null, 2));
      
      // Don't attempt to fix invalid tool names
      if (NoSuchToolError.isInstance(error)) {
        console.log(`🔧 [Agent] Invalid tool name, cannot repair: ${toolCall.toolName}`);
        // Return error-handled call instead of null to continue execution
        return {
          ...toolCall,
          input: {
            city: '__REPAIR_FAILED__',
            unit: 'c',
            _originalInput: toolCall.input,
            _originalError: 'Invalid tool name',
          },
        };
      }
      
      try {
        const tool = toolsParam[toolCall.toolName as keyof typeof toolsParam];
        
        if (!tool) {
          throw new Error(`Tool ${toolCall.toolName} not found in tools`);
        }
        
        console.log(`🔧 [Agent] Attempting to repair tool call with structured outputs`);
        
        // Use generateObject with the same model to repair the tool call
        const { object: repairedArgs } = await generateObject({
          model,
          schema: tool.inputSchema,
          prompt: [
            `The model tried to call the tool "${toolCall.toolName}" with the following inputs:`,
            JSON.stringify(toolCall.input),
            `The tool accepts the following schema:`,
            JSON.stringify(inputSchema(toolCall)),
            `The error was: ${error?.message || String(error)}`,
            `Please fix the inputs to match the schema exactly.`,
          ].join('\n'),
        });
        
        console.log(`✅ [Agent] Tool call repaired successfully`);
        console.log(`🔧 [Agent] Repaired input:`, JSON.stringify(repairedArgs, null, 2));
        
        return { ...toolCall, input: repairedArgs };
      } catch (repairError) {
        console.error(`❌ [Agent] Tool call repair failed:`, repairError);
        console.error(`   Repair error details:`, repairError instanceof Error ? repairError.message : String(repairError));
        
        // Instead of returning null (which would fail the tool call),
        // return a "repaired" call with valid schema values but a special marker
        // that execute can detect. This allows execution to continue and return an error result.
        console.log(`🔄 [Agent] Returning error-handled tool call to continue execution`);
        return {
          ...toolCall,
          input: {
            city: '__REPAIR_FAILED__', // Special marker that passes schema validation
            unit: 'c', // Valid default
            _originalInput: toolCall.input, // Preserve original for error reporting
            _originalError: error?.message || String(error),
          },
        };
      }
    },
  });

  // Stream with error handling and retry logic
  const maxRetries = 3;
  let retryCount = 0;
  let conversationHistory: CoreMessage[] = [{ role: 'user', content: prompt }];
  let accumulatedText = '';
  let currentStepText = ''; // Track text for current step
  const toolCalls: Array<{ toolName: string; input: any; result?: any; error?: any; aiResponseAfter?: string }> = [];
  
  while (retryCount <= maxRetries) {
    try {
      console.log(`\n🔄 Starting stream${retryCount > 0 ? ` (retry ${retryCount}/${maxRetries})` : ''}`);
      
      // Reset step text for this attempt
      currentStepText = '';
      
      const streamResult = await agent.stream({
        messages: conversationHistory,
      });
      
      let streamFinished = false;
      let hadError = false;
      let lastToolCallIndex = -1; // Track which tool call we're processing
      let textAfterToolCall = ''; // Accumulate text after each tool call
      
      // Process stream parts with error handling
      // Wrap in try-catch to handle any uncaught errors that might stop the stream
      try {
        for await (const part of streamResult.fullStream) {
          switch (part.type) {
          case 'text-delta':
            // Accumulate text
            const textDelta = part.text || '';
            accumulatedText += textDelta;
            currentStepText += textDelta;
            textAfterToolCall += textDelta; // Also track text after tool calls
            process.stdout.write(textDelta);
            break;
            
          case 'tool-call':
            // Save AI's response to the previous tool call before starting a new one
            if (lastToolCallIndex >= 0 && textAfterToolCall.trim()) {
              const prevCall = toolCalls[lastToolCallIndex];
              if (prevCall) {
                prevCall.aiResponseAfter = textAfterToolCall.trim();
              }
            }
            
            console.log(`\n🔧 [Stream] Tool call: ${part.toolName}`);
            const input = (part as any).input ?? (part as any).args;
            console.log(`   Input:`, JSON.stringify(input, null, 2));
            
            // Reset text accumulator for this tool call
            textAfterToolCall = '';
            lastToolCallIndex = toolCalls.length;
            
            toolCalls.push({
              toolName: part.toolName,
              input,
            });
            break;
            
          case 'tool-result':
            console.log(`\n✅ [Stream] Tool result for: ${part.toolName}`);
            const output = (part as any).result ?? (part as any).output;
            const lastToolCall = toolCalls[lastToolCallIndex];
            if (lastToolCall && lastToolCall.toolName === part.toolName) {
              lastToolCall.result = output;
            }
            console.log(`   Result:`, JSON.stringify(output, null, 2));
            
            // Note: AI's response about this result will come in subsequent text-delta parts
            // We'll capture it when we see the next tool-call or finish
            break;
            
          case 'tool-error':
            console.log(`\n❌ [Stream] Tool error: ${part.toolName}`);
            const error = (part as any).error;
            console.log(`   Error:`, error);
            
            // Add error to tool calls for logging
            const lastCall = toolCalls[lastToolCallIndex];
            if (lastCall && lastCall.toolName === part.toolName) {
              lastCall.error = error;
            }
            
            // Continue processing - don't break on tool errors
            // AI's response about the error will come in subsequent text-delta parts
            hadError = true;
            break;
            
          case 'error':
            console.log(`\n🚨 [Stream] Stream error occurred:`);
            const streamError = (part as any).error;
            console.log(`   Error:`, streamError);
            
            // Check if this is a tool validation error
            // According to Vercel AI SDK docs, these should be converted to tool-error parts
            // but provider-level errors may come through as error parts
            const errorMessage = streamError?.message || String(streamError);
            if (errorMessage.includes('tool call validation') || 
                errorMessage.includes('did not match schema') ||
                errorMessage.includes('missing properties') ||
                errorMessage.includes('additionalProperties') ||
                errorMessage.includes('InvalidToolInputError')) {
              console.log(`   🔍 This is a tool validation error - treating as tool-error`);
              
              // Extract tool name from error message
              // Error format: "parameters for tool getWeather did not match schema"
              const toolMatch = errorMessage.match(/tool\s+(\w+)/i) || 
                               errorMessage.match(/for tool (\w+)/i);
              const toolName = toolMatch ? toolMatch[1] : 'getWeather'; // Default to getWeather based on context
              
              console.log(`   📝 Extracted tool name: ${toolName}`);
              
              // Add as a failed tool call attempt (similar to tool-error handling)
              // Check if we already have this tool call or need to add a new one
              const existingCallIndex = toolCalls.findIndex(tc => 
                tc.toolName === toolName && 
                (tc.input?._validationError || !tc.result)
              );
              
              if (existingCallIndex >= 0) {
                // Update existing call with error
                const existingCall = toolCalls[existingCallIndex];
                existingCall.error = streamError;
                lastToolCallIndex = existingCallIndex;
                console.log(`   ✅ Updated existing tool call [${existingCallIndex + 1}] with error`);
              } else {
                // Add new failed tool call
                toolCalls.push({
                  toolName,
                  input: { 
                    _validationError: true, 
                    _errorMessage: errorMessage,
                    _note: 'This tool call was rejected at provider level before execution'
                  },
                  error: streamError,
                });
                lastToolCallIndex = toolCalls.length - 1;
                textAfterToolCall = ''; // Reset for this failed call
                console.log(`   ✅ Added new failed tool call [${lastToolCallIndex + 1}]`);
              }
              
              // According to Vercel AI SDK docs, tool errors should allow the stream to continue
              // The AI should be able to respond to this error in subsequent steps
              // Don't mark as fatal error - let the stream continue
              hadError = true; // Mark that we had an error, but don't stop
              console.log(`   ⏭️  Continuing stream processing - AI should respond to this error`);
            } else {
              // This is a non-tool stream-level error - might need retry
              console.log(`   ⚠️  Non-tool error - may need retry`);
              hadError = true;
            }
            break;
            
          case 'finish':
            console.log(`\n✅ [Stream] Stream finished`);
            
            // Capture any remaining text after the last tool call
            if (lastToolCallIndex >= 0 && textAfterToolCall.trim()) {
              const lastCall = toolCalls[lastToolCallIndex];
              if (lastCall) {
                lastCall.aiResponseAfter = textAfterToolCall.trim();
              }
            }
            
            // Add assistant's complete response to conversation history
            if (currentStepText.trim()) {
              conversationHistory.push({
                role: 'assistant',
                content: currentStepText.trim(),
              });
            }
            
            streamFinished = true;
            break;
            
          case 'abort':
            console.log(`\n⚠️  [Stream] Stream aborted`);
            hadError = true;
            break;
            
          default:
            // Silently ignore other lifecycle events
            break;
          }
        }
      } catch (streamProcessingError) {
        console.error(`\n❌ [Stream] Error during stream processing:`, streamProcessingError);
        
        // Check if this is a validation error
        const errorMsg = streamProcessingError instanceof Error 
          ? streamProcessingError.message 
          : String(streamProcessingError);
        
        if (errorMsg.includes('tool call validation') || 
            errorMsg.includes('did not match schema') ||
            errorMsg.includes('missing properties') ||
            errorMsg.includes('additionalProperties')) {
          console.log(`   🔍 This is a tool validation error - adding as failed tool call`);
          
          // Add as a failed tool call attempt
          const toolMatch = errorMsg.match(/tool\s+(\w+)/i);
          const toolName = toolMatch ? toolMatch[1] : 'getWeather'; // Default to getWeather
          
          toolCalls.push({
            toolName,
            input: { _validationError: true, _errorMessage: errorMsg },
            error: streamProcessingError,
          });
          lastToolCallIndex = toolCalls.length - 1;
        }
        
        // Mark as finished so we can continue with what we have
        streamFinished = true;
        hadError = true;
      }
      
      // Always break if stream finished (even with errors)
      // The AI SDK should continue processing after tool errors
      if (streamFinished) {
        if (hadError) {
          console.log(`\n⚠️  Stream completed with errors`);
          
          // Check if we had tool validation errors but no AI response
          // According to Vercel AI SDK docs, tool errors should allow the AI to respond
          // If the stream finished without a response, we may need to continue manually
          const hasToolValidationError = toolCalls.some(tc => 
            tc.error && (
              String(tc.error?.message || '').includes('tool call validation') ||
              String(tc.error?.message || '').includes('did not match schema')
            )
          );
          
          if (hasToolValidationError && !accumulatedText.trim() && retryCount < maxRetries) {
            console.log(`\n🔄 Tool validation error occurred but AI didn't respond - continuing conversation`);
            
            // Add the error as a tool-error message to conversation history
            // This mimics what the AI SDK should do automatically
            const failedToolCall = toolCalls.find(tc => tc.error);
            if (failedToolCall) {
              const errorMessage = failedToolCall.error?.message || 'Tool call validation failed';
              const errorCallId = `error-${Date.now()}`;
              
              conversationHistory.push({
                role: 'assistant',
                content: [
                  {
                    type: 'tool-call',
                    toolCallId: errorCallId,
                    toolName: failedToolCall.toolName,
                    input: failedToolCall.input,
                  },
                ],
              });
              conversationHistory.push({
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId: errorCallId,
                    toolName: failedToolCall.toolName,
                    output: {
                      type: 'error-text',
                      value: errorMessage,
                    },
                  },
                ],
              });
              
              // Add continuation prompt
              conversationHistory.push({
                role: 'user',
                content: 'Please continue and complete the task. Summarize what happened with both tool calls.',
              });
              
              // Reset for continuation (not a retry, just continuing the conversation)
              currentStepText = '';
              console.log(`   📝 Added error to conversation history, continuing stream...`);
              // Don't break - continue the while loop to process the continuation
              continue; // This continues the while loop, not the for loop
            }
          }
          
          console.log(`   We have the results: ${accumulatedText.length} chars, ${toolCalls.length} tool calls`);
        }
        break; // Exit the while loop - we're done with this attempt
      }
      
      // If stream didn't finish, it might have crashed - retry
      if (!streamFinished) {
        console.log(`\n⚠️  Stream did not finish properly, will retry...`);
        throw new Error('Stream did not finish properly');
      }
      
    } catch (error) {
      retryCount++;
      console.error(`\n❌ [Stream] Error occurred:`, error);
      
      if (retryCount > maxRetries) {
        console.error(`\n❌ Max retries (${maxRetries}) reached. Stopping.`);
        throw error;
      }
      
      console.log(`\n🔄 Retrying with preserved context (attempt ${retryCount}/${maxRetries})...`);
      
      // Build continuation prompt with accumulated context
      const continuationPrompt = `
Previous conversation:
${conversationHistory.map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n')}

An error occurred. Please continue from where we left off and complete the task.
`;
      
      conversationHistory = [
        ...conversationHistory,
        { role: 'assistant', content: accumulatedText || 'Error occurred, retrying...' },
        { role: 'user', content: continuationPrompt },
      ];
      
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('\n\n' + '='.repeat(80));
  console.log('📋 FINAL ACCUMULATED RESPONSE');
  console.log('='.repeat(80));
  console.log(accumulatedText);
  console.log('='.repeat(80));
  console.log('\n');
  
  // Log all tool calls and their results, highlighting AI's responses about failures
  if (toolCalls.length > 0) {
    console.log('🔧 Tool Calls Summary:');
    console.log('-'.repeat(80));
    
    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      const isFailed = toolCall.error || 
        (toolCall.result && typeof toolCall.result === 'object' && 
         ((toolCall.result as any).error || (toolCall.result as any).type === 'error-json' || 
          (toolCall.result as any).type === 'error-text'));
      
      console.log(`\n[${i + 1}] Tool: ${toolCall.toolName}`);
      console.log(`    Input:`, JSON.stringify(toolCall.input, null, 2));
      
      if (toolCall.error) {
        console.log(`    ❌ Stream Error:`, JSON.stringify(toolCall.error, null, 2));
      } else if (toolCall.result) {
        const result = toolCall.result;
        if (typeof result === 'object' && result !== null) {
          if ((result as any).error || (result as any).type === 'error-json' || (result as any).type === 'error-text') {
            console.log(`    ❌ Error Result:`, JSON.stringify(result, null, 2));
          } else {
            console.log(`    ✅ Result:`, JSON.stringify(result, null, 2));
          }
        } else {
          console.log(`    ✅ Result:`, result);
        }
      } else {
        console.log(`    ⚠️  No result yet`);
      }
      
      // Show what the AI said about this tool call (especially important for failures)
      if (toolCall.aiResponseAfter) {
        if (isFailed) {
          console.log(`\n    💬 AI's Response About This Failed Tool Call:`);
          console.log(`    ${'─'.repeat(76)}`);
        } else {
          console.log(`\n    💬 AI's Response:`);
          console.log(`    ${'─'.repeat(76)}`);
        }
        // Indent the response for readability
        const lines = toolCall.aiResponseAfter.split('\n');
        for (const line of lines) {
          console.log(`    ${line}`);
        }
        console.log(`    ${'─'.repeat(76)}`);
      } else if (isFailed) {
        console.log(`\n    ⚠️  No AI response captured after this failed tool call`);
      }
    }
    
    console.log('\n' + '-'.repeat(80));
    
    // Summary of failures
    const failedCalls = toolCalls.filter(tc => 
      tc.error || 
      (tc.result && typeof tc.result === 'object' && 
       ((tc.result as any).error || (tc.result as any).type === 'error-json' || 
        (tc.result as any).type === 'error-text'))
    );
    
    if (failedCalls.length > 0) {
      console.log(`\n📊 Summary: ${failedCalls.length} out of ${toolCalls.length} tool calls failed`);
      console.log(`   Failed calls: ${failedCalls.map((tc, i) => `[${toolCalls.indexOf(tc) + 1}] ${tc.toolName}`).join(', ')}`);
    } else {
      console.log(`\n📊 Summary: All ${toolCalls.length} tool calls succeeded`);
    }
  } else {
    console.log('⚠️  No tool calls were made');
  }

  console.log('\n✅ Test completed');
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exitCode = 1;
});

