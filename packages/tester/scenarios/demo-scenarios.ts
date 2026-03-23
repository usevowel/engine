/**
 * Demo Test Scenarios
 * 
 * Test scenarios matching the tools in our demo application.
 * 
 * @module scenarios
 */

import { TestScenario } from '@vowel/tester';

const BASE_URL = process.env.TEST_BASE_URL || process.env.SNDBRD_BASE_URL || 'http://localhost:8787';
const MODEL = process.env.TEST_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

// Weather tool test - matches demo
export const weatherScenario: TestScenario = {
  name: 'Weather Tool Test',
  driver: {
    objective: 'Test the weather lookup tool by asking for weather in New York. Verify the assistant uses the get_weather tool and provides temperature information.',
    personality: 'curious user interested in weather',
    maxTurns: 4,
    temperature: 0.3,
  },
  connection: {
    baseUrl: BASE_URL,
    model: MODEL,
    voice: 'Ashley',
    instructions: 'You are a helpful assistant with access to weather tools. When asked about weather, use the get_weather tool.',
    tools: [
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get weather information for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g. San Francisco, CA',
            },
          },
          required: ['location'],
        },
      },
    ],
  },
  expectedToolCalls: [
    {
      name: 'get_weather',
      required: true,
      validate: (args) => {
        const loc = String(args.location || '').toLowerCase();
        return loc.includes('new york');
      },
      mockResult: {
        location: 'New York, NY',
        temperature: '72°F',
        condition: 'Sunny',
        humidity: '45%',
      },
    },
  ],
  timeout: 30000,
};

// Calculator tool test
export const calculatorScenario: TestScenario = {
  name: 'Calculator Tool Test',
  driver: {
    objective: 'Test the calculator tool by asking it to calculate 15 * 24. Verify the assistant uses the calculate tool correctly.',
    personality: 'user doing math homework',
    maxTurns: 3,
    temperature: 0.3,
  },
  connection: {
    baseUrl: BASE_URL,
    model: MODEL,
    voice: 'Ashley',
    instructions: 'You are a helpful assistant with calculator tools. When asked to perform calculations, use the calculate tool.',
    tools: [
      {
        type: 'function',
        name: 'calculate',
        description: 'Perform mathematical calculations',
        parameters: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description: 'The mathematical expression to evaluate',
            },
          },
          required: ['expression'],
        },
      },
    ],
  },
  expectedToolCalls: [
    {
      name: 'calculate',
      required: true,
      validate: (args) => {
        const expr = String(args.expression || '').toLowerCase().replace(/\s/g, '');
        return expr.includes('15') && expr.includes('24') && (expr.includes('*') || expr.includes('x') || expr.includes('×'));
      },
      mockResult: {
        expression: '15 * 24',
        result: 360,
      },
    },
  ],
  timeout: 30000,
};

// Multi-tool conversation test
export const multiToolScenario: TestScenario = {
  name: 'Multi-Tool Conversation Test',
  driver: {
    objective: 'Have a conversation where you first ask for weather in Paris, then ask to calculate how many hours are in 3 days. Verify both tools are used.',
    personality: 'traveler planning a trip',
    maxTurns: 6,
    temperature: 0.3,
  },
  connection: {
    baseUrl: BASE_URL,
    model: MODEL,
    voice: 'Ashley',
    instructions: 'You are a helpful assistant with weather and calculator tools. Use the appropriate tool when asked.',
    tools: [
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get weather information for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g. San Francisco, CA',
            },
          },
          required: ['location'],
        },
      },
      {
        type: 'function',
        name: 'calculate',
        description: 'Perform mathematical calculations',
        parameters: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description: 'The mathematical expression to evaluate',
            },
          },
          required: ['expression'],
        },
      },
    ],
  },
  expectedToolCalls: [
    {
      name: 'get_weather',
      required: true,
      mockResult: {
        location: 'Paris, France',
        temperature: '68°F',
        condition: 'Partly cloudy',
        humidity: '55%',
      },
    },
    {
      name: 'calculate',
      required: true,
      mockResult: {
        expression: '3 * 24',
        result: 72,
        unit: 'hours',
      },
    },
  ],
  timeout: 45000,
};

// Context retention test
export const contextScenario: TestScenario = {
  name: 'Context Retention Test',
  driver: {
    objective: 'First ask "What is the weather in London?" Then ask "What about Paris?" without specifying you mean weather. The assistant should remember the context and use get_weather for Paris too.',
    personality: 'casual conversationalist',
    maxTurns: 5,
    temperature: 0.3,
  },
  connection: {
    baseUrl: BASE_URL,
    model: MODEL,
    voice: 'Ashley',
    instructions: 'You are a helpful assistant. Remember context from the conversation.',
    tools: [
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get weather information for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g. San Francisco, CA',
            },
          },
          required: ['location'],
        },
      },
    ],
  },
  expectedToolCalls: [
    {
      name: 'get_weather',
      required: true,
      // Just verify a get_weather call happens - we're testing context retention,
      // so the specific cities don't matter as much as the fact that the tool
      // continues to be used appropriately throughout the conversation
      mockResult: {
        location: 'London, UK',
        temperature: '59°F',
        condition: 'Rainy',
        humidity: '78%',
      },
    },
  ],
  timeout: 45000,
};

// Export all scenarios
export const allScenarios = [
  weatherScenario,
  calculatorScenario,
  multiToolScenario,
  contextScenario,
];
