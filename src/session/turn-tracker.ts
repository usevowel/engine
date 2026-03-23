/**
 * Generic turn lifecycle tracker interface.
 *
 * Hosted runtimes can attach an implementation that observes STT/LLM/TTS
 * milestones and finalizes per-turn accounting outside the OSS engine.
 */
export interface SessionTurnTracker {
  startTurn(): unknown;
  trackSTTStart(): void;
  trackSTTComplete(): void;
  trackLLMStart(): void;
  trackLLMComplete(): void;
  trackLLMToolUsage(tokens: number): void;
  trackTTSStart(): void;
  trackTTSComplete(): void;
  trackAudioOutput(durationMs: number): void;
  endTurn(): Promise<void>;
  handleAbandonment(): Promise<void>;
  getCurrentTurn(): unknown;
}
