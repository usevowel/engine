/**
 * Generate real English speech audio assets for the barge-in detection test
 * harness using the Grok (xAI) TTS REST API.
 *
 * Outputs both `.pcm` (raw PCM16 LE 24kHz mono) and `.wav` files into
 * `engine/test/barge-in-assets/`.
 *
 * Usage:
 *   cd engine && bun run test/generate-tts-assets.ts
 */

import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_KEY =
  process.env.GROK_API_KEY || '';
const API_URL = 'https://api.x.ai/v1/tts';
const VOICE = 'eve';
const SAMPLE_RATE = 24000;

interface Clip {
  name: string;
  text: string;
}

const CLIPS: Clip[] = [
  {
    name: 'tts-greeting',
    text: "Hello! I'm your shopping assistant. How can I help you today?",
  },
  {
    name: 'tts-long-response',
    text:
      "I found three laptops in our catalog. The first one is a Dell XPS for nine hundred ninety nine dollars. The second is a MacBook Air for eleven hundred dollars. Would you like to see more details on any of them?",
  },
  {
    name: 'tts-short-phrase',
    text: 'Let me check that for you.',
  },
  {
    name: 'tts-questions',
    text:
      'What type of products are you looking for? We have electronics, clothing, home goods, and accessories.',
  },
];

/**
 * Call the Grok TTS API and return raw PCM16 LE 24kHz mono bytes.
 */
async function synthesize(text: string): Promise<Uint8Array> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      voice_id: VOICE,
      language: 'en',
      output_format: { codec: 'pcm', sample_rate: SAMPLE_RATE },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `TTS request failed: ${response.status} ${response.statusText}\nResponse body: ${body}`,
    );
  }

  const buf = await response.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Wrap raw PCM16 LE mono samples in a standard 44-byte WAV header.
 */
function encodeWav(pcm16: Uint8Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm16.length;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  // RIFF header
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');

  // fmt chunk
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // subchunk1 size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // Copy PCM bytes
  const dst = new Uint8Array(buf, 44);
  dst.set(pcm16);

  return buf;
}

async function main(): Promise<void> {
  const outDir = join(__dirname, 'barge-in-assets');
  mkdirSync(outDir, { recursive: true });

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║     Grok TTS Asset Generator                                             ║');
  console.log(`║     Voice: ${VOICE}  |  Sample Rate: ${SAMPLE_RATE}Hz  |  Format: PCM16 LE mono      ║`);
  console.log(`║     Output: ${outDir.slice(-46).padEnd(58)}║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log();

  let okCount = 0;
  let failCount = 0;

  for (const clip of CLIPS) {
    process.stdout.write(`Generating: ${clip.name}... `);
    try {
      const pcm16 = await synthesize(clip.text);

      // Sanity check: PCM16 data must be an even number of bytes
      if (pcm16.length % 2 !== 0) {
        throw new Error(
          `Received odd byte count (${pcm16.length}); expected even for PCM16`,
        );
      }

      const pcmPath = join(outDir, `${clip.name}.pcm`);
      const wavPath = join(outDir, `${clip.name}.wav`);
      writeFileSync(pcmPath, pcm16);
      const wav = encodeWav(pcm16, SAMPLE_RATE);
      writeFileSync(wavPath, Buffer.from(wav));

      const durationSec = pcm16.length / 2 / SAMPLE_RATE;
      const pcmSize = statSync(pcmPath).size;
      const wavSize = statSync(wavPath).size;
      console.log(
        `OK\n  pcm=${pcmSize}B  wav=${wavSize}B  duration=${durationSec.toFixed(2)}s  samples=${pcm16.length / 2}`,
      );
      okCount++;
    } catch (err) {
      console.log(`FAIL`);
      console.error(`  Error generating ${clip.name}:`, err);
      failCount++;
    }
  }

  console.log();
  console.log(`Done: ${okCount} ok, ${failCount} fail.`);

  if (existsSync(outDir)) {
    console.log(`\nFiles in ${outDir}:`);
    for (const clip of CLIPS) {
      const pcmPath = join(outDir, `${clip.name}.pcm`);
      const wavPath = join(outDir, `${clip.name}.wav`);
      if (existsSync(pcmPath)) {
        const sz = statSync(pcmPath).size;
        const dur = sz / 2 / SAMPLE_RATE;
        console.log(`  ${clip.name}.pcm  ${sz}B  (${dur.toFixed(2)}s)`);
      }
      if (existsSync(wavPath)) {
        console.log(`  ${clip.name}.wav  ${statSync(wavPath).size}B`);
      }
    }
  }

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
