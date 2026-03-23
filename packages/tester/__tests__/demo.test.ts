/**
 * Demo Tests
 * 
 * Run demo scenarios against the voice agent.
 * 
 * @module __tests__
 */

import { describe, test, expect } from 'bun:test';
import { TestHarness } from '../src/index.js';
import {
  weatherScenario,
  calculatorScenario,
  multiToolScenario,
  contextScenario,
} from '../scenarios/demo-scenarios.js';

// Get API key from environment
const API_KEY = process.env.API_KEY || '';

// Skip tests if no API key
const runTests = API_KEY ? describe : describe.skip;

runTests('Demo Scenarios', () => {
  const harness = new TestHarness(API_KEY);

  test('Weather Tool Test', async () => {
    const result = await harness.runScenario(weatherScenario);
    
    console.log('\n📊 Weather Test Results:');
    console.log(`   Passed: ${result.passed}`);
    console.log(`   Duration: ${result.duration}ms`);
    console.log(`   Turns: ${result.turns}`);
    console.log(`   Tool Calls: ${result.toolCalls.length}`);
    console.log(`   Evaluation: ${result.evaluation}`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    
    expect(result.passed).toBe(true);
  }, { timeout: 60000 });

  test('Calculator Tool Test', async () => {
    const result = await harness.runScenario(calculatorScenario);
    
    console.log('\n📊 Calculator Test Results:');
    console.log(`   Passed: ${result.passed}`);
    console.log(`   Duration: ${result.duration}ms`);
    console.log(`   Turns: ${result.turns}`);
    console.log(`   Tool Calls: ${result.toolCalls.length}`);
    console.log(`   Evaluation: ${result.evaluation}`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    
    expect(result.passed).toBe(true);
  }, { timeout: 60000 });

  test('Multi-Tool Conversation Test', async () => {
    const result = await harness.runScenario(multiToolScenario);
    
    console.log('\n📊 Multi-Tool Test Results:');
    console.log(`   Passed: ${result.passed}`);
    console.log(`   Duration: ${result.duration}ms`);
    console.log(`   Turns: ${result.turns}`);
    console.log(`   Tool Calls: ${result.toolCalls.length}`);
    console.log(`   Evaluation: ${result.evaluation}`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    
    expect(result.passed).toBe(true);
  }, { timeout: 90000 });

  test('Context Retention Test', async () => {
    const result = await harness.runScenario(contextScenario);
    
    console.log('\n📊 Context Test Results:');
    console.log(`   Passed: ${result.passed}`);
    console.log(`   Duration: ${result.duration}ms`);
    console.log(`   Turns: ${result.turns}`);
    console.log(`   Tool Calls: ${result.toolCalls.length}`);
    console.log(`   Evaluation: ${result.evaluation}`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    
    expect(result.passed).toBe(true);
  }, { timeout: 90000 });
});
