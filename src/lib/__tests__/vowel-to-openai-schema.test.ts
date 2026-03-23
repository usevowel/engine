/**
 * Tests for Vowel to OpenAI Schema Converter
 */

import { describe, test, expect } from 'bun:test';
import { convertVowelToolToOpenAIFormat, convertVowelToolsToOpenAIFormat } from '../vowel-to-openai-schema';

describe('convertVowelToolToOpenAIFormat', () => {
  test('converts Vowel format with all optional parameters', () => {
    const vowelTool = {
      type: 'function',
      name: 'searchProducts',
      description: 'Search for products',
      parameters: {
        query: { 
          type: 'string', 
          description: 'Search query',
          optional: true
        },
        maxPrice: {
          type: 'number',
          description: 'Maximum price',
          optional: true
        },
        inStock: {
          type: 'boolean',
          description: 'Only in-stock items',
          optional: true
        }
      }
    };

    const result = convertVowelToolToOpenAIFormat(vowelTool);

    expect(result.parameters.type).toBe('object');
    expect(result.parameters.properties).toBeDefined();
    expect(result.parameters.properties.query).toEqual({
      type: 'string',
      description: 'Search query'
    });
    expect(result.parameters.properties.maxPrice).toEqual({
      type: 'number',
      description: 'Maximum price'
    });
    expect(result.parameters.properties.inStock).toEqual({
      type: 'boolean',
      description: 'Only in-stock items'
    });
    expect(result.parameters.required).toEqual([]);
    expect(result.parameters.additionalProperties).toBe(false);
  });

  test('converts Vowel format with mixed required/optional parameters', () => {
    const vowelTool = {
      type: 'function',
      name: 'addToCart',
      description: 'Add product to cart',
      parameters: {
        productId: { 
          type: 'string', 
          description: 'Product ID',
          optional: false
        },
        quantity: {
          type: 'number',
          description: 'Quantity',
          optional: true
        }
      }
    };

    const result = convertVowelToolToOpenAIFormat(vowelTool);

    expect(result.parameters.required).toEqual(['productId']);
    expect(result.parameters.properties.productId).toEqual({
      type: 'string',
      description: 'Product ID'
    });
    expect(result.parameters.properties.quantity).toEqual({
      type: 'number',
      description: 'Quantity'
    });
  });

  test('passes through OpenAI format unchanged', () => {
    const openAITool = {
      type: 'function',
      name: 'searchProducts',
      description: 'Search for products',
      parameters: {
        type: 'object',
        properties: {
          query: { 
            type: 'string', 
            description: 'Search query'
          }
        },
        required: [],
        additionalProperties: false
      }
    };

    const result = convertVowelToolToOpenAIFormat(openAITool);

    expect(result).toEqual(openAITool);
  });

  test('handles tool with no parameters', () => {
    const vowelTool = {
      type: 'function',
      name: 'getPageSnapshot',
      description: 'Get page snapshot',
      parameters: {}
    };

    const result = convertVowelToolToOpenAIFormat(vowelTool);

    expect(result.parameters.type).toBe('object');
    expect(result.parameters.properties).toEqual({});
    expect(result.parameters.required).toEqual([]);
    expect(result.parameters.additionalProperties).toBe(false);
  });

  test('preserves enum values', () => {
    const vowelTool = {
      type: 'function',
      name: 'pressKey',
      description: 'Press a key',
      parameters: {
        key: {
          type: 'string',
          description: 'Key name',
          enum: ['Enter', 'Escape', 'Tab'],
          optional: false
        }
      }
    };

    const result = convertVowelToolToOpenAIFormat(vowelTool);

    expect(result.parameters.properties.key.enum).toEqual(['Enter', 'Escape', 'Tab']);
    expect(result.parameters.required).toEqual(['key']);
  });

  test('handles parameters without optional flag (defaults to required)', () => {
    const vowelTool = {
      type: 'function',
      name: 'navigate',
      description: 'Navigate to path',
      parameters: {
        path: {
          type: 'string',
          description: 'Path to navigate to'
          // No optional flag - should be required
        }
      }
    };

    const result = convertVowelToolToOpenAIFormat(vowelTool);

    expect(result.parameters.required).toEqual(['path']);
  });
});

describe('convertVowelToolsToOpenAIFormat', () => {
  test('converts array of tools', () => {
    const vowelTools = [
      {
        type: 'function',
        name: 'tool1',
        description: 'Tool 1',
        parameters: {
          param1: { type: 'string', optional: true }
        }
      },
      {
        type: 'function',
        name: 'tool2',
        description: 'Tool 2',
        parameters: {
          param2: { type: 'number', optional: false }
        }
      }
    ];

    const result = convertVowelToolsToOpenAIFormat(vowelTools);

    expect(result).toHaveLength(2);
    expect(result[0].parameters.type).toBe('object');
    expect(result[0].parameters.required).toEqual([]);
    expect(result[1].parameters.type).toBe('object');
    expect(result[1].parameters.required).toEqual(['param2']);
  });

  test('handles empty array', () => {
    const result = convertVowelToolsToOpenAIFormat([]);
    expect(result).toEqual([]);
  });
});
