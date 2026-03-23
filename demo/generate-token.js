#!/usr/bin/env node
/**
 * Generate Ephemeral Token
 * 
 * Generates an ephemeral token for testing the voice agent.
 * 
 * To switch between configurations, uncomment the desired config and
 * comment out the others.
 */

// Read API_KEY from parent .env
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const apiKeyMatch = envContent.match(/^API_KEY=(.+)$/m);

if (!apiKeyMatch) {
  console.error('❌ API_KEY not found in .env file');
  process.exit(1);
}

const API_KEY = apiKeyMatch[1];

// ============================================================================
// Server Configuration
// To switch between configurations, uncomment the desired config block
// and comment out the others.
// ============================================================================

// ACTIVE CONFIG: Localhost Wrangler (Cloudflare Workers local development)
const API_BASE_URL = 'http://localhost:8787';

// CONFIG OPTION 2: Localhost Bun Server (original development server)
// const API_BASE_URL = 'http://localhost:3001';

// CONFIG OPTION 3: Self-Hosted Server (configure your own)
// const API_BASE_URL = 'https://your-engine.example.com';

// ============================================================================

async function generateToken() {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/realtime/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Failed to generate token:', error);
      process.exit(1);
    }

    const data = await response.json();
    console.log('\n✅ Ephemeral Token Generated!\n');
    console.log('Token:', data.client_secret.value);
    console.log('Expires at:', new Date(data.client_secret.expires_at * 1000).toLocaleString());
    console.log('\nCopy this token and paste it when connecting to the voice agent.\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

generateToken();
