import { createGroq } from '@ai-sdk/groq';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const MODEL = 'openai/gpt-oss-120b';
const GROQ_NATIVE_MODEL = 'llama-3.3-70b-versatile';

function loadEnv() {
  const paths = [
    resolve(__dirname, '../.env'),
    resolve(__dirname, '../.dev.vars'),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim();
      if (key && val) process.env[key] = val;
    }
  }
}

function strictZodSchema(properties: Record<string, { type: string; description?: string; properties?: Record<string, any>; items?: any; enum?: string[]; required?: string[]; optional?: boolean }>, requiredFields: string[]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(properties)) {
    let field = zodFromDescriptor(prop);
    if (!requiredFields.includes(key)) {
      field = field.nullable();
    }
    shape[key] = field;
  }
  return shape;
}

function zodFromDescriptor(desc: { type: string; description?: string; properties?: Record<string, any>; items?: any; enum?: string[]; required?: string[] }): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  if (desc.enum) {
    base = z.enum(desc.enum as [string, ...string[]]);
  } else {
    switch (desc.type) {
      case 'string':
        base = z.string();
        break;
      case 'number':
        base = z.number();
        break;
      case 'boolean':
        base = z.boolean();
        break;
      case 'array':
        if (desc.items) {
          base = z.array(zodFromDescriptor(desc.items));
        } else {
          base = z.array(z.any());
        }
        break;
      case 'object':
        if (desc.properties) {
          const subRequired = desc.required || [];
          const subShape = strictZodSchema(desc.properties, subRequired);
          base = z.object(subShape);
        } else {
          base = z.object({}).passthrough();
        }
        break;
      default:
        base = z.any();
    }
  }
  if (desc.description) {
    base = base.describe(desc.description);
  }
  return base;
}

async function testTool(
  label: string,
  toolDef: { name: string; description: string; properties: Record<string, any>; required: string[] },
  prompt: string,
  groq: ReturnType<typeof createGroq>,
  schemaMode: 'strict' | 'loose' | 'dual' = 'strict'
): Promise<{ success: boolean; toolName: string; rawArgs: any; parsedArgs: any; error?: string; responseText: string; schemaUsed: string }> {
  const model = groq(MODEL);

  const required = toolDef.required || [];
  const strictShape = strictZodSchema(toolDef.properties, required);
  const strictObj = z.object(strictShape);

  const looseObj = z.object({}).passthrough();

  let inputSchema: z.ZodObject<any>;
  if (schemaMode === 'loose') {
    inputSchema = looseObj;
  } else {
    inputSchema = strictObj;
  }

  const tools = {
    [toolDef.name]: tool({
      name: toolDef.name,
      description: toolDef.description,
      inputSchema,
      execute: async (args: any) => {
        try {
          const validated = strictObj.parse(args);
          return { success: true, data: validated };
        } catch (parseErr: any) {
          return { success: false, error: parseErr?.issues || parseErr?.message || String(parseErr), received: args };
        }
      },
    }),
  };

  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧪 TEST: ${label}`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Schema mode: ${schemaMode}`);
  console.log(`   Tool: ${toolDef.name}`);
  console.log(`   ${Object.keys(toolDef.properties).length} top-level properties`);
  console.log(`   Depth: ${maxDepth(toolDef.properties)}`);
  console.log(`${'='.repeat(80)}`);

  try {
    const result = await generateText({
      model,
      tools,
      maxSteps: 5,
      prompt,
    });

    const toolCalls = result.toolCalls || [];
    const myCall = toolCalls.find((tc: any) => tc.toolName === toolDef.name);

    if (!myCall) {
      return {
        success: false,
        toolName: toolDef.name,
        rawArgs: null,
        parsedArgs: null,
        error: `Model did not call the tool. Called: ${toolCalls.map((t: any) => t.toolName).join(', ') || 'none'}`,
        responseText: result.text || '',
        schemaUsed: schemaMode,
      };
    }

    const args = (myCall as any).args ?? (myCall as any).input ?? {};

    try {
      const validated = strictObj.parse(args);
      return {
        success: true,
        toolName: toolDef.name,
        rawArgs: args,
        parsedArgs: validated,
        responseText: result.text || '',
        schemaUsed: schemaMode,
      };
    } catch (parseErr: any) {
      return {
        success: false,
        toolName: toolDef.name,
        rawArgs: args,
        parsedArgs: null,
        error: `Schema validation failed: ${parseErr?.issues ? JSON.stringify(parseErr.issues, null, 2) : parseErr?.message || String(parseErr)}`,
        responseText: result.text || '',
        schemaUsed: schemaMode,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      toolName: toolDef.name,
      rawArgs: null,
      parsedArgs: null,
      error: `generateText error: ${err?.message || String(err)}`,
      responseText: '',
      schemaUsed: schemaMode,
    };
  }
}

function maxDepth(props: Record<string, any>): number {
  let d = 1;
  for (const v of Object.values(props)) {
    if (v.type === 'object' && v.properties) {
      d = Math.max(d, 1 + maxDepth(v.properties));
    }
    if (v.type === 'array' && v.items?.type === 'object' && v.items?.properties) {
      d = Math.max(d, 1 + maxDepth(v.items.properties));
    }
  }
  return d;
}

// ─────────────────────────────────────────────────────────────
// TOOL DEFINITIONS
// ─────────────────────────────────────────────────────────────

// Tool 1: Simple flat (baseline control)
const simpleTool = {
  name: 'get_user_info',
  description: 'Get basic user information',
  properties: {
    user_id: { type: 'string', description: 'The user ID to look up' },
    include_email: { type: 'boolean', description: 'Whether to include email in response' },
  },
  required: ['user_id'],
};

// Tool 2: 2-level nesting
const nestedTool = {
  name: 'configure_database',
  description: 'Configure a database instance with connection settings',
  properties: {
    instance_name: { type: 'string', description: 'Name of the database instance' },
    engine: { type: 'string', enum: ['postgresql', 'mysql', 'mongodb'], description: 'Database engine type' },
    connection: {
      type: 'object',
      description: 'Connection configuration',
      properties: {
        host: { type: 'string', description: 'Database host address' },
        port: { type: 'number', description: 'Database port number' },
        ssl_enabled: { type: 'boolean', description: 'Whether SSL is enabled', optional: true },
        credentials: {
          type: 'object',
          description: 'Authentication credentials',
          properties: {
            username: { type: 'string', description: 'Database username' },
            password: { type: 'string', description: 'Database password' },
          },
          required: ['username', 'password'],
        },
      },
      required: ['host', 'port', 'credentials'],
    },
  },
  required: ['instance_name', 'engine', 'connection'],
};

// Tool 3: Deep nesting (4+ levels) with arrays of objects
const deepTool = {
  name: 'deploy_application',
  description: 'Deploy an application with full configuration including resources, scaling rules, environment, and health checks',
  properties: {
    app_name: { type: 'string', description: 'The application name' },
    version: { type: 'string', description: 'Semantic version string' },
    config: {
      type: 'object',
      description: 'Full deployment configuration',
      required: ['resources', 'environment'],
      properties: {
        resources: {
          type: 'object',
          description: 'Compute resource allocation',
          required: ['cpu', 'memory'],
          properties: {
            cpu: { type: 'string', description: 'CPU allocation (e.g., "2 cores")' },
            memory: { type: 'string', description: 'Memory allocation (e.g., "4Gi")' },
            scaling: {
              type: 'object',
              description: 'Auto-scaling configuration',
              required: ['min_replicas', 'max_replicas'],
              properties: {
                min_replicas: { type: 'number', description: 'Minimum number of replicas' },
                max_replicas: { type: 'number', description: 'Maximum number of replicas' },
                target_cpu_utilization: { type: 'number', description: 'Target CPU utilization percentage', optional: true },
                rules: {
                  type: 'array',
                  description: 'Custom scaling rules',
                  items: {
                    type: 'object',
                    description: 'A scaling rule',
                    required: ['metric', 'threshold', 'action'],
                    properties: {
                      metric: { type: 'string', description: 'Metric to monitor' },
                      threshold: { type: 'number', description: 'Threshold value' },
                      action: { type: 'string', enum: ['scale_up', 'scale_down'], description: 'Action to take' },
                    },
                  },
                },
              },
            },
          },
        },
        environment: {
          type: 'array',
          description: 'Environment variables',
          items: {
            type: 'object',
            description: 'An environment variable',
            required: ['name', 'value'],
            properties: {
              name: { type: 'string', description: 'Variable name' },
              value: { type: 'string', description: 'Variable value' },
              secret: { type: 'boolean', description: 'Whether the value is a secret', optional: true },
            },
          },
        },
      },
    },
  },
  required: ['app_name', 'version', 'config'],
};

// Tool 4: Complex filter with arrays of enums and nested conditions
const complexTool = {
  name: 'search_catalog',
  description: 'Search a product catalog with complex filters, sorting, and pagination',
  properties: {
    query: { type: 'string', description: 'Search query text' },
    filters: {
      type: 'array',
      description: 'Search filters',
      items: {
        type: 'object',
        description: 'A filter condition',
        required: ['field', 'operator', 'value'],
        properties: {
          field: { type: 'string', description: 'Field name to filter on' },
          operator: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'between'], description: 'Comparison operator' },
          value: { type: 'string', description: 'Filter value' },
          nested: {
            type: 'object',
            description: 'Nested filter for sub-documents',
            optional: true,
            properties: {
              sub_field: { type: 'string', description: 'Sub-field name' },
              sub_operator: { type: 'string', enum: ['eq', 'neq', 'contains'], description: 'Comparison operator for sub-field' },
              sub_value: { type: 'string', description: 'Value for sub-field comparison' },
            },
            required: ['sub_field', 'sub_operator', 'sub_value'],
          },
        },
      },
    },
    sort: {
      type: 'object',
      description: 'Sort configuration',
      required: ['field', 'order'],
      properties: {
        field: { type: 'string', description: 'Field to sort by' },
        order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
      },
    },
    pagination: {
      type: 'object',
      description: 'Pagination settings',
      properties: {
        page: { type: 'number', description: 'Page number (1-indexed)', optional: true },
        page_size: { type: 'number', description: 'Items per page', optional: true },
        include_metadata: { type: 'boolean', description: 'Include total count in response', optional: true },
      },
    },
  },
  required: ['query'],
};

// Tool 5: Discriminated union inside operation param (patchReportBuilderFields style)
const reportBuilderTool = {
  name: 'patchReportBuilderFields',
  description: 'Make targeted edits to specific fields/sections of a Report Builder report',
  properties: {
    operation: {
      type: 'object',
      description: 'Discriminated union: { op: "add" } | { op: "remove", index: number } | { op: "update", index: number, partial: object }',
    },
  },
  required: [],
};

// ─────────────────────────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────────────────────────

const simplePrompt = `Call the "get_user_info" tool to look up user "abc-123" and include their email.`;

const nestedPrompt = `Call the "configure_database" tool to create a PostgreSQL database called "prod-db".
Connect to host "db.example.com" on port 5432 using username "admin" and password "s3cret".
Enable SSL for the connection.`;

const deepPrompt = `Call the "deploy_application" tool to deploy an application called "api-gateway" at version "2.1.0".

Configuration:
- CPU: "4 cores", Memory: "8Gi"
- Auto-scaling: min 2 replicas, max 10 replicas, target CPU 75%
- One scaling rule: monitor "cpu_usage" at threshold 80, action "scale_up"
- Two environment variables: "NODE_ENV" = "production", "DB_URL" = "https://db.internal:5432", and make DB_URL a secret`;

const complexPrompt = `Call the "search_catalog" tool to search for "laptop" with the following filters:
- Filter by field "category" equals "electronics"
- Filter by field "price" is between "500" and "2000"
- Sort by field "rating" in descending order
- Page 1 with 20 items per page, include metadata`;

const reportBuilderAddPrompt = `Call the "patchReportBuilderFields" tool to add a new field to the report. The operation should be: op="add".`;

const reportBuilderRemovePrompt = `Call the "patchReportBuilderFields" tool to remove a field at index 2 from the report. The operation should be: op="remove", index=2.`;

const reportBuilderUpdatePrompt = `Call the "patchReportBuilderFields" tool to update the title field at index 0. The operation should be: op="update", index=0, partial={title:"Updated Title"}.`;

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

async function main() {
  loadEnv();

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not found in .env or .dev.vars');

  console.log(`🔑 Groq API key loaded: ${apiKey.slice(0, 8)}...`);
  console.log(`🤖 Model: ${MODEL}`);

  const groq = createGroq({ apiKey });

  const testCases = [
    { label: 'Simple flat schema (strict)', tool: simpleTool, prompt: simplePrompt, mode: 'strict' as const },
    { label: 'Nested 3-level schema (strict)', tool: nestedTool, prompt: nestedPrompt, mode: 'strict' as const },
    { label: 'Deep 4+ level + arrays schema (strict)', tool: deepTool, prompt: deepPrompt, mode: 'strict' as const },
    { label: 'Complex filters + arrays + enums (strict)', tool: complexTool, prompt: complexPrompt, mode: 'strict' as const },
    { label: 'Discriminated union: add op (strict)', tool: reportBuilderTool, prompt: reportBuilderAddPrompt, mode: 'strict' as const },
    { label: 'Discriminated union: remove op (strict)', tool: reportBuilderTool, prompt: reportBuilderRemovePrompt, mode: 'strict' as const },
    { label: 'Discriminated union: update op (strict)', tool: reportBuilderTool, prompt: reportBuilderUpdatePrompt, mode: 'strict' as const },
  ];

  const dualCases = [
    { label: 'Deep 4+ level + arrays (DUAL/loose provider)', tool: deepTool, prompt: deepPrompt, mode: 'dual' as const },
    { label: 'Complex filters + arrays (DUAL/loose provider)', tool: complexTool, prompt: complexPrompt, mode: 'dual' as const },
    { label: 'Discriminated union: add op (DUAL/loose)', tool: reportBuilderTool, prompt: reportBuilderAddPrompt, mode: 'dual' as const },
    { label: 'Discriminated union: update op (DUAL/loose)', tool: reportBuilderTool, prompt: reportBuilderUpdatePrompt, mode: 'dual' as const },
  ];

  const results: Array<{ label: string; result: Awaited<ReturnType<typeof testTool>> }> = [];

  for (const tc of testCases) {
    const result = await testTool(tc.label, tc.tool, tc.prompt, groq as any, tc.mode);
    results.push({ label: tc.label, result });
  }

  for (const tc of dualCases) {
    const result = await testTool(tc.label, tc.tool, tc.prompt, groq as any, tc.mode);
    results.push({ label: tc.label, result });
  }

  console.log(`\n\n${'='.repeat(80)}`);
  console.log(`📊 SUMMARY`);
  console.log(`${'='.repeat(80)}\n`);

  let passed = 0;
  let failed = 0;

  for (const { label, result } of results) {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    if (result.success) passed++;
    else failed++;

    console.log(`${status} | ${label}`);
    console.log(`   Schema: ${result.schemaUsed}`);
    if (result.error) {
      console.log(`   Error: ${result.error.slice(0, 300)}`);
    }
    if (result.rawArgs) {
      const argsStr = JSON.stringify(result.rawArgs, null, 2);
      console.log(`   Args: ${argsStr.length > 500 ? argsStr.slice(0, 500) + '...' : argsStr}`);
    }
    console.log(``);
  }

  console.log(`${'='.repeat(80)}`);
  console.log(`📊 FINAL: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(80)}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
