/**
 * Download Silero VAD Model Script
 *
 * Downloads the Silero VAD ONNX model from the official GitHub repository
 * to the local vendor directory. This script is idempotent - it will only
 * download the model if it doesn't already exist.
 *
 * Usage:
 *   bun run scripts/download-vad.ts
 *   bun run download-vad
 *
 * Model Source:
 *   https://github.com/snakers4/silero-vad
 */

import { existsSync, createWriteStream, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Model download URL from official Silero VAD repository
const MODEL_URL = 'https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx';

// Target path relative to engine root
const TARGET_DIR = join(__dirname, '..', 'vendor', 'silero-vad');
const TARGET_PATH = join(TARGET_DIR, 'silero_vad.onnx');

/**
 * Downloads a file from a URL to a local path
 */
async function downloadFile(url: string, targetPath: string): Promise<void> {
  console.log(`📥 Downloading from: ${url}`);
  console.log(`💾 Saving to: ${targetPath}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  const fileStream = createWriteStream(targetPath);
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error('Response body is not readable');
  }

  let downloaded = 0;
  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    fileStream.write(Buffer.from(value));
    downloaded += value.length;

    if (total) {
      const percent = ((downloaded / total) * 100).toFixed(1);
      process.stdout.write(`\r⏳ Progress: ${percent}% (${(downloaded / 1024 / 1024).toFixed(2)} MB)`);
    }
  }

  fileStream.end();
  console.log('\n✅ Download complete');
}

/**
 * Parse command line arguments
 */
function parseArgs(): { force: boolean } {
  const args = process.argv.slice(2);
  return {
    force: args.includes('--force'),
  };
}

/**
 * Main function to download the VAD model
 */
async function main(): Promise<void> {
  console.log('🔧 Silero VAD Model Download\n');

  const { force } = parseArgs();

  // Check if model already exists
  if (existsSync(TARGET_PATH) && !force) {
    console.log(`✅ Model already exists at: ${TARGET_PATH}`);
    console.log('   Skipping download (use --force to re-download)');
    process.exit(0);
  }

  if (force && existsSync(TARGET_PATH)) {
    console.log(`⚠️  Force flag set - re-downloading model...\n`);
  }

  // Create target directory if it doesn't exist
  if (!existsSync(TARGET_DIR)) {
    console.log(`📁 Creating directory: ${TARGET_DIR}`);
    mkdirSync(TARGET_DIR, { recursive: true });
  }

  try {
    await downloadFile(MODEL_URL, TARGET_PATH);
    console.log('\n🎉 Silero VAD model ready!');
    console.log(`   Location: ${TARGET_PATH}`);
  } catch (error) {
    console.error('\n❌ Error downloading model:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.main) {
  main();
}
