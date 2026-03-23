# Events Reference

## Client → Server Events

| Event | Description |
|-------|-------------|
| `session.update` | Update session configuration |
| `input_audio_buffer.append` | Append audio data |
| `input_audio_buffer.commit` | Commit audio buffer for processing |
| `input_audio_buffer.clear` | Clear audio buffer |
| `conversation.item.create` | Add item to conversation |
| `conversation.item.truncate` | Truncate item content |
| `conversation.item.delete` | Delete item from conversation |
| `response.create` | Create a new response |
| `response.cancel` | Cancel in-progress response |

## Server → Client Events

| Event | Description |
|-------|-------------|
| `session.created` | Session established |
| `session.updated` | Session configuration updated |
| `input_audio_buffer.transcribed` | Transcription available |
| `input_audio_buffer.speech_started` | Speech detected |
| `input_audio_buffer.speech_stopped` | Speech ended |
| `response.created` | Response generation started |
| `response.done` | Response completed |
| `response.text.delta` | Text delta available |
| `response.audio.delta` | Audio delta available |
| `response.audio_transcript.delta` | Audio transcript delta |
| `error` | Error occurred |

## Event Flow Example

```
Client: session.update
Server: session.updated
Client: input_audio_buffer.append (×N)
Server: input_audio_buffer.speech_started
Server: input_audio_buffer.speech_stopped
Client: input_audio_buffer.commit
Server: input_audio_buffer.transcribed
Client: response.create
Server: response.created
Server: response.text.delta (×N)
Server: response.audio.delta (×N)
Server: response.done
```
