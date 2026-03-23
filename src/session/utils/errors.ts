/**
 * Error Utilities
 * 
 * Error detection and sending utilities for session handling.
 */

import { ServerWebSocket } from 'bun';
import { generateEventId } from '../../lib/protocol';
import type { SessionData } from '../types';

/**
 * Detect if an error is a fatal LLM provider error that should close the connection
 * 
 * Uses a WHITELIST approach: Only explicitly recoverable errors are non-fatal.
 * Everything else defaults to FATAL for safety.
 * 
 * Recoverable (non-fatal) errors:
 * - Tool call errors (client-side tool execution failures that can be retried)
 * - Tool validation errors (schema mismatches that can be corrected)
 * 
 * Fatal errors (default):
 * - All HTTP error status codes (401, 402, 403, 429, etc.)
 * - Authentication/API key errors
 * - Insufficient credits
 * - Rate limit exceeded
 * - Account suspended/banned
 * - Model not found/unavailable
 * - Any unknown error (safe default)
 * 
 * @param error - The error object to check
 * @param response - Optional HTTP response object (for direct API calls)
 * @returns Object with isFatal flag and error details
 */
export function detectFatalLLMError(
  error: any,
  response?: Response
): { isFatal: boolean; errorType: string; message: string } {
  // Extract error message, handling error-like objects that may have a message property
  let errorMessage: string;
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === 'object' && error !== null && 'message' in error) {
    errorMessage = String(error.message);
  } else {
    try {
      errorMessage = JSON.stringify(error);
    } catch {
      errorMessage = String(error);
    }
  }
  const lowerMessage = errorMessage.toLowerCase();
  
  // ============================================
  // WHITELIST: Recoverable errors (non-fatal)
  // ============================================
  
  // Tool call errors - recoverable (client can retry with corrected parameters)
  if (
    lowerMessage.includes('tool call') ||
    lowerMessage.includes('tool execution') ||
    lowerMessage.includes('function call') ||
    lowerMessage.includes('tool call validation') ||
    lowerMessage.includes('did not match schema') ||
    (lowerMessage.includes('expected') && lowerMessage.includes('but got null')) ||
    lowerMessage.includes('missing properties') ||
    lowerMessage.includes('additionalProperties') ||
    lowerMessage.includes('InvalidToolInputError') ||
    lowerMessage.includes('invalid json input for tool') ||
    lowerMessage.includes('an error occurred while running the tool')
  ) {
    return {
      isFatal: false,
      errorType: 'tool_error',
      message: errorMessage,
    };
  }
  
  // ============================================
  // FATAL ERRORS (default - everything else)
  // ============================================
  
  // Check HTTP status codes first (most reliable indicator)
  const statusCode = response?.status || error?.status || error?.response?.status;
  
  if (statusCode === 402) {
    return {
      isFatal: true,
      errorType: 'insufficient_credits',
      message: 'Insufficient credits. Please add credits to your account to continue.',
    };
  }
  
  if (statusCode === 401) {
    return {
      isFatal: true,
      errorType: 'authentication_error',
      message: 'Authentication failed. Please check your API key.',
    };
  }
  
  if (statusCode === 429) {
    return {
      isFatal: true,
      errorType: 'rate_limit_exceeded',
      message: 'Rate limit exceeded. Please try again later.',
    };
  }
  
  if (statusCode === 403) {
    return {
      isFatal: true,
      errorType: 'account_suspended',
      message: 'Account access denied. Please contact support.',
    };
  }
  
  // Check for credit-related errors
  if (
    lowerMessage.includes('insufficient credits') ||
    lowerMessage.includes('payment required') ||
    lowerMessage.includes('402') ||
    lowerMessage.includes('insufficient balance') ||
    lowerMessage.includes('credit balance') ||
    lowerMessage.includes('not enough credits')
  ) {
    return {
      isFatal: true,
      errorType: 'insufficient_credits',
      message: 'Insufficient credits. Please add credits to your account to continue.',
    };
  }
  
  // Check for authentication errors
  if (
    lowerMessage.includes('api key') ||
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('authentication') ||
    lowerMessage.includes('invalid key') ||
    lowerMessage.includes('wrong api key') ||
    lowerMessage.includes('401') ||
    (lowerMessage.includes('invalid') && lowerMessage.includes('key'))
  ) {
    return {
      isFatal: true,
      errorType: 'authentication_error',
      message: 'Authentication failed. Please check your API key.',
    };
  }
  
  // Check for rate limit/quota errors
  if (
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('quota exceeded') ||
    lowerMessage.includes('429') ||
    lowerMessage.includes('too many requests')
  ) {
    return {
      isFatal: true,
      errorType: 'rate_limit_exceeded',
      message: 'Rate limit exceeded. Please try again later.',
    };
  }
  
  // Check for account suspension/banned
  if (
    lowerMessage.includes('account suspended') ||
    lowerMessage.includes('account banned') ||
    lowerMessage.includes('access denied') ||
    lowerMessage.includes('forbidden') ||
    lowerMessage.includes('403')
  ) {
    return {
      isFatal: true,
      errorType: 'account_suspended',
      message: 'Account access denied. Please contact support.',
    };
  }
  
  // Check for model not found or access denied errors
  if (
    lowerMessage.includes('does not exist') ||
    lowerMessage.includes('does not have access') ||
    lowerMessage.includes('model not found') ||
    lowerMessage.includes('model unavailable') ||
    lowerMessage.includes('invalid model') ||
    (lowerMessage.includes('model') && lowerMessage.includes('not available'))
  ) {
    return {
      isFatal: true,
      errorType: 'model_error',
      message: errorMessage || 'The requested model is not available or you do not have access to it.',
    };
  }
  
  // ============================================
  // DEFAULT: Unknown errors are FATAL (safe default)
  // ============================================
  // This ensures new error types don't slip through as non-fatal
  return {
    isFatal: true,
    errorType: 'server_error',
    message: errorMessage || 'An unexpected error occurred.',
  };
}

/**
 * Send error event with full details
 */
export function sendStructuredError(
  ws: ServerWebSocket<SessionData>,
  errorType: string,
  message: string,
  code?: string,
  param?: string
): void {
  const payload: Record<string, unknown> = {
    type: 'error',
    event_id: generateEventId(),
    error: {
      type: errorType,
      message,
    },
  };
  if (code) (payload.error as Record<string, unknown>).code = code;
  if (param) (payload.error as Record<string, unknown>).param = param;
  ws.send(JSON.stringify(payload));
}

/**
 * Send error event
 */
export function sendError(ws: ServerWebSocket<SessionData>, errorType: string, message: string): void {
  sendStructuredError(ws, errorType, message);
}
