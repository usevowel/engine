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

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY! });
const model = groq('openai/gpt-oss-120b');

const originalParams = {
  type: 'object',
  properties: {
    operation: {
      type: 'object',
      description: 'Discriminated union: { op: "add" } | { op: "remove", index } | { op: "update", index, partial }',
    },
  },
  required: ['operation'],
};

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

const schemaForProvider = jsonSchema(enhanceJsonSchema(originalParams));
console.error('Enhanced schema:', JSON.stringify(enhanceJsonSchema(originalParams), null, 2));

// Test: pass through tool() wrapper
const result = await generateText({
  model, maxSteps: 2,
  tools: {
    patch_fields: tool({
      name: 'patch_fields',
      description: 'Modify report builder fields',
      inputSchema: schemaForProvider,
      execute: async (args: any) => ({ success: true, data: args }),
    }),
  },
  prompt: 'Call patch_fields to remove field at index 2',
});

if (result.toolCalls?.length) {
  console.log(`✅ Args: ${JSON.stringify(result.toolCalls[0].input)}`);
} else {
  console.log(`📝 Text: ${result.text?.slice(0, 200)}`);
}
