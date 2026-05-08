import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';
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

const schema = jsonSchema({
  type: 'object',
  properties: {
    operation: {
      anyOf: [
        { type: 'object', properties: {}, additionalProperties: true, description: '{ op: "add" } | { op: "remove", index } | { op: "update", index, partial }' },
        { type: 'null' },
      ],
    },
  },
  required: ['operation'],
  additionalProperties: false,
});

async function test(label: string, prompt: string) {
  console.log(`\n--- ${label} ---`);
  try {
    const result = await generateText({
      model, maxSteps: 2,
      tools: {
        patch_fields: {
          name: 'patch_fields', description: 'Modify report builder fields',
          inputSchema: schema,
          execute: async (args: any) => ({ success: true, data: args }),
        } as any,
      },
      prompt,
    });
    if (result.toolCalls?.length) {
      console.log(`✅ Args: ${JSON.stringify(result.toolCalls[0].input)}`);
    } else {
      console.log(`📝 No tool call: ${result.text?.slice(0, 200)}`);
    }
  } catch (e: any) {
    console.log(`❌ Error: ${e.message?.slice(0, 300)}`);
  }
}

await test('ADD', 'Call patch_fields with add operation');
await test('REMOVE', 'Call patch_fields to remove field at index 2');
await test('UPDATE', 'Call patch_fields to update title at index 0');
