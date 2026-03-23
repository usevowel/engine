# Authentication

## Token Generation

Tokens are generated server-side and have a 5-minute expiration.

```bash
curl -X POST https://host/v1/realtime/sessions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "moonshotai/kimi-k2-instruct-0905",
    "voice": "Ashley"
  }'
```

Response:
```json
{
  "id": "session_id",
  "object": "realtime.session",
  "token": "ek_..."
}
```

## Token Structure

Tokens are JWTs signed with HMAC-SHA256.

```typescript
interface EphemeralToken {
  sub: string;        // Session ID
  exp: number;        // Expiration timestamp (5 min)
  iat: number;        // Issued at timestamp
  aud: string;        // Audience (worker URL)
}
```

## Security Best Practices

- Use HTTPS/WSS in production
- Never expose API_KEY in frontend code
- Rotate tokens periodically
- Implement rate limiting on token generation
