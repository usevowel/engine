# Changelog

All notable changes to the vowel engine are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### STT/TTS Provider Selection via Token Configuration

Added support for configuring speech providers through the token system.

**Features:**
- Token payload includes `providerConfig` with stt/tts provider selection
- Session bootstrap extracts provider config from JWT token
- Supports STT provider, model, and language configuration
- Supports TTS provider, model, and voice configuration
- Token config takes precedence over app defaults and engine env defaults

**Important - Dev-Only Feature:**
This is a **development-only feature**. In production, speech providers should be configured through app presets, not client token overrides.

## [0.1.0] - 2025-03-23

### Added
- Modular provider system for STT, TTS, and VAD
- Deepgram STT and TTS provider implementation
- OpenAI-compatible LLM provider gateway
- Groq LLM provider integration
- OpenRouter LLM provider integration (100+ models)
- Vercel AI SDK integration for agent handling
- Conversation summarization for long conversations
- Acknowledgement responses for improved perceived responsiveness
- Typing sounds during AI processing
- Modular agent system with VercelSDKAgent and CustomAgent
- WebSocket connection handling with session management

### Changed
- Refactored to separate proprietary provider references for OSS release
- Removed Cloudflare-specific references from public documentation
- Updated README with beta release notice

### Fixed
- Deepgram STT/TTS voice stack stability
- Streaming STT preservation for integrated VAD providers on session.update

### Dependencies
- Updated all engine dependencies to latest compatible versions
- Added auto-download of VAD model and CPU-only execution support

## [0.0.1] - 2025-03-16

### Added
- Initial open-source release
- Basic WebSocket realtime API server
- Token generation and authentication
- Session management

---

[Unreleased]: https://github.com/usevowel/engine/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/usevowel/engine/releases/tag/v0.1.0
[0.0.1]: https://github.com/usevowel/engine/releases/tag/v0.0.1