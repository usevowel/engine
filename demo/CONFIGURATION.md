# Demo Configuration Guide

This guide explains how to configure the demo to work with different server deployments.

---

## Quick Start

The demo has **3 configuration files** that need to match:

1. **`src/config.ts`** - Frontend WebSocket and token endpoint
2. **`server.js`** - Demo backend token proxy
3. **`generate-token.js`** - CLI token generator

All three files use the same comment-block pattern for easy switching.

---

## Configuration Options

### 🔧 Option 1: Localhost Wrangler (Default)

**Use Case:** Testing Cloudflare Workers locally with `wrangler dev`

**Server:** `http://localhost:8787`

**Setup:**
1. Start Wrangler dev server:
   ```bash
   cd workers
   bun x wrangler dev
   ```

2. Start demo backend (token proxy):
   ```bash
   cd demo
   node server.js
   ```
   
   > **Note:** The demo backend acts as a secure proxy for token generation. It has the API_KEY and calls the Workers endpoint, so the frontend never sees the API_KEY.

3. Start demo frontend:
   ```bash
   cd demo
   bun run dev
   ```

**Config Pattern:**
- WebSocket: Connects directly to Workers (`ws://localhost:8787`)
- Tokens: Proxied through demo backend (`http://localhost:3002/api/token`)
- Security: API_KEY stays server-side ✅

---

### 🔧 Option 2: Localhost Bun Server

**Use Case:** Testing original Bun server implementation

**Server:** `http://localhost:3001`

**Setup:**
1. In **`src/config.ts`**, uncomment Option 2:
   ```typescript
   // Comment out Option 1
   // export const CONFIG = {
   //   serverUrl: 'ws://localhost:8787/v1/realtime',
   //   ...
   // } as const;
   
   // Uncomment Option 2
   export const CONFIG = {
     serverUrl: 'ws://localhost:3001/v1/realtime',
     tokenEndpoint: 'http://localhost:3002/api/token',
     model: 'moonshotai/kimi-k2-instruct-0905',
     voice: 'en_US-hfc_female-medium',
   } as const;
   ```

2. In **`server.js`**, uncomment Option 2:
   ```javascript
   // Comment out Option 1
   // let API_BASE_URL = 'http://localhost:8787';
   
   // Uncomment Option 2
   let API_BASE_URL = 'http://localhost:3001';
   ```

3. In **`generate-token.js`**, uncomment Option 2:
   ```javascript
   // Comment out Option 1
   // const API_BASE_URL = 'http://localhost:8787';
   
   // Uncomment Option 2
   const API_BASE_URL = 'http://localhost:3001';
   ```

4. Start Bun server:
   ```bash
   bun run dev
   ```

5. Start demo backend:
   ```bash
   cd demo
   node server.js
   ```

6. Start demo frontend:
   ```bash
   cd demo
   bun run dev
   ```

---

### 🔧 Option 3: Production Cloudflare Workers

**Use Case:** Testing against deployed Workers

**Server:** `https://your-engine.example.com`

**Setup:**
1. Uncomment Option 3 in all three files:
   
   **`src/config.ts`:**
   ```typescript
   export const CONFIG = {
     serverUrl: 'wss://your-engine.example.com/v1/realtime',
     tokenEndpoint: 'http://localhost:3002/api/token', // Still proxy for security
     model: 'moonshotai/kimi-k2-instruct-0905',
     voice: 'Ashley',
   } as const;
   ```
   
   **`server.js`:**
   ```javascript
   let API_BASE_URL = 'https://your-engine.example.com';
   ```
   
   **`generate-token.js`:**
   ```javascript
   const API_BASE_URL = 'https://your-engine.example.com';
   ```

2. Start demo backend (token proxy):
   ```bash
   cd demo
   node server.js
   ```

3. Start demo frontend:
   ```bash
   cd demo
   bun run dev
   ```

> **Security Note:** Even in production testing, tokens are proxied through the local backend to keep API_KEY secure.

---

### 🔧 Option 4: Test Tunnel

**Use Case:** Testing against test deployment

**Server:** `https://tunnel.example.com`

**Setup:**
1. Uncomment Option 4 in all three files (same pattern as Option 3)

---

## Configuration Files Reference

### Frontend Config (`src/config.ts`)

Controls:
- WebSocket connection URL
- Token endpoint URL
- Model selection
- Voice selection

### Backend Proxy (`server.js`)

Controls:
- Which server to proxy token requests to
- Runs on port `3002` for Bun server mode
- Not needed for Workers mode (Workers handles tokens directly)

### Token Generator (`generate-token.js`)

Controls:
- Which server to request tokens from
- CLI utility for testing

---

## Common Patterns

### Testing Locally (Workers)

```bash
# Terminal 1: Start Wrangler
cd workers
bun x wrangler dev

# Terminal 2: Start Demo
cd demo
bun run dev

# Browser: http://localhost:5173
```

**Config:** All files use Option 1 ✅

---

### Testing Locally (Bun)

```bash
# Terminal 1: Start Bun Server
bun run dev

# Terminal 2: Start Demo Backend
cd demo
node server.js

# Terminal 3: Start Demo Frontend
cd demo
bun run dev

# Browser: http://localhost:5173
```

**Config:** All files use Option 2

---

### Testing Production

```bash
# Terminal 1: Start Demo
cd demo
bun run dev

# Browser: http://localhost:5173
```

**Config:** All files use Option 3

---

## Troubleshooting

### Token Generation Fails

**Problem:** `Failed to generate token`

**Solution:**
1. Verify all three config files point to the same server
2. Check server is running (for localhost options)
3. Verify API_KEY is set in root `.env`

### WebSocket Connection Fails

**Problem:** `WebSocket connection failed`

**Solution:**
1. Verify `src/config.ts` matches the running server
2. Check server is running and accessible
3. For localhost: ensure port is correct (8787 for Workers, 3001 for Bun)

### CORS Errors

**Problem:** `CORS policy blocked`

**Solution:**
- For localhost: servers should allow `localhost:5173`
- For production: configure CORS in Workers/Bun deployment

---

## Quick Checklist

When switching configurations:

- [ ] Update `src/config.ts`
- [ ] Update `server.js`
- [ ] Update `generate-token.js`
- [ ] Restart demo server if needed
- [ ] Hard refresh browser (`Cmd+Shift+R` / `Ctrl+Shift+R`)

---

## Advanced: Environment Variables

For CI/CD or dynamic configuration, you can use environment variables:

**Uncomment Option 5 in `src/config.ts`:**
```typescript
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
export const CONFIG = {
  serverUrl: `${API_BASE_URL.replace(/^http/, 'ws')}/v1/realtime`,
  tokenEndpoint: `${API_BASE_URL}/v1/realtime/sessions`,
  model: 'moonshotai/kimi-k2-instruct-0905',
  voice: 'Ashley',
} as const;
```

Then set via environment:
```bash
VITE_API_BASE_URL=https://your-engine.example.com bun run dev
```

---

**Last Updated:** November 9, 2025

