import { createGroq } from '@ai-sdk/groq';
import { generateText, tool } from 'ai';
import { jsonSchema } from '@ai-sdk/provider-utils';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  const paths = [resolve(__dirname, '../.env'), resolve(__dirname, '../.dev.vars')];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim(); if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('='); if (eq === -1) continue;
      const k = t.slice(0, eq).trim(); const v = t.slice(eq + 1).trim();
      if (k && v) process.env[k] = v;
    }
  }
}
loadEnv();

function enhanceJsonSchema(params: any): any {
  if (!params || typeof params !== 'object') return params;
  const result = { ...params };
  if (result.type === 'object' && (!result.properties || Object.keys(result.properties).length === 0)) {
    if (result.additionalProperties === undefined) result.additionalProperties = true;
  }
  if (result.properties) {
    const enhanced: any = {};
    for (const [key, value] of Object.entries(result.properties)) {
      enhanced[key] = enhanceJsonSchema(value);
    }
    result.properties = enhanced;
  }
  if (result.items) result.items = enhanceJsonSchema(result.items);
  for (const key of ['anyOf', 'allOf', 'oneOf']) {
    if (Array.isArray(result[key])) result[key] = result[key].map(enhanceJsonSchema);
  }
  return result;
}

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY! });
const model = groq('openai/gpt-oss-120b');

async function test(label: string, params: any, prompt: string) {
  console.log(`\n--- ${label} ---`);
  const schemaForProvider = jsonSchema(enhanceJsonSchema(params));
  try {
    const result = await generateText({
      model, maxSteps: 2,
      tools: {
        test_tool: tool({
          name: 'test_tool', description: label,
          inputSchema: schemaForProvider,
          execute: async (args: any) => ({ data: args }),
        }),
      },
      prompt,
    });
    if (result.toolCalls?.length) {
      console.log(`✅ Args: ${JSON.stringify(result.toolCalls[0].input)}`);
    } else {
      console.log(`📝 Text: ${result.text?.slice(0, 100)}`);
    }
  } catch (e: any) {
    console.log(`❌ Error: ${e.message?.slice(0, 200)}`);
  }
}

// Flat schema (like get_user_info)
await test('FLAT', {
  type: 'object',
  properties: {
    user_id: { type: 'string', description: 'User ID' },
    include_email: { type: 'boolean' },
  },
  required: ['user_id'],
}, 'Call test_tool with user_id="abc-123" and include_email=true');

// Nested schema (like configure_database)
await test('NESTED', {
  type: 'object',
  properties: {
    host: { type: 'string' },
    port: { type: 'number' },
    connection: {
      type: 'object',
      properties: {
        host: { type: 'string' },
        port: { type: 'number' },
      },
      required: ['host'],
    },
  },
  required: ['host'],
}, 'Call test_tool with host="localhost", port=5432, connection={host:"db.local", port:3306}');

// Deep nested with arrays (like deploy_application)
await test('DEEP NESTED', {
  type: 'object',
  properties: {
    name: { type: 'string' },
    version: { type: 'string' },
    config: {
      type: 'object',
      properties: {
        cpu: { type: 'string' },
        env: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  required: ['name', 'version'],
}, 'Call test_tool with name="my-app", version="1.0", config={cpu:"2 cores", env:["prod"]}');
