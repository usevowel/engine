# Voice Agent Demo

A simple vanilla JavaScript demo showing how to use the OpenAI Agents SDK with the sndbrd real-time voice API server.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file in the demo directory with your configuration:

```bash
# In the demo/ directory, create .env file
cat > .env << EOF
SERVER_URL=https://your-engine.example.com
SERVER_API_KEY=gsk_your_groq_api_key_here
EOF
```

Replace `gsk_your_groq_api_key_here` with your actual Groq API key.

### 3. Generate an Ephemeral Token

```bash
npm run generate-token
```

This will generate a token that's valid for 5 minutes. Copy the token - you'll need it in the next step.

### 4. Start the Demo

```bash
npm run dev
```

Open your browser to the URL shown (usually `http://localhost:5173`).

### 5. Connect and Talk

1. Click the "Connect" button
2. Paste the ephemeral token when prompted
3. Allow microphone access when asked
4. Start speaking!

## 🎯 Features

- ✅ Real-time voice conversation
- ✅ Live transcription display
- ✅ WebSocket connection to sndbrd server
- ✅ OpenAI Agents SDK integration
- ✅ Simple, clean UI
- ✅ Error handling

## 📋 How It Works

```
1. Generate ephemeral token (via npm run generate-token)
        ↓
2. User clicks "Connect" button
        ↓
3. App prompts for token
        ↓
4. Creates RealtimeAgent and RealtimeSession
        ↓
5. Connects to wss://your-engine.example.com/v1/realtime
        ↓
6. Microphone access requested
        ↓
7. User speaks → Audio sent to server
        ↓
8. Server transcribes → Sends to LLM → Generates TTS
        ↓
9. Audio response played back
        ↓
10. Transcripts displayed in UI
```

## 🔧 Customization

### Change Agent Instructions

Edit `main.js`:

```javascript
const agent = new RealtimeAgent({
  name: 'Assistant',
  instructions: 'You are a friendly pirate. Speak like one!', // ← Change this
});
```

### Change Voice

Edit the token generation in `generate-token.js`:

```javascript
body: JSON.stringify({
  model: 'moonshotai/kimi-k2-instruct-0905',
  voice: 'en_US-ryan-medium', // ← Change this
}),
```

Available voices:
- `en_US-ryan-medium` (default)
- Additional voices can be added by downloading from [Piper Voice Models](https://huggingface.co/rhasspy/piper-voices)

### Connect to Different Server

Edit `.env`:

```env
SERVER_URL=http://localhost:3001  # Your local server
```

## 🐛 Troubleshooting

### "Invalid token" Error

- Make sure the token starts with `ek_`
- Token expires after 5 minutes - generate a new one
- Check that your `SERVER_API_KEY` is correct

### Microphone Not Working

- Ensure you're on HTTPS or localhost
- Check browser permissions for microphone
- Try a different browser (Chrome/Edge recommended)

### Connection Failed

- Verify the server is accessible: `https://your-engine.example.com`
- Check your network connection
- Look at browser console for detailed errors

### No Audio Output

- Check your system volume
- Verify audio output device is working
- Look for errors in browser console

## 📁 Project Structure

```
demo/
├── index.html           # Main HTML page
├── main.js              # Voice agent logic
├── package.json         # Dependencies
├── generate-token.js    # Token generation script
├── .env.example         # Environment template
└── README.md           # This file
```

## 🔒 Security Notes

⚠️ **Important**: This demo prompts for tokens in the browser for simplicity. In production:

1. **Never expose `SERVER_API_KEY` in frontend code**
2. **Generate tokens from your backend**
3. **Implement user authentication**
4. **Add rate limiting**

See the [main quickstart guide](../QUICKSTART.md#example-production-backend-endpoint) for production examples.

## 📚 Learn More

- [Main Quickstart Guide](../QUICKSTART.md)
- [OpenAI Agents SDK Documentation](https://openai.github.io/openai-agents-js)
- [sndbrd Implementation Plan](../.ai/plans/real-time-server/POC-Implementation-Plan.md)
- [Moonshot Kimi K2 Instruct 0905](https://platform.moonshot.cn/docs/intro)

## 🤝 Contributing

Found a bug? Have a suggestion? Open an issue or submit a PR!

---

**Happy voice agent building! 🎙️✨**

