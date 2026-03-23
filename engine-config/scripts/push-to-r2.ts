#!/usr/bin/env bun
/**
 * Push engine config YAML files to R2 bucket
 *
 * Uploads config/{environment}.yaml from engine-config/ to the sndbrd-store R2 bucket.
 * Supports two modes:
 * 1. R2 S3 API: Set R2_ACCESS_KEY, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID from .dev.vars
 * 2. Wrangler: bunx wrangler login (OAuth token must have R2 permissions)
 *
 * Usage:
 *   ./engine-config/scripts/push-to-r2.sh              # Load .dev.vars, push all
 *   bun run engine-config:push [testing|dev|staging|production|billing-test]
 *
 * @see .ai/plans/sndbrd-v2.0/config-refactor/README.md
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { spawn } from 'bun';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const R2_BUCKET = 'sndbrd-store';
const CONFIG_DIR = join(import.meta.dir, '..');
const ENVIRONMENTS = ['testing', 'dev', 'staging', 'production', 'billing-test'] as const;

type Environment = (typeof ENVIRONMENTS)[number];

function useS3Api(): boolean {
  return !!(
    process.env.R2_ACCESS_KEY &&
    process.env.R2_SECRET_ACCESS_KEY &&
    (process.env.R2_ACCOUNT_ID || process.env.R2_ACCESS_KEY)
  );
}

function getS3Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID ?? process.env.R2_ACCESS_KEY;
  const accessKey = process.env.R2_ACCESS_KEY!;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY!;

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    forcePathStyle: true,
  });
}

async function pushViaS3(s3: S3Client, env: Environment): Promise<boolean> {
  const yamlPath = join(CONFIG_DIR, `${env}.yaml`);
  const r2Key = `config/${env}.yaml`;
  if (!existsSync(yamlPath)) {
    console.error(`❌ Config file not found: ${yamlPath}`);
    return false;
  }
  console.log(`📤 Pushing ${env}.yaml → ${R2_BUCKET}/${r2Key} (S3 API)`);
  try {
    const body = await readFile(yamlPath);
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: body,
        ContentType: 'text/yaml',
      })
    );
    console.log(`✅ Pushed ${env}.yaml`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to push ${env}.yaml:`, err);
    return false;
  }
}

async function pushViaWrangler(env: Environment): Promise<boolean> {
  const yamlPath = join(CONFIG_DIR, `${env}.yaml`);
  const objectPath = `${R2_BUCKET}/config/${env}.yaml`;
  if (!existsSync(yamlPath)) {
    console.error(`❌ Config file not found: ${yamlPath}`);
    return false;
  }
  console.log(`📤 Pushing ${env}.yaml → ${objectPath} (wrangler)`);
  const proc = spawn(
    [
      'bunx',
      'wrangler',
      'r2',
      'object',
      'put',
      objectPath,
      '--file',
      yamlPath,
      '--content-type',
      'text/yaml',
      '--remote',
    ],
    {
      cwd: join(import.meta.dir, '../..'),
      stdout: 'inherit',
      stderr: 'inherit',
    }
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`❌ Failed to push ${env}.yaml (exit code ${exitCode})`);
    return false;
  }
  console.log(`✅ Pushed ${env}.yaml`);
  return true;
}

async function pushConfig(
  s3: S3Client | null,
  env: Environment
): Promise<boolean> {
  if (s3) return pushViaS3(s3, env);
  return pushViaWrangler(env);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const envs: Environment[] =
    args.length > 0
      ? (args.filter((a) => ENVIRONMENTS.includes(a as Environment)) as Environment[])
      : [...ENVIRONMENTS];

  if (envs.length === 0) {
    console.error('Usage: bun run push-to-r2.ts [testing|dev|staging|production|billing-test]...');
    console.error('  Provide no args to push all environments.');
    process.exit(1);
  }

  let s3: S3Client | null = null;
  if (useS3Api()) {
    s3 = getS3Client();
    console.log(`🔧 Pushing configs to R2 (${R2_BUCKET}) via S3 API...\n`);
  } else {
    console.log(
      `🔧 Pushing configs to R2 (${R2_BUCKET}) via wrangler...\n` +
        `   (Set R2_ACCESS_KEY, R2_SECRET_ACCESS_KEY from .dev.vars for S3 API)\n`
    );
  }

  let failed = 0;
  for (const env of envs) {
    const ok = await pushConfig(s3, env);
    if (!ok) failed++;
  }

  console.log('');
  if (failed > 0) {
    console.error(`❌ ${failed} config(s) failed to push.`);
    process.exit(1);
  }
  console.log(`✅ All ${envs.length} config(s) pushed successfully.`);
}

main();
