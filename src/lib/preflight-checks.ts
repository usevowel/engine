import { getEventSystem, EventCategory } from '../events';
/**
 * Preflight Checks - Validate provider credentials and credit balance before session starts
 * 
 * Performs early validation to catch issues like:
 * - Insufficient credits
 * - Invalid API keys
 * - Account suspended/banned
 * - Rate limits
 * 
 * This prevents wasting time establishing a session that will fail on first generation attempt.
 */

/**
 * Minimum credit balance threshold (in USD)
 * Sessions will fail if balance is below this amount
 */
const MIN_CREDIT_BALANCE = 0.30; // 30 cents

/**
 * Result of a preflight check
 */
export interface PreflightCheckResult {
  success: boolean;
  provider: string;
  errorType?: string;
  errorMessage?: string;
  balance?: number; // Current balance in USD (if available)
}

/**
 * Check OpenRouter API key validity and credit balance
 * 
 * @param apiKey - OpenRouter API key
 * @returns Preflight check result
 */
export async function checkOpenRouterCredits(apiKey: string): Promise<PreflightCheckResult> {
  try {
    // Check credits using OpenRouter API
    const response = await fetch('https://openrouter.ai/api/v1/credits', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      
      // Parse error if JSON
      let errorData: any;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: { message: errorText } };
      }
      
      if (response.status === 401) {
        return {
          success: false,
          provider: 'openrouter',
          errorType: 'authentication_error',
          errorMessage: 'Invalid API key. Please check your OpenRouter API key.',
        };
      }
      
      if (response.status === 403) {
        return {
          success: false,
          provider: 'openrouter',
          errorType: 'account_suspended',
          errorMessage: errorData.error?.message || 'Account access denied. Please contact OpenRouter support.',
        };
      }
      
      return {
        success: false,
        provider: 'openrouter',
        errorType: 'unknown_error',
        errorMessage: errorData.error?.message || `API error: ${response.status}`,
      };
    }
    
    const data = await response.json();
    
    // Calculate remaining balance
    // OpenRouter returns: { data: { total_credits: number, total_usage: number } }
    const totalCredits = data.data?.total_credits || 0;
    const totalUsage = data.data?.total_usage || 0;
    const remainingBalance = totalCredits - totalUsage;
    
    getEventSystem().info(EventCategory.PROVIDER, `💳 [OpenRouter Preflight] Balance: $${remainingBalance.toFixed(2)} (${totalCredits.toFixed(2)} total - ${totalUsage.toFixed(2)} used)`);
    
    // Check if balance is sufficient
    if (remainingBalance < MIN_CREDIT_BALANCE) {
      return {
        success: false,
        provider: 'openrouter',
        errorType: 'insufficient_credits',
        errorMessage: `Insufficient credits. Current balance: $${remainingBalance.toFixed(2)}. Minimum required: $${MIN_CREDIT_BALANCE.toFixed(2)}. Please add credits to your OpenRouter account.`,
        balance: remainingBalance,
      };
    }
    
    return {
      success: true,
      provider: 'openrouter',
      balance: remainingBalance,
    };
    
  } catch (error) {
    getEventSystem().error(EventCategory.PROVIDER, '❌ [OpenRouter Preflight] Failed to check credits:', error);
    
    return {
      success: false,
      provider: 'openrouter',
      errorType: 'check_failed',
      errorMessage: `Failed to verify credits: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Check Groq API key validity
 * 
 * Note: Groq does not provide a credits/quota endpoint.
 * This performs a minimal test request to verify the API key is valid.
 * 
 * @param apiKey - Groq API key
 * @param model - Model to test with (default: llama-3.3-70b-versatile)
 * @returns Preflight check result
 */
export async function checkGroqApiKey(
  apiKey: string,
  model: string = 'llama-3.3-70b-versatile'
): Promise<PreflightCheckResult> {
  try {
    // Make a minimal test request (1 token) to verify API key
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      
      // Parse error if JSON
      let errorData: any;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: { message: errorText } };
      }
      
      if (response.status === 401) {
        return {
          success: false,
          provider: 'groq',
          errorType: 'authentication_error',
          errorMessage: 'Invalid API key. Please check your Groq API key.',
        };
      }
      
      if (response.status === 403) {
        return {
          success: false,
          provider: 'groq',
          errorType: 'account_suspended',
          errorMessage: errorData.error?.message || 'Account access denied. Please contact Groq support.',
        };
      }
      
      if (response.status === 429) {
        return {
          success: false,
          provider: 'groq',
          errorType: 'rate_limit_exceeded',
          errorMessage: errorData.error?.message || 'Rate limit exceeded. Please try again later.',
        };
      }
      
      return {
        success: false,
        provider: 'groq',
        errorType: 'unknown_error',
        errorMessage: errorData.error?.message || `API error: ${response.status}`,
      };
    }
    
    getEventSystem().info(EventCategory.PROVIDER, '✅ [Groq Preflight] API key valid');
    
    return {
      success: true,
      provider: 'groq',
    };
    
  } catch (error) {
    getEventSystem().error(EventCategory.PROVIDER, '❌ [Groq Preflight] Failed to check API key:', error);
    
    return {
      success: false,
      provider: 'groq',
      errorType: 'check_failed',
      errorMessage: `Failed to verify API key: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Check Cerebras API key validity
 * 
 * Note: Cerebras does not provide a credits/quota endpoint.
 * This performs a minimal test request to verify the API key is valid.
 * 
 * @param apiKey - Cerebras API key
 * @param model - Model to test with (default: llama-3.3-70b)
 * @returns Preflight check result
 */
export async function checkCerebrasApiKey(
  apiKey: string,
  model: string = 'llama-3.3-70b'
): Promise<PreflightCheckResult> {
  try {
    // Make a minimal test request (1 token) to verify API key
    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      
      // Parse error if JSON
      let errorData: any;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: { message: errorText } };
      }
      
      if (response.status === 401) {
        return {
          success: false,
          provider: 'cerebras',
          errorType: 'authentication_error',
          errorMessage: 'Invalid API key. Please check your Cerebras API key.',
        };
      }
      
      if (response.status === 403) {
        return {
          success: false,
          provider: 'cerebras',
          errorType: 'account_suspended',
          errorMessage: errorData.error?.message || 'Account access denied. Please contact Cerebras support.',
        };
      }
      
      if (response.status === 429) {
        return {
          success: false,
          provider: 'cerebras',
          errorType: 'rate_limit_exceeded',
          errorMessage: errorData.error?.message || 'Rate limit exceeded. Please try again later.',
        };
      }
      
      return {
        success: false,
        provider: 'cerebras',
        errorType: 'unknown_error',
        errorMessage: errorData.error?.message || `API error: ${response.status}`,
      };
    }
    
    getEventSystem().info(EventCategory.AUTH, '✅ [Cerebras Preflight] API key valid');
    
    return {
      success: true,
      provider: 'cerebras',
    };
    
  } catch (error) {
    getEventSystem().error(EventCategory.AUTH, '❌ [Cerebras Preflight] Failed to check API key:', error);
    
    return {
      success: false,
      provider: 'cerebras',
      errorType: 'check_failed',
      errorMessage: `Failed to verify API key: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Run preflight checks for a provider
 * 
 * @param provider - Provider name ('groq', 'openrouter', 'cerebras')
 * @param apiKey - API key to check
 * @param model - Optional model to test with
 * @returns Preflight check result
 */
export async function runPreflightCheck(
  provider: 'groq' | 'openrouter' | 'cerebras',
  apiKey: string,
  model?: string
): Promise<PreflightCheckResult> {
  getEventSystem().debug(EventCategory.PROVIDER, `🔍 [Preflight] Checking ${provider} credentials...`);
  
  switch (provider) {
    case 'openrouter':
      return await checkOpenRouterCredits(apiKey);
    
    case 'groq':
      return await checkGroqApiKey(apiKey, model);
    
    case 'cerebras':
      return await checkCerebrasApiKey(apiKey, model);
    
    default:
      return {
        success: false,
        provider,
        errorType: 'unsupported_provider',
        errorMessage: `Preflight checks not implemented for provider: ${provider}`,
      };
  }
}

