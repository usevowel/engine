import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';
import { jsonSchema } from '@ai-sdk/provider-utils';
import { readFileSync, existsSync, writeFileSync } from 'fs';
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

const schema = jsonSchema({
  type: 'object',
  properties: {
    operation: {
      anyOf: [
        { type: 'object', properties: {}, additionalProperties: true, description: '{ op: "add" } | { op: "remove", index: number } | { op: "update", index: number, partial: object }' },
        { type: 'null' },
      ],
    },
  },
  required: ['operation'],
  additionalProperties: false,
});

// Intercept request
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
  if (typeof url === 'string' && url.includes('groq') && init?.body) {
    const body = JSON.parse(init.body as string);
    if (body.tools) {
      console.error('📤 REQUEST TOOLS:');
      for (const t of body.tools) {
        console.error(`  ${t.function.name}: ${JSON.stringify(t.function.parameters, null, 4)}`);
      }
    }
  }
  return originalFetch(url, init);
};

try {
  const result = await generateText({
    model,
    maxSteps: 2,
    tools: {
      patch_fields: {
        name: 'patch_fields',
        description: 'Modify report builder fields. Operations: { op: "add" }, { op: "remove", index }, { op: "update", index, partial }',
        inputSchema: schema,
        execute: async (args: any) => {
          console.error('✅ EXECUTED with args:', JSON.stringify(args));
          return { success: true, data: args };
        },
      } as any,
    },
    prompt: 'Call patch_fields with remove at index 2',
  });
  
  if (result.toolCalls?.length) {
    console.log('✅ TOOL CALLED:', JSON.stringify(result.toolCalls, null, 2));
  } else {
    console.log('📝 No tool call:', result.text?.slice(0, 300));
  }
} catch (e: any) {
  console.log('❌ ERROR:', e.message?.slice(0, 500));
}
