# Security Best Practices

Implement secure voice AI applications with sndbrd.

## Authentication Security

### Never Expose API Keys

```typescript
// ❌ BAD: API key in frontend
const API_KEY = 'sk-xxx...'  // Visible in browser

// ✅ GOOD: Token from backend
async function getToken() {
  const response = await fetch('/api/token');
  return response.json().token;  // Ephemeral, expires in 5 min
}
```

### Use Ephemeral Tokens

```typescript
// Ephemeral tokens have built-in security:
// - Short-lived (5 minutes)
// - Bound to specific session
// - Can be revoked immediately

const token = await fetchToken();
const client = new Vowel({ token });

// After session ends, token is invalid
client.on('disconnected', () => {
  console.log('Token is now invalid');
});
```

### Implement Token Refresh

```typescript
class SecureVoiceClient {
  private tokenExpiry: Date;
  
  async ensureValidToken() {
    const now = new Date();
    if (now >= this.tokenExpiry) {
      await this.refreshToken();
    }
  }
  
  private async refreshToken() {
    const response = await fetch('/api/token/refresh');
    const { token, expires_at } = await response.json();
    this.token = token;
    this.tokenExpiry = new Date(expires_at);
    client.updateToken(token);
  }
}
```

## WebSocket Security

### Use WSS (Secure WebSocket)

```typescript
// ❌ BAD: Insecure connection
const client = new Vowel({
  url: 'ws://api.example.com/v1/realtime'  // Not encrypted
});

// ✅ GOOD: Secure connection
const client = new Vowel({
  url: 'wss://api.example.com/v1/realtime'  // TLS encrypted
});
```

### Validate WebSocket Origin

Server-side origin validation:

```typescript
// src/workers/worker.ts
const ALLOWED_ORIGINS = new Set([
  'https://your-app.com',
  'https://app.your-app.com'
]);

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return new Response('Origin not allowed', { status: 403 });
    }
    
    // ... handle request
  }
}
```

## Data Security

### Sanitize User Input

```typescript
import DOMPurify from 'dompurify';

function sanitizeTranscript(text: string): string {
  // Remove HTML/JS injection
  return DOMPurify.sanitize(text);
}

// Display safely
const cleanTranscript = sanitizeTranscript(userInput);
element.innerHTML = cleanTranscript;
```

### Encrypt Sensitive Data

```typescript
import CryptoJS from 'crypto-js';

function encryptData(data: any, key: string): string {
  return CryptoJS.AES.encrypt(JSON.stringify(data), key).toString();
}

function decryptData(encrypted: string, key: string): any {
  const bytes = CryptoJS.AES.decrypt(encrypted, key);
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
}

// Use for tool calls with sensitive data
const sensitiveCall = {
  user_id: encrypt(userId, SECRET_KEY),
  action: 'get_balance'
};
```

## API Security

### Rate Limiting

```typescript
const RATE_LIMITS = {
  '/v1/realtime/sessions': {
    requests: 10,
    window: 60000  // 1 minute
  }
};

class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  
  checkLimit(endpoint: string, apiKey: string): boolean {
    const key = `${endpoint}:${apiKey}`;
    const now = Date.now();
    const requests = this.requests.get(key) || [];
    
    // Remove old requests outside window
    const valid = requests.filter(t => t > now - RATE_LIMITS[endpoint].window);
    this.requests.set(key, valid);
    
    if (valid.length >= RATE_LIMITS[endpoint].requests) {
      return false;  // Rate limit exceeded
    }
    
    valid.push(now);
    return true;
  }
}
```

### API Key Scoping

```typescript
enum ApiKeyScope {
  MINT_TOKEN = 'mint_ephemeral',
  DIRECT_WS = 'direct_ws',
  TOOLS = 'tools_execute'
}

// Create scoped keys for different use cases
const frontendKey = await createApiKey({
  scopes: [ApiKeyScope.DIRECT_WS],
  rateLimit: { requests: 100, window: 3600 }  // 100 req/hour
});

const serviceKey = await createApiKey({
  scopes: [ApiKeyScope.MINT_TOKEN, ApiKeyScope.TOOLS],
  rateLimit: { requests: 1000, window: 3600 }  // Higher limit
});
```

## Privacy & Compliance

### Audio Data Handling

```typescript
// Clear audio buffers after processing
client.on('audio_processed', () => {
  // Don't store raw audio longer than needed
  clearAudioBuffer();
});

// Never log sensitive content
client.on('transcript', (text) => {
  // ❌ BAD: Logging user speech
  logger.info('User said:', text);
  
  // ✅ GOOD: Log metadata only
  logger.info('Transcript received', { 
    length: text.length,
    language: detectedLanguage 
  });
});
```

### GDPR Compliance

```typescript
interface ConsentManager {
  hasAudioConsent(): boolean;
  hasStorageConsent(): boolean;
  requestConsent(): Promise<boolean>;
}

// Before recording
const consentManager = new ConsentManager();

async function startRecording() {
  const hasConsent = await consentManager.requestConsent();
  
  if (!hasConsent) {
    throw new Error('User has not consented to audio recording');
  }
  
  // Start recording with consent
  await startMicrophone();
}

// Right to be forgotten
async function deleteUser(userId: string) {
  // Delete all user data
  await database.deleteUser(userId);
  await revokeAllUserTokens(userId);
  await auditLog.userDeleted(userId);
}
```

## Audit Logging

```typescript
interface AuditEvent {
  type: 'token_created' | 'connection_established' | 'error';
  user_id?: string;
  session_id: string;
  timestamp: Date;
  ip_address: string;
  metadata?: Record<string, any>;
}

async function logAudit(event: AuditEvent) {
  await fetch('/audit/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...event,
      timestamp: new Date(),
      ip_address: request.ip
    })
  });
}

// Usage
await logAudit({
  type: 'connection_established',
  session_id: session.id,
  user_id: userId
});
```

## Security Checklist

- [ ] Never expose API keys in frontend code
- [ ] Always use WSS (secure WebSocket)
- [ ] Implement rate limiting on token generation
- [ ] Use scoped API keys for different services
- [ ] Sanitize all user inputs
- [ ] Encrypt sensitive data in transit and at rest
- [ ] Implement proper authentication (ephemeral tokens)
- [ ] Validate and sanitize WebSocket origins
- [ ] Implement audit logging
- [ ] Have a data retention and deletion policy
- [ ] Use HTTPS for all HTTP endpoints
- [ ] Enable CORS only for trusted origins
- [ ] Regular security audits and penetration testing

## Related

- [Authentication](/api/authentication) - Token-based authentication
- [Connection Paradigms](/architecture/connection-paradigms) - Secure integration patterns
- [Error Handling](/guides/error-handling) - Secure error handling
