/**
 * Isolated Barge-In Detection Test Harness
 *
 * Generates synthetic audio (TTS-like, speech-like, echo, mixed, silence),
 * runs it through the full pipeline (PlaybackRingBuffer -> residualEchoCancel
 * -> ServerBargeInDetector), and reports detection results.
 *
 * Also saves WAV files for each scenario so you can listen to the synthetic
 * audio and verify it sounds realistic.
 *
 * Usage:
 *   cd engine && bun run test/barge-in-harness.ts
 *   cd engine && bun run test/barge-in-harness.ts --save-wav
 */

import { PlaybackRingBuffer, residualEchoCancel } from '../src/lib/echo-cancellation';
import { ServerBargeInDetector } from '../src/lib/server-barge-in';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SAVE_WAV = process.argv.includes('--save-wav');
const WAV_DIR = join(__dirname, 'barge-in-wav-output');
const REAL_TTS_PATH = join(__dirname, 'barge-in-assets', 'tts-long-response.pcm');

const SR = 24000;
const FRAME_SAMPLES = 2048;
const FRAME_MS = (FRAME_SAMPLES / SR) * 1000;
const RING_BUFFER_SECONDS = 3.0;

// ---------------------------------------------------------------------------
// Audio generation helpers (24kHz, Float32 [-1,1])
// ---------------------------------------------------------------------------

function generateSilence(numSamples: number): Float32Array {
  return new Float32Array(numSamples);
}

function generateSpeechLike(numSamples: number, amplitude: number): Float32Array {
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / SR;
    const envelope = Math.min(1, i / (SR * 0.03), (numSamples - i) / (SR * 0.03));
    const formants =
      Math.sin(2 * Math.PI * 180 * t) * 0.45 +
      Math.sin(2 * Math.PI * 360 * t) * 0.28 +
      Math.sin(2 * Math.PI * 720 * t) * 0.14;
    samples[i] = formants * amplitude * Math.max(0, envelope) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 5 * t));
  }
  return samples;
}

function generateTtsLike(numSamples: number, amplitude: number): Float32Array {
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / SR;
    const envelope = Math.min(1, i / (SR * 0.05), (numSamples - i) / (SR * 0.05));
    const formants =
      Math.sin(2 * Math.PI * 220 * t) * 0.40 +
      Math.sin(2 * Math.PI * 440 * t) * 0.25 +
      Math.sin(2 * Math.PI * 880 * t) * 0.12;
    samples[i] = formants * amplitude * Math.max(0, envelope) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 4 * t));
  }
  return samples;
}

function generateNoise(numSamples: number, amplitude: number): Float32Array {
  const samples = new Float32Array(numSamples);
  let prev = 0;
  let seed = 123456789;
  for (let i = 0; i < numSamples; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    const white = (seed / 0xffffffff) * 2 - 1;
    prev = prev * 0.82 + white * 0.18;
    samples[i] = prev * amplitude;
  }
  return samples;
}

function delaySignal(input: Float32Array, delaySamples: number): Float32Array {
  const output = new Float32Array(input.length + delaySamples);
  output.set(input, delaySamples);
  return output;
}

function mixSignals(a: Float32Array, b: Float32Array): Float32Array {
  const length = Math.min(a.length, b.length);
  const mixed = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    mixed[i] = Math.max(-1, Math.min(1, a[i] + b[i]));
  }
  return mixed;
}

function extractChunk(input: Float32Array, start: number, length: number): Float32Array {
  const chunk = new Float32Array(length);
  const end = Math.min(start + length, input.length);
  for (let i = 0; i < length; i++) {
    chunk[i] = start + i < end ? input[start + i] : 0;
  }
  return chunk;
}

function scaleAmplitude(input: Float32Array, factor: number): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = Math.max(-1, Math.min(1, input[i] * factor));
  }
  return out;
}

function loadRealTtsAudio(path: string): Float32Array | null {
  if (!existsSync(path)) {
    return null;
  }
  const bytes = new Uint8Array(readFileSync(path));
  return pcm16BytesToFloat32(bytes);
}

// ---------------------------------------------------------------------------
// Format conversion (Float32 [-1,1] <-> PCM16 LE Uint8Array)
// ---------------------------------------------------------------------------

function float32ToPcm16Bytes(float: Float32Array): Uint8Array {
  const out = new Uint8Array(float.length * 2);
  for (let i = 0; i < float.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float[i]));
    let sample = Math.round(clamped * 0x7fff);
    if (sample < 0) sample += 0x10000;
    out[i * 2] = sample & 0xff;
    out[i * 2 + 1] = (sample >> 8) & 0xff;
  }
  return out;
}

function pcm16BytesToFloat32(bytes: Uint8Array): Float32Array {
  const n = bytes.length / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sample = (bytes[i * 2 + 1] << 8) | bytes[i * 2];
    if (sample >= 0x8000) sample -= 0x10000;
    out[i] = sample / 0x8000;
  }
  return out;
}

function encodeWav(float: Float32Array, sampleRate: number): ArrayBuffer {
  const pcm16 = new Int16Array(float.length);
  for (let i = 0; i < float.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float[i]));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm16.length * 2);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + pcm16.length * 2, true);
  writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); writeStr(36, 'data');
  view.setUint32(40, pcm16.length * 2, true);
  for (let i = 0; i < pcm16.length; i++) view.setInt16(44 + i * 2, pcm16[i], true);
  return buf;
}

function saveWav(name: string, float: Float32Array): void {
  if (!SAVE_WAV) return;
  mkdirSync(WAV_DIR, { recursive: true });
  const wav = encodeWav(float, SR);
  writeFileSync(join(WAV_DIR, `${name}.wav`), Buffer.from(wav));
}

// ---------------------------------------------------------------------------
// Metrics helpers
// ---------------------------------------------------------------------------

function computeRms(float: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < float.length; i++) sum += float[i] * float[i];
  return Math.sqrt(sum / Math.max(1, float.length));
}

function formatNum(n: number, decimals = 4): string {
  return n.toFixed(decimals).padStart(8);
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

interface FrameResult {
  frame: number;
  totalAudioMs: number;
  micRms: number;
  residualRatio: number;
  echoEnergy: number;
  micEnergy: number;
  consecutiveFrames: number;
  triggered: boolean;
}

interface ScenarioResult {
  name: string;
  description: string;
  audioSource: string;
  frames: FrameResult[];
  fired: boolean;
  fireFrame: number | null;
}

function runScenario(
  name: string,
  description: string,
  ttsAudio: Float32Array,
  micAudio: Float32Array,
  delayMs: number = 100,
  ringBufferSeconds: number = RING_BUFFER_SECONDS,
  audioSource: string = 'synthetic',
): ScenarioResult {
  const ring = new PlaybackRingBuffer(Math.ceil(ringBufferSeconds * SR));
  const detector = new ServerBargeInDetector();

  const totalFrames = Math.ceil(micAudio.length / FRAME_SAMPLES);
  const frames: FrameResult[] = [];
  let fired = false;
  let fireFrame: number | null = null;
  const residualAudio = SAVE_WAV ? new Float32Array(micAudio.length) : null;

  for (let f = 0; f < totalFrames; f++) {
    const start = f * FRAME_SAMPLES;

    // Push the TTS chunk for this frame BEFORE processing the mic frame.
    // This simulates real-time playback: the engine pushes TTS audio to the
    // ring buffer as it is played to the speaker, and the mic picks it up
    // after a delay. With interleaved pushing, the ring buffer contains the
    // correct recent playback history when each mic frame is processed,
    // which is essential for real (non-periodic) speech to be cancelled.
    const ttsChunk = extractChunk(ttsAudio, start, FRAME_SAMPLES);
    ring.push(float32ToPcm16Bytes(ttsChunk));

    const micChunk = extractChunk(micAudio, start, FRAME_SAMPLES);
    const micPcm16 = float32ToPcm16Bytes(micChunk);

    const result = residualEchoCancel(micPcm16, ring, SR);
    const barge = detector.observe(result, SR, Math.round(f * FRAME_MS));

    if (residualAudio) {
      const resFloat = pcm16BytesToFloat32(result.residual);
      for (let i = 0; i < resFloat.length && start + i < residualAudio.length; i++) {
        residualAudio[start + i] = resFloat[i];
      }
    }

    const frameResult: FrameResult = {
      frame: f,
      totalAudioMs: Math.round(f * FRAME_MS),
      micRms: barge.metrics.micRms,
      residualRatio: barge.metrics.residualRatio,
      echoEnergy: barge.metrics.echoEnergy,
      micEnergy: barge.metrics.micEnergy,
      consecutiveFrames: barge.metrics.consecutiveFrames,
      triggered: barge.triggered,
    };
    frames.push(frameResult);

    if (barge.triggered && !fired) {
      fired = true;
      fireFrame = f;
    }
  }

  if (SAVE_WAV && residualAudio) {
    saveWav(`${name}_tts`, ttsAudio);
    saveWav(`${name}_mic`, micAudio);
    saveWav(`${name}_residual`, residualAudio);
  }

  return { name, description, audioSource, frames, fired, fireFrame };
}

// ---------------------------------------------------------------------------
// Print results
// ---------------------------------------------------------------------------

function printScenarioResult(result: ScenarioResult): void {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Scenario: ${result.name}`);
  console.log(`Description: ${result.description}`);
  console.log(`Audio source: ${result.audioSource}`);
  console.log(`Fired: ${result.fired ? 'YES' : 'NO'}${result.fireFrame !== null ? ` (frame ${result.fireFrame}, ~${(result.fireFrame * FRAME_MS).toFixed(0)}ms)` : ''}`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`${'frame'.padStart(5)} ${'ms'.padStart(6)} ${'micRms'.padStart(8)} ${'resRatio'.padStart(8)} ${'echoEng'.padStart(10)} ${'micEng'.padStart(10)} ${'cons'.padStart(5)} ${'triggered'}`);
  console.log(`${'─'.repeat(80)}`);

  for (const f of result.frames) {
    const trigger = f.triggered ? '*** YES ***' : '';
    const fire = f.triggered && result.fireFrame === f.frame ? ' <<<< BARGE-IN FIRE' : '';
    console.log(
      `${String(f.frame).padStart(5)} ${String(f.totalAudioMs).padStart(6)} ${formatNum(f.micRms)} ${formatNum(f.residualRatio)} ${formatNum(f.echoEnergy, 2)} ${formatNum(f.micEnergy, 2)} ${String(f.consecutiveFrames).padStart(5)} ${trigger}${fire}`,
    );
  }

  const inputRms = computeRms(result.frames.length > 0
    ? pcm16BytesToFloat32(float32ToPcm16Bytes(
      extractChunk(
        result.name.includes('echo') || result.name.includes('mixed')
          ? generateTtsLike(result.frames.length * FRAME_SAMPLES, 0.5)
          : generateSpeechLike(result.frames.length * FRAME_SAMPLES, 0.3),
        0, result.frames.length * FRAME_SAMPLES,
      ),
    ))
    : new Float32Array(0));
  console.log(`${'─'.repeat(80)}`);
  console.log(`Summary: fired=${result.fired}, fireFrame=${result.fireFrame}, totalFrames=${result.frames.length}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║     Isolated Barge-In Detection Test Harness                            ║');
  console.log('║     Algorithm: residualEchoCancel + ServerBargeInDetector                ║');
  console.log(`║     Sample Rate: ${SR}Hz, Frame: ${FRAME_SAMPLES} samples (${FRAME_MS.toFixed(1)}ms)              ║`);
  console.log(`║     Ring Buffer: ${RING_BUFFER_SECONDS}s, Thresholds: micRms>=0.018, resRatio>=0.62, frames=5  ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');

  if (SAVE_WAV) {
    console.log(`\n📁 WAV files will be saved to: ${WAV_DIR}`);
  }

  const realTtsAudio = loadRealTtsAudio(REAL_TTS_PATH);
  if (realTtsAudio) {
    const dur = realTtsAudio.length / SR;
    console.log(`\n🎙️  Loaded real TTS audio: ${REAL_TTS_PATH}`);
    console.log(`   Duration: ${dur.toFixed(2)}s, Samples: ${realTtsAudio.length}`);
  } else {
    console.log(`\n⚠️  Real TTS audio not found at ${REAL_TTS_PATH}`);
    console.log(`   Run \`bun run test/generate-tts-assets.ts\` first.`);
    console.log(`   Falling back to synthetic TTS for all scenarios.\n`);
  }

  const results: ScenarioResult[] = [];

  // --- Scenario 1: Pure Echo (mic = delayed copy of TTS) ---
  // Expected: should NOT trigger (residual ratio should be low — echo is explained)
  {
    const useReal = realTtsAudio !== null;
    const tts = useReal ? realTtsAudio! : generateTtsLike(SR * 2, 0.5);
    const ttsDurationSamples = tts.length;
    const delayMs = 100;
    const delaySamples = Math.round((delayMs / 1000) * SR);
    const echoFull = delaySignal(tts, delaySamples);
    const mic = extractChunk(echoFull, 0, ttsDurationSamples);
    const ringSeconds = useReal
      ? Math.max(RING_BUFFER_SECONDS, ttsDurationSamples / SR + delayMs / 1000 + 0.5)
      : RING_BUFFER_SECONDS;
    const result = runScenario(
      '1-pure-echo',
      'Mic = delayed copy of TTS (pure echo, no user speech). Should NOT trigger.',
      tts,
      mic,
      delayMs,
      ringSeconds,
      useReal ? 'real TTS (tts-long-response.pcm)' : 'synthetic',
    );
    printScenarioResult(result);
    results.push(result);
  }

  // --- Scenario 2: Pure Speech (mic = unrelated speech, TTS in ring) ---
  // Expected: SHOULD trigger after 5 frames (residual ratio high — speech not explained by TTS)
  {
    const ttsDurationSamples = SR * 2;
    const tts = generateTtsLike(ttsDurationSamples, 0.5);
    const speech = generateSpeechLike(ttsDurationSamples, 0.3);
    const result = runScenario(
      '2-pure-speech',
      'Mic = unrelated speech signal (no echo). SHOULD trigger after 5 frames.',
      tts,
      speech,
      100,
    );
    printScenarioResult(result);
    results.push(result);
  }

  // --- Scenario 3: Mixed (mic = delayed TTS + speech) ---
  // Expected: SHOULD trigger (speech component makes residual ratio high)
  {
    const useReal = realTtsAudio !== null;
    const tts = useReal ? realTtsAudio! : generateTtsLike(SR * 2, 0.5);
    const ttsDurationSamples = tts.length;
    const delayMs = 120;
    const delaySamples = Math.round((delayMs / 1000) * SR);
    const echo = extractChunk(delaySignal(tts, delaySamples), 0, ttsDurationSamples);
    const speech = generateSpeechLike(ttsDurationSamples, 0.25);
    const mixed = mixSignals(echo, speech);
    const ringSeconds = useReal
      ? Math.max(RING_BUFFER_SECONDS, ttsDurationSamples / SR + delayMs / 1000 + 0.5)
      : RING_BUFFER_SECONDS;
    const result = runScenario(
      '3-mixed-echo-plus-speech',
      'Mic = delayed TTS echo + user speech. SHOULD trigger (speech breaks through echo).',
      tts,
      mixed,
      delayMs,
      ringSeconds,
      useReal ? 'real TTS echo + synthetic speech' : 'synthetic',
    );
    printScenarioResult(result);
    results.push(result);
  }

  // --- Scenario 4: Silence ---
  // Expected: should NOT trigger (micRms below threshold)
  {
    const ttsDurationSamples = SR * 2;
    const tts = generateTtsLike(ttsDurationSamples, 0.5);
    const silence = generateSilence(ttsDurationSamples);
    const result = runScenario(
      '4-silence',
      'Mic = silence. Should NOT trigger (micRms below 0.018).',
      tts,
      silence,
      100,
    );
    printScenarioResult(result);
    results.push(result);
  }

  // --- Scenario 5: No TTS Reference (empty ring buffer, mic = speech) ---
  // Expected: SHOULD trigger (passthrough, residualRatio=1.0 because echoEnergy=0)
  {
    const ttsDurationSamples = 0;
    const tts = generateSilence(0);
    const speech = generateSpeechLike(SR * 2, 0.3);
    const result = runScenario(
      '5-no-tts-reference',
      'Empty ring buffer, mic = speech. SHOULD trigger (passthrough, residualRatio=1.0).',
      tts,
      speech,
      100,
    );
    printScenarioResult(result);
    results.push(result);
  }

  // --- Scenario 6: Low-amplitude echo (quiet TTS, mic = echo) ---
  // Expected: should NOT trigger (low micRms after echo cancellation)
  {
    const useReal = realTtsAudio !== null;
    const tts = useReal
      ? scaleAmplitude(realTtsAudio!, 0.3)
      : generateTtsLike(SR * 2, 0.15);
    const ttsDurationSamples = tts.length;
    const delayMs = 80;
    const delaySamples = Math.round((delayMs / 1000) * SR);
    const echo = extractChunk(delaySignal(tts, delaySamples), 0, ttsDurationSamples);
    const ringSeconds = useReal
      ? Math.max(RING_BUFFER_SECONDS, ttsDurationSamples / SR + delayMs / 1000 + 0.5)
      : RING_BUFFER_SECONDS;
    const result = runScenario(
      '6-quiet-echo',
      'Mic = delayed copy of quiet TTS. Should NOT trigger (low residual after cancellation).',
      tts,
      echo,
      delayMs,
      ringSeconds,
      useReal ? 'real TTS (scaled 0.3x)' : 'synthetic',
    );
    printScenarioResult(result);
    results.push(result);
  }

  // --- Scenario 7: Background noise (no TTS, no speech, just noise) ---
  // Expected: should NOT trigger (residualRatio=1.0 but micRms may be below 0.018)
  {
    const tts = generateSilence(0);
    const noise = generateNoise(SR * 2, 0.01); // very low amplitude noise
    const result = runScenario(
      '7-background-noise',
      'Mic = low-amplitude background noise. Should NOT trigger (micRms below 0.018).',
      tts,
      noise,
      100,
    );
    printScenarioResult(result);
    results.push(result);
  }

  // --- Scenario 8: Speech with no TTS playing (outputAudioActive=false scenario) ---
  // This simulates the case where the AI is NOT speaking — barge-in shouldn't even run
  // But for algorithm validation, we test that the detector would fire if it did run
  {
    const speech = generateSpeechLike(SR * 2, 0.3);
    const tts = generateSilence(0);
    const result = runScenario(
      '8-speech-no-tts',
      'Mic = speech, no TTS in ring. SHOULD trigger (passthrough).',
      tts,
      speech,
      100,
    );
    printScenarioResult(result);
    results.push(result);
  }

  // --- Summary ---
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                          SUMMARY                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log();

  const expected: Record<string, boolean> = {
    '1-pure-echo': false,
    '2-pure-speech': true,
    '3-mixed-echo-plus-speech': true,
    '4-silence': false,
    '5-no-tts-reference': true,
    '6-quiet-echo': false,
    '7-background-noise': false,
    '8-speech-no-tts': true,
  };

  let passCount = 0;
  let failCount = 0;

  for (const result of results) {
    const exp = expected[result.name] ?? false;
    const pass = result.fired === exp;
    const status = pass ? 'PASS' : 'FAIL';
    const icon = pass ? '✅' : '❌';
    if (pass) passCount++; else failCount++;
    console.log(`  ${icon} ${status} | ${result.name.padEnd(30)} | expected=${exp ? 'FIRE' : 'NO_FIRE'} | actual=${result.fired ? 'FIRED' : 'NO_FIRE'}${result.fireFrame !== null ? ` @frame=${result.fireFrame}` : ''}`);
  }

  console.log();
  console.log(`  Total: ${passCount} pass, ${failCount} fail out of ${results.length} scenarios`);

  if (failCount > 0) {
    console.log();
    console.log('  ⚠️  FAILURES INDICATE ALGORITHM ISSUES:');
    for (const result of results) {
      const exp = expected[result.name] ?? false;
      if (result.fired !== exp) {
        console.log(`    • ${result.name}: expected ${exp ? 'FIRE' : 'NO_FIRE'} but got ${result.fired ? 'FIRED' : 'NO_FIRE'}`);
        const firstFrame = result.frames[0];
        const lastFrame = result.frames[result.frames.length - 1];
        if (firstFrame && lastFrame) {
          console.log(`      First frame: micRms=${firstFrame.micRms.toFixed(4)}, resRatio=${firstFrame.residualRatio.toFixed(3)}, echoEng=${firstFrame.echoEnergy.toFixed(2)}, micEng=${firstFrame.micEnergy.toFixed(2)}`);
          console.log(`      Last frame:  micRms=${lastFrame.micRms.toFixed(4)}, resRatio=${lastFrame.residualRatio.toFixed(3)}, echoEng=${lastFrame.echoEnergy.toFixed(2)}, micEng=${lastFrame.micEnergy.toFixed(2)}`);
        }
      }
    }
  }

  if (SAVE_WAV) {
    console.log();
    console.log(`  📁 WAV files saved to: ${WAV_DIR}`);
    console.log('     Listen to them to verify the synthetic audio sounds realistic.');
  }

  console.log();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
