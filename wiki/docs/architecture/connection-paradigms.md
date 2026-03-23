# Connection Paradigms

Advanced connection patterns for server-side integrations, multi-client sessions, and enterprise deployments.

## Overview

sndbrd supports multiple connection paradigms beyond simple client-side integration. Each paradigm offers different trade-offs between security, control, and complexity.

## Paradigm Comparison

| Paradigm | Token Source | Session Correlation | Best For |
|----------|--------------|---------------------|----------|
| **Direct** | Client → API | `sessionId` | Simple browser integrations |
| **Fixed API Key** | Backend `vkey_xxx` | `sessionId` | Server-side tool execution |
| **Developer-Managed** | Backend mints | `sessionKey` | Full backend control |
| **Sidecar** | Multiple sources | `sessionKey` | Client + server collaboration |
| **OpenAI Compatible** | `call_id` param | `call_id` | Migration from OpenAI |

---

## Direct Connection

The simplest paradigm where clients request tokens directly from the API.

### Flow

```
┌─────────┐         ┌─────────┐
│ Client  │────────▶│  sndbrd │────────▶ Voice Session
│         │ Request │   API   │
│         │◀────────│         │
│         │ Token   │         │
└─────────┘         └─────────┘
```

### Usage

```typescript
const response = await fetch('https://api.vowel.to/v1/realtime/sessions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'moonshotai/kimi-k2-instruct-0905',
    voice: 'Ashley',
  }),
});

const { client_secret } = await response.json();
```

### Analytics Properties

```typescript
{
  connection_paradigm: 'direct',
  api_key_id: 'key_xxx...',
}
```

---

## Fixed API Key

Long-lived API keys for trusted backend services. Ideal for server-side tool execution without user authentication.

### Creating an API Key

Key format: `vkey_{32_hex_characters}`

### Usage

```typescript
const API_KEY = process.env.SNDBRD_API_KEY;

const response = await fetch(`${BASE_URL}/v1/realtime/sessions`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'moonshotai/kimi-k2-instruct-0905',
    tools: [
      {
        type: 'function',
        name: 'serverAction',
        description: 'Execute server-side action',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            params: { type: 'object' },
          },
        },
      },
    ],
  }),
});
```

### Security Best Practices

- Never expose fixed API keys in client-side code
- Store in environment variables or secret management
- Rotate keys regularly (every 90 days recommended)
- Use scope restrictions (least privilege)

---

## Developer-Managed Ephemeral Tokens

Your backend generates short-lived tokens for clients, giving you full control over session creation and security.

### Flow

```
┌─────────┐         ┌─────────┐         ┌─────────┐
│ Client  │────────▶│ Backend │────────▶│  sndbrd │
│         │ Request │         │ Mint    │   API   │
│         │◀────────│         │◀────────│         │
│         │ Token   │         │ Token   │         │
└─────────┘         └─────────┘         └─────────┘
     │
     │ Connect with token
     ▼
┌─────────┐
│  Voice  │
│ Session │
└─────────┘
```

### Backend Implementation

```typescript
app.post('/api/sndbrd/token', async (req, res) => {
  const userId = await authenticateUser(req);
  const sessionKey = `sesskey_${crypto.randomBytes(16).toString('hex')}`;

  const response = await fetch(`${SNDBRD_API_URL}/v1/realtime/sessions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SNDBRD_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'moonshotai/kimi-k2-instruct-0905',
      sessionKey: sessionKey,
    }),
  });

  const { client_secret } = await response.json();
  res.json({ token: client_secret.value, sessionKey });
});
```

---

## Sidecar Pattern

Multiple connections (client + server) join the same session. Both can define tools, and all connections share conversation history.

### Architecture

```
┌─────────┐         ┌─────────┐
│ Client  │────────▶│         │
│         │         │         │
└─────────┘         │  sndbrd │
                    │ Session │
┌─────────┐         │         │
│ Server  │────────▶│         │
│         │         │         │
└─────────┘         └─────────┘
     │                   │
     │ Same sessionKey   │
     └───────────────────┘
```

### Multi-Client Collaboration

```typescript
// Client 1: Creates session
const { sessionKey, token } = await createSidecarSession();

// Client 2: Joins same session using sessionKey
const { token: token2 } = await getTokenForSession(sessionKey);

const client2 = new Vowel({ token: token2 });
// Both clients share conversation and tools
```

### Events Tracked

| Event | Description |
|-------|-------------|
| `sidecar_joined` | Second connection enters session |
| `sidecar_left` | Connection leaves shared session |
| `session_closed` | Final client disconnects |

---

## OpenAI Compatible

For migration from OpenAI Realtime API, use `call_id` query parameter for session correlation.

### Usage

```typescript
const sessionKey = 'existing-openai-session-id';

const ws = new WebSocket(
  `wss://api.vowel.to/v1/realtime?call_id=${sessionKey}`,
  {
    headers: { 'Authorization': `Bearer ${token}` },
  }
);
```

---

## SessionKey Format

SessionKeys follow this format: `sesskey_{32_hex_characters}`

Used for:
- Correlating client and server connections (sidecar)
- Tracking developer-managed sessions
- OpenAI compatibility (`call_id`)

---

## Choosing a Paradigm

| Requirement | Recommended Paradigm |
|-------------|---------------------|
| Simple browser integration | Direct |
| Server-side tool execution | Fixed API Key |
| Full backend control | Developer-Managed |
| Client + server collaboration | Sidecar |
| Migration from OpenAI | OpenAI Compatible |

### Decision Tree

```
Is this a server-side only use case?
├─ YES → Use Fixed API Key
└─ NO → Do you need multiple connections to same session?
    ├─ YES → Use Sidecar Pattern
    └─ NO → Do you need backend control over token generation?
        ├─ YES → Use Developer-Managed
        └─ NO → Use Direct
```
