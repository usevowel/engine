/**
 * Demo Backend Server
 *
 * Small Express server that handles token generation for the demo.
 * This mimics what a real application backend would do.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT: number = 3081; // Different from main server (3001) and Vite (5173)

// Enable CORS for local development
app.use(cors());
app.use(express.json());

// ============================================================================
// Server Configuration
// Environment configurations - now dynamically selected via request parameter
// ============================================================================

/**
 * Environment configurations
 */
const ENVIRONMENTS: Record<string, string> = {
  localhostWrangler: 'http://localhost:8787',
  localhostBun: 'http://localhost:3001',
  selfHosted: 'https://your-engine.example.com',
};

/**
 * Default environment
 */
const DEFAULT_ENVIRONMENT = 'dev';

/**
 * Get API base URL for an environment
 */
function getApiBaseUrl(environmentId: string, customUrl?: string): string {
  if (environmentId === 'custom' && customUrl) {
    // Remove protocol if present, then add http/https based on input
    const url = customUrl.trim();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    // Default to https if no protocol specified
    return `https://${url}`;
  }
  
  return ENVIRONMENTS[environmentId] || ENVIRONMENTS[DEFAULT_ENVIRONMENT];
}

// ============================================================================

// Read environment variables from .env file via dotenv
const API_KEY: string | undefined = process.env.API_KEY;
const CF_ACCESS_SERVICE_TOKEN: string | undefined = process.env.CF_ACCESS_SERVICE_TOKEN;

// Validate required environment variables
if (!API_KEY) {
  console.error('❌ API_KEY environment variable is required');
  process.exit(1);
} else {
  console.log('✅ API_KEY configured');
}

// Cloudflare Access service token is optional (only needed for protected endpoints)
if (CF_ACCESS_SERVICE_TOKEN) {
  console.log('✅ Cloudflare Access token configured');
} else {
  console.log('⚠️  CF_ACCESS_SERVICE_TOKEN not found (required for staging.prime.vowel.to)');
}

console.log('✅ Configuration loaded');
console.log(`   Default API Server: ${ENVIRONMENTS[DEFAULT_ENVIRONMENT]}`);
console.log('   Environments available:', Object.keys(ENVIRONMENTS).join(', '));

/**
 * Generate ephemeral token
 *
 * This endpoint calls the main server to generate a token.
 * In a real app, this would be behind authentication.
 * 
 * Request body can include:
 * - environment: string (optional) - Environment ID to use
 * - customUrl: string (optional) - Custom base URL (when environment is 'custom')
 * - llmProvider: string (optional) - LLM provider ('groq', 'cerebras', 'openrouter')
 * - model: string (optional) - Model name to use
 */
app.post('/api/token', async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { environment, customUrl, llmProvider, model } = req.body;
    const environmentId = environment || DEFAULT_ENVIRONMENT;
    const apiBaseUrl = getApiBaseUrl(environmentId, customUrl);
    
    // Use provided model or default
    const modelToUse = model || 'openai/gpt-oss-120b';
    
    console.log('📝 Generating ephemeral token...');
    console.log(`   Environment: ${environmentId}`);
    console.log(`   API Server: ${apiBaseUrl}`);
    console.log(`   Provider: ${llmProvider || 'default'}`);
    console.log(`   Model: ${modelToUse}`);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    };

    // Add Cloudflare Access service token if available
    if (CF_ACCESS_SERVICE_TOKEN) {
      headers['CF-Access-Client-Id'] = CF_ACCESS_SERVICE_TOKEN.split('.')[0];
      headers['CF-Access-Client-Secret'] = CF_ACCESS_SERVICE_TOKEN.split('.')[1];
    }

    // Build request body with provider and model
    const requestBody: Record<string, any> = {
      model: modelToUse,
      maxIdleDurationMs: 900000, // 15 minutes for testing
    };
    
    // Add provider if specified
    if (llmProvider) {
      requestBody.llmProvider = llmProvider;
    }

    const response = await fetch(`${apiBaseUrl}/v1/realtime/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    console.log('🔑 Response:', response, CF_ACCESS_SERVICE_TOKEN, headers);

    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Token generation failed:', error);
      res.status(response.status).json(error);
      return;
    }

    const data = await response.json();
    console.log('✅ Token generated successfully');

    res.json(data);

  } catch (error) {
    console.error('❌ Error generating token:', (error as Error).message);
    res.status(500).json({
      error: {
        type: 'server_error',
        message: 'Failed to generate token',
      },
    });
  }
});

/**
 * Health check
 */
app.get('/health', (req: express.Request, res: express.Response): void => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Demo Backend Server running on http://localhost:${PORT}`);
  console.log(`   Token endpoint: http://localhost:${PORT}/api/token\n`);
});

