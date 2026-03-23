# Weather Tool Demo Example

The demo now includes a hard-coded weather tool that returns fixed values.

## Tool Definition

Located in `demo/src/components/VoiceAgent.tsx`:

```typescript
const getWeatherTool = tool({
  name: 'get_weather',
  description: 'Get the current weather for a location. Returns temperature, conditions, and humidity.',
  parameters: z.object({
    location: z.string().describe('The city or location to get weather for'),
  }),
  execute: async ({ location }) => {
    console.log(`🌤️ [Tool] get_weather called for location: ${location}`);
    
    // Return hard-coded weather data
    const weatherData = {
      location,
      temperature: 79,
      unit: 'fahrenheit',
      conditions: 'windy and rainy',
      humidity: 68,
    };
    
    console.log(`🌤️ [Tool] Returning weather data:`, weatherData);
    return weatherData;
  },
});
```

## Hard-Coded Values

The tool always returns:
- **Temperature**: 79°F
- **Conditions**: windy and rainy  
- **Humidity**: 68%
- **Location**: Whatever the user asked for (echoed back)

## How to Test

1. Start the demo:
   ```bash
   cd demo
   npm run dev
   ```

2. Connect to the voice agent

3. Ask about weather:
   - "What's the weather like?"
   - "Tell me the weather in San Francisco"
   - "How's the weather today?"

4. The agent will:
   - Call the `get_weather` tool (executed on the client)
   - Return the hard-coded values
   - Speak a natural response like: "It's seventy nine degrees, windy and rainy with sixty eight percent humidity"

## Console Output

When the tool is called, you'll see:
```
🌤️ [Tool] get_weather called for location: San Francisco
🌤️ [Tool] Returning weather data: {location: "San Francisco", temperature: 79, unit: "fahrenheit", conditions: "windy and rainy", humidity: 68}
```

## Tool Flow

1. **User**: "What's the weather?"
2. **Server**: LLM decides to call `get_weather`
3. **Server → Client**: `function_call` event
4. **Client**: Executes `getWeatherTool.execute()` locally
5. **Client → Server**: `function_call_output` with hard-coded values
6. **Client → Server**: `response.create` to continue
7. **Server**: LLM generates natural response using tool output
8. **Client**: Plays TTS audio of response

## Adding More Tools

To add more tools, follow the same pattern in `VoiceAgent.tsx`:

```typescript
const anotherTool = tool({
  name: 'tool_name',
  description: 'Tool description',
  parameters: z.object({
    param: z.string(),
  }),
  execute: async ({ param }) => {
    return { result: 'value' };
  },
});

// Then add to agent:
const agent = new RealtimeAgent({
  name: 'Assistant',
  instructions: '...',
  tools: [getWeatherTool, anotherTool],
});
```

## Notes

- Tool execution happens **on the client**, not the server
- Server only coordinates the tool call flow
- Tools can do anything: API calls, local storage, browser APIs, etc.
- This matches OpenAI Realtime API behavior

