// Test jsonSchema import from within engine project
const { jsonSchema } = await import('@ai-sdk/provider-utils');
console.log('✅ jsonSchema imported:', typeof jsonSchema);

const schema = jsonSchema({
  type: 'object',
  properties: {
    operation: {
      anyOf: [
        {
          type: 'object',
          properties: {},
          additionalProperties: true,
          description: 'Discriminated union'
        },
        { type: 'null' }
      ]
    }
  },
  required: ['operation'],
  additionalProperties: false,
});

console.log('✅ Schema created:', typeof schema);
console.log('Has validate:', typeof schema.validate);
console.log('Has type:', schema.type);

// Try to get JSON schema
const jsonSchemaResult = typeof schema.jsonSchema === 'function' ? schema.jsonSchema() : schema.jsonSchema;
console.log('JSON Schema:', JSON.stringify(jsonSchemaResult, null, 2));
