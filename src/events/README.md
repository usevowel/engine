# Event System

Centralized event handling system for the VoiceAgent engine using RxJS for reactive event streaming.

## Overview

The event system provides a unified way to track and log events, metadata, and debug information throughout the engine. It uses RxJS Subjects to create a reactive event stream that can be consumed by multiple adapters.

## Architecture

```
EventEmitter (RxJS Subject)
    ↓
Event Stream (Observable<Event>)
    ↓
Adapters (ConsoleAdapter, custom adapters, etc.)
```

## Usage

### Basic Usage

```typescript
import { createEventSystem, EventCategory } from './events';

// Create event system with default console adapter
const eventSystem = createEventSystem();

// Emit events
eventSystem.info(EventCategory.SESSION, 'Session started', {
  sessionId: 'abc123',
  userId: 'user456',
});

eventSystem.error(EventCategory.AUDIO, 'Audio processing failed', error, {
  sessionId: 'abc123',
});
```

### Custom Configuration

```typescript
import { createEventSystem, EventCategory, EventLevel } from './events';

// Create with custom console adapter config
const eventSystem = createEventSystem({
  consoleConfig: {
    minLevel: EventLevel.INFO, // Only log INFO and above
    enableEmojis: true,
    enableMetadata: true,
  },
});
```

### Manual Adapter Registration

```typescript
import { EventEmitter, ConsoleAdapter } from './events';

const emitter = new EventEmitter();

// Register console adapter
const consoleAdapter = new ConsoleAdapter({
  minLevel: EventLevel.DEBUG,
});
emitter.registerAdapter(consoleAdapter);

// Later: Register a custom adapter if needed
// emitter.registerAdapter(customAdapter);
```

## Event Categories

- `SESSION` - Session lifecycle events
- `AUDIO` - Audio processing events
- `LLM` - LLM/agent events
- `STT` - Speech-to-text events
- `TTS` - Text-to-speech events
- `VAD` - Voice activity detection events
- `PROVIDER` - Provider-specific events
- `AUTH` - Authentication events
- `WEBSOCKET` - WebSocket connection events
- `PERFORMANCE` - Performance metrics
- `DEBUG` - Debug information
- `SYSTEM` - System-level events

## Event Levels

- `DEBUG` - Debug information (development only)
- `INFO` - Informational messages
- `WARN` - Warning messages
- `ERROR` - Error events
- `CRITICAL` - Critical errors requiring immediate attention

## Convenience Methods

The event emitter provides convenience methods for common event types:

```typescript
// Session events
eventSystem.sessionEvent('session_started', { sessionId: 'abc123' });

// Audio events
eventSystem.audioEvent('audio_received', { bytes: 1024 });

// Provider events
eventSystem.providerEvent('groq', 'transcription_complete', { duration: 150 });

// Performance metrics
eventSystem.performance('llm_latency', 250, 'ms', { model: 'gpt-4' });
```

## Creating Custom Adapters

To create a custom adapter, implement the `EventAdapter` interface:

```typescript
import { Subject, takeUntil } from 'rxjs';
import type { Event } from './types';
import type { EventAdapter } from './adapters';

export class CustomAdapter implements EventAdapter {
  private destroy$ = new Subject<void>();

  getName(): string {
    return 'custom';
  }

  initialize(eventStream: Observable<Event>): void {
    eventStream
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        // Send event to your backend or sink
      });
  }

  handle(event: Event): void {
    // Optional: handle individual events
  }

  cleanup(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
```

## Future Enhancements

- File adapter for persistent logging
- Filtering and transformation operators
- Event buffering for high-frequency events
- Event replay capabilities
