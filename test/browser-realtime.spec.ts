/**
 * Playwright Browser Test for Real-time WebSocket Connection
 * 
 * Tests the WebSocket connection in a real browser environment,
 * which is the closest simulation to how the demo actually runs.
 */

import { test, expect, Page } from '@playwright/test';

const API_KEY = process.env.API_KEY || '';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

test.describe('Real-time WebSocket Connection', () => {
  
  test('should connect to WebSocket using browser environment', async ({ page }) => {
    // Enable console logging from the browser
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
      console.log(`Browser: [${msg.type()}] ${msg.text()}`);
    });
    
    // Track WebSocket frames
    const wsMessages: any[] = [];
    
    // Serve the test page from localhost to avoid CORS issues
    // Use file:// protocol to load local HTML
    const testPagePath = new URL('./test-page.html', import.meta.url).pathname;
    await page.goto(`file://${testPagePath}`);
    
    // Inject test script that mimics the demo
    const result = await page.evaluate(async ({ apiKey, apiBaseUrl }) => {
      const results: any = {
        tokenGeneration: { success: false, error: null, token: null },
        wsConnection: { success: false, error: null, messages: [], protocol: null },
      };
      
      try {
        // Step 1: Generate token
        console.log('🧪 Starting browser WebSocket test...');
        console.log('📝 Step 1: Generating ephemeral token...');
        
        const tokenResponse = await fetch(`${apiBaseUrl}/v1/realtime/sessions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'moonshotai/kimi-k2-instruct-0905',
          }),
        });
        
        if (!tokenResponse.ok) {
          const error = await tokenResponse.json();
          results.tokenGeneration.error = error;
          console.error('❌ Token generation failed:', error);
          return results;
        }
        
        const tokenData = await tokenResponse.json();
        const token = tokenData.client_secret.value;
        results.tokenGeneration.success = true;
        results.tokenGeneration.token = token.substring(0, 20) + '...';
        console.log('✅ Token generated:', token.substring(0, 20) + '...');
        
        // Step 2: Connect via WebSocket with browser-style subprotocols
        console.log('📝 Step 2: Connecting to WebSocket...');
        console.log('   URL:', `${apiBaseUrl.replace('http', 'ws')}/v1/realtime?model=moonshotai/kimi-k2-instruct-0905`);
        console.log('   Protocols:', ['realtime', `openai-insecure-api-key.${token}`, 'openai-beta.realtime-v1']);
        
        return new Promise((resolve) => {
          const wsUrl = `${apiBaseUrl.replace('http', 'ws')}/v1/realtime?model=moonshotai/kimi-k2-instruct-0905`;
          
          // This is exactly how the OpenAI SDK creates WebSockets in browsers
          const ws = new WebSocket(wsUrl, [
            'realtime',
            `openai-insecure-api-key.${token}`,
            'openai-beta.realtime-v1',
          ]);
          
          ws.onopen = () => {
            console.log('✅ WebSocket opened!');
            console.log('   Protocol selected:', ws.protocol || '(none)');
            console.log('   ReadyState:', ws.readyState);
            results.wsConnection.protocol = ws.protocol;
          };
          
          ws.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);
              console.log('📨 Received message:', message.type);
              results.wsConnection.messages.push(message);
              
              if (message.type === 'session.created') {
                console.log('✅ session.created event received!');
                console.log('   Session ID:', message.session.id);
                console.log('   Model:', message.session.model);
                console.log('   Voice:', message.session.voice);
                results.wsConnection.success = true;
                
                // Close and finish
                setTimeout(() => {
                  ws.close();
                  resolve(results);
                }, 500);
              }
            } catch (error: any) {
              console.error('❌ Error parsing message:', error.message);
              results.wsConnection.error = error.message;
            }
          };
          
          ws.onerror = (event: any) => {
            console.error('❌ WebSocket error:', event);
            results.wsConnection.error = 'WebSocket error event fired';
            results.wsConnection.success = false;
          };
          
          ws.onclose = (event) => {
            console.log('🔌 WebSocket closed');
            console.log('   Code:', event.code);
            console.log('   Reason:', event.reason || '(none)');
            console.log('   WasClean:', event.wasClean);
            
            if (!results.wsConnection.success) {
              results.wsConnection.error = `Closed with code ${event.code}: ${event.reason || '(none)'}`;
            }
            
            // Always resolve after a short delay to capture logs
            setTimeout(() => resolve(results), 500);
          };
          
          // Timeout after 5 seconds
          setTimeout(() => {
            if (ws.readyState !== WebSocket.CLOSED) {
              console.error('❌ Timeout - no session.created event received');
              results.wsConnection.error = 'Timeout waiting for session.created';
              ws.close();
            }
          }, 5000);
        });
        
      } catch (error: any) {
        console.error('❌ Test error:', error.message);
        results.tokenGeneration.error = error.message;
        return results;
      }
    }, { apiKey: API_KEY, apiBaseUrl: API_BASE_URL });
    
    // Log results
    console.log('\n📊 Test Results:');
    console.log('================');
    console.log('Token Generation:', result.tokenGeneration.success ? '✅ Success' : '❌ Failed');
    if (result.tokenGeneration.error) {
      console.log('  Error:', result.tokenGeneration.error);
    }
    console.log('\nWebSocket Connection:', result.wsConnection.success ? '✅ Success' : '❌ Failed');
    if (result.wsConnection.error) {
      console.log('  Error:', result.wsConnection.error);
    }
    console.log('  Protocol:', result.wsConnection.protocol || '(none)');
    console.log('  Messages received:', result.wsConnection.messages.length);
    result.wsConnection.messages.forEach((msg: any) => {
      console.log(`    - ${msg.type}`);
    });
    
    console.log('\n📋 All Console Logs:');
    consoleLogs.forEach(log => console.log('  ', log));
    
    // Assertions
    expect(result.tokenGeneration.success).toBe(true);
    expect(result.wsConnection.success).toBe(true);
    expect(result.wsConnection.messages.length).toBeGreaterThan(0);
    expect(result.wsConnection.messages[0].type).toBe('session.created');
  });
  
  test('should capture network activity', async ({ page }) => {
    const wsFrames: any[] = [];
    
    // Intercept WebSocket frames
    page.on('websocket', ws => {
      console.log(`WebSocket opened: ${ws.url()}`);
      
      ws.on('framesent', frame => {
        console.log('→ Sent:', frame.payload);
        wsFrames.push({ direction: 'sent', payload: frame.payload });
      });
      
      ws.on('framereceived', frame => {
        console.log('← Received:', frame.payload);
        wsFrames.push({ direction: 'received', payload: frame.payload });
      });
      
      ws.on('close', () => {
        console.log('WebSocket closed');
      });
    });
    
    await page.goto('about:blank');
    
    // Run the same test
    await page.evaluate(async ({ apiKey, apiBaseUrl }) => {
      const tokenResponse = await fetch(`${apiBaseUrl}/v1/realtime/sessions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'moonshotai/kimi-k2-instruct-0905' }),
      });
      
      const tokenData = await tokenResponse.json();
      const token = tokenData.client_secret.value;
      
      const ws = new WebSocket(
        `${apiBaseUrl.replace('http', 'ws')}/v1/realtime?model=moonshotai/kimi-k2-instruct-0905`,
        ['realtime', `openai-insecure-api-key.${token}`, 'openai-beta.realtime-v1']
      );
      
      return new Promise((resolve) => {
        ws.onmessage = () => {
          setTimeout(() => {
            ws.close();
            resolve(true);
          }, 500);
        };
        ws.onerror = () => resolve(false);
        ws.onclose = () => setTimeout(() => resolve(false), 500);
        setTimeout(() => resolve(false), 5000);
      });
    }, { apiKey: API_KEY, apiBaseUrl: API_BASE_URL });
    
    console.log('\n📡 WebSocket Frames:');
    wsFrames.forEach((frame, i) => {
      console.log(`  ${i + 1}. ${frame.direction}: ${frame.payload.substring(0, 100)}...`);
    });
  });
});

