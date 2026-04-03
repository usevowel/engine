/**
 * Engine Setup Script
 *
 * Validates environment configuration and downloads required dependencies
 * like the Silero VAD model.
 *
 * Usage:
 *   bun run setup
 *
 * This script:
 * 1. Checks required environment variables
 * 2. Downloads the Silero VAD model if needed
 * 3. Validates the configuration
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
};

function log(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
  const icons = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌',
  };

  const colorCodes = {
    info: colors.blue,
    success: colors.green,
    warning: colors.yellow,
    error: colors.red,
  };

  console.log(`${icons[type]} ${colorCodes[type]}${message}${colors.reset}`);
}

/**
 * Check if required environment variables are set
 */
function checkEnvironment(): boolean {
  log('Checking environment configuration...', 'info');

  const required = ['JWT_SECRET'];
  const recommended = ['GROQ_API_KEY', 'OPENROUTER_API_KEY'];

  let hasErrors = false;

  // Check required vars
  for (const key of required) {
    if (!process.env[key]) {
      log(`Missing required environment variable: ${key}`, 'error');
      hasErrors = true;
    }
  }

  // Check recommended vars
  const hasLLMKey = recommended.some(key => process.env[key]);
  if (!hasLLMKey) {
    log('No LLM API key found (GROQ_API_KEY or OPENROUTER_API_KEY)', 'warning');
    log('   Set one to enable LLM functionality', 'warning');
  }

  // Check API_KEY
  if (!process.env.API_KEY) {
    log('Missing API_KEY - clients will not be able to generate tokens', 'warning');
  }

  if (!hasErrors) {
    log('Environment configuration looks good!', 'success');
  }

  return !hasErrors;
}

/**
 * Download the Silero VAD model
 */
async function downloadVADModel(): Promise<boolean> {
  log('Checking Silero VAD model...', 'info');

  const modelPath = join(process.cwd(), 'vendor', 'silero-vad', 'silero_vad.onnx');

  if (existsSync(modelPath)) {
    log('Silero VAD model already exists', 'success');
    return true;
  }

  log('VAD model not found - downloading...', 'warning');

  try {
    const { execSync } = await import('child_process');
    execSync('bun run scripts/download-vad.ts', { stdio: 'inherit' });
    log('VAD model downloaded successfully', 'success');
    return true;
  } catch (error) {
    log(`Failed to download VAD model: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    return false;
  }
}

/**
 * Main setup function
 */
async function main(): Promise<void> {
  console.log('\n🚀 Vowel Engine Setup\n');
  console.log('=' .repeat(50));
  console.log();

  // Step 1: Environment check
  const envOk = checkEnvironment();

  console.log();

  // Step 2: Download VAD model
  const vadOk = await downloadVADModel();

  console.log();
  console.log('=' .repeat(50));

  if (envOk && vadOk) {
    log('Setup complete! You can now run:', 'success');
    console.log();
    console.log('   bun run dev     # Start development server');
    console.log('   bun run build   # Build for production');
    console.log();
    process.exit(0);
  } else {
    log('Setup completed with warnings/errors', 'warning');
    if (!envOk) {
      console.log();
      console.log('   Please set the required environment variables in .env');
      console.log('   Copy .env.example to .env and fill in the values');
    }
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.main) {
  main();
}
