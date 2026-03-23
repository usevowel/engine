/**
 * ToolOrchestrator - Manages multi-step tool execution and repetition detection
 * 
 * This component provides intelligent tool orchestration for CustomAgent:
 * - Multi-step reasoning: Chain multiple tool calls automatically
 * - Repetition detection: Stop when AI repeats the same tool call
 * - Loop prevention: Detect and break infinite loops
 * - Step counting: Enforce maximum step limits
 * 
 * The ToolOrchestrator bridges the gap between CustomAgent's manual control
 * and VercelSDKAgent's automatic multi-step reasoning, providing similar
 * capabilities with more transparency and control.
 * 
 * @module ToolOrchestrator
 */

import { CoreMessage } from 'ai';

import { getEventSystem, EventCategory } from '../../../events';
/**
 * Configuration for ToolOrchestrator
 */
export interface ToolOrchestratorConfig {
  /** Maximum number of tool-calling steps (default: 3) */
  maxSteps?: number;
  
  /** Enable repetition detection (default: true) */
  enableRepetitionDetection?: boolean;
  
  /** Number of recent tool calls to check for repetition (default: 3) */
  repetitionWindowSize?: number;
}

/**
 * Tool call record for tracking
 */
interface ToolCallRecord {
  /** Tool name */
  toolName: string;
  
  /** Tool arguments (stringified for comparison) */
  args: string;
  
  /** Step number when called */
  stepNumber: number;
  
  /** Timestamp */
  timestamp: number;
}

/**
 * Orchestration state
 */
export interface OrchestrationState {
  /** Current step number */
  currentStep: number;
  
  /** Maximum steps allowed */
  maxSteps: number;
  
  /** Total tool calls made */
  totalToolCalls: number;
  
  /** Recent tool calls */
  recentToolCalls: ToolCallRecord[];
  
  /** Whether orchestration should stop */
  shouldStop: boolean;
  
  /** Reason for stopping (if stopped) */
  stopReason?: 'max-steps' | 'repetition' | 'no-tool-call' | 'manual';
}

/**
 * ToolOrchestrator - Manages multi-step tool execution
 * 
 * Provides intelligent orchestration of tool calls with repetition detection
 * and loop prevention.
 * 
 * @example
 * ```typescript
 * const orchestrator = new ToolOrchestrator({
 *   maxSteps: 5,
 *   enableRepetitionDetection: true,
 *   repetitionWindowSize: 3,
 * });
 * 
 * // Start orchestration
 * orchestrator.startStep();
 * 
 * // Record tool call
 * const shouldContinue = orchestrator.recordToolCall('navigate', { path: '/products' });
 * 
 * if (shouldContinue) {
 *   // Continue to next step
 *   orchestrator.startStep();
 * } else {
 *   // Stop orchestration
 *   const state = orchestrator.getState();
 *   getEventSystem().info(EventCategory.LLM, `Stopped: ${state.stopReason}`);
 * }
 * ```
 */
export class ToolOrchestrator {
  private config: Required<ToolOrchestratorConfig>;
  private state: OrchestrationState;
  private toolCallHistory: ToolCallRecord[] = [];
  
  constructor(config: ToolOrchestratorConfig = {}) {
    // Apply defaults
    this.config = {
      maxSteps: config.maxSteps ?? 3,
      enableRepetitionDetection: config.enableRepetitionDetection ?? true,
      repetitionWindowSize: config.repetitionWindowSize ?? 3,
    };
    
    // Initialize state
    this.state = {
      currentStep: 0,
      maxSteps: this.config.maxSteps,
      totalToolCalls: 0,
      recentToolCalls: [],
      shouldStop: false,
    };
    
    getEventSystem().info(EventCategory.LLM, '🎭 [ToolOrchestrator] Initialized');
    // Max steps logging removed - not needed for token-based tracking
    getEventSystem().info(EventCategory.LLM, `   Repetition Detection: ${this.config.enableRepetitionDetection}`);
    getEventSystem().info(EventCategory.LLM, `   Repetition Window: ${this.config.repetitionWindowSize}`);
  }
  
  /**
   * Start a new step
   * 
   * Call this before each LLM generation to increment the step counter
   * and check if we should stop.
   * 
   * @returns True if orchestration should continue, false if should stop
   */
  startStep(): boolean {
    this.state.currentStep++;
    
    // Step tracking removed - using token-based tracking instead
    
    // Check if we've exceeded max steps
    if (this.state.currentStep > this.config.maxSteps) {
      // Max steps reached - stop silently (no logging)
      this.state.shouldStop = true;
      this.state.stopReason = 'max-steps';
      return false;
    }
    
    return true;
  }
  
  /**
   * Record a tool call
   * 
   * Call this when the AI requests a tool call. This method:
   * 1. Records the tool call in history
   * 2. Checks for repetition
   * 3. Updates orchestration state
   * 
   * @param toolName - Name of the tool being called
   * @param args - Tool arguments
   * @returns True if orchestration should continue, false if should stop
   */
  recordToolCall(toolName: string, args: any): boolean {
    const record: ToolCallRecord = {
      toolName,
      args: JSON.stringify(args),
      stepNumber: this.state.currentStep,
      timestamp: Date.now(),
    };
    
    this.toolCallHistory.push(record);
    this.state.totalToolCalls++;
    this.state.recentToolCalls.push(record);
    
    // Keep only recent tool calls
    if (this.state.recentToolCalls.length > this.config.repetitionWindowSize) {
      this.state.recentToolCalls.shift();
    }
    
    getEventSystem().info(EventCategory.LLM, `🔧 [ToolOrchestrator] Tool call recorded: ${toolName} (total: ${this.state.totalToolCalls})`);
    
    // Check for repetition
    if (this.config.enableRepetitionDetection) {
      const isRepetition = this.detectRepetition(record);
      
      if (isRepetition) {
        getEventSystem().info(EventCategory.LLM, `🔁 [ToolOrchestrator] Repetition detected! Stopping orchestration.`);
        this.state.shouldStop = true;
        this.state.stopReason = 'repetition';
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Record that no tool call was made
   * 
   * Call this when the AI generates a response without calling any tools.
   * This indicates the task is complete.
   * 
   * @returns False (orchestration should stop)
   */
  recordNoToolCall(): boolean {
    getEventSystem().info(EventCategory.LLM, `✅ [ToolOrchestrator] No tool call - task complete`);
    this.state.shouldStop = true;
    this.state.stopReason = 'no-tool-call';
    return false;
  }
  
  /**
   * Detect if a tool call is a repetition
   * 
   * Checks if the same tool with the same arguments has been called
   * recently (within the repetition window).
   * 
   * @param record - Tool call record to check
   * @returns True if repetition detected, false otherwise
   */
  private detectRepetition(record: ToolCallRecord): boolean {
    // Need at least 2 calls to detect repetition
    if (this.state.recentToolCalls.length < 2) {
      return false;
    }
    
    // Check if this exact call (tool + args) has been made recently
    const recentCalls = this.state.recentToolCalls.slice(0, -1); // Exclude the current call
    
    for (const recentCall of recentCalls) {
      if (
        recentCall.toolName === record.toolName &&
        recentCall.args === record.args
      ) {
        getEventSystem().info(EventCategory.LLM, `🔁 [ToolOrchestrator] Repetition: ${record.toolName} called with same args`);
        getEventSystem().info(EventCategory.LLM, `   Previous: Step ${recentCall.stepNumber}`);
        getEventSystem().info(EventCategory.LLM, `   Current: Step ${record.stepNumber}`);
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Check if orchestration should stop
   * 
   * @returns True if should stop, false if should continue
   */
  shouldStop(): boolean {
    return this.state.shouldStop;
  }
  
  /**
   * Get current orchestration state
   * 
   * @returns Current state
   */
  getState(): Readonly<OrchestrationState> {
    return { ...this.state };
  }
  
  /**
   * Get tool call history
   * 
   * @returns Array of tool call records
   */
  getHistory(): Readonly<ToolCallRecord[]> {
    return [...this.toolCallHistory];
  }
  
  /**
   * Reset orchestration state
   * 
   * Call this to start a new orchestration session.
   */
  reset(): void {
    getEventSystem().info(EventCategory.LLM, '🔄 [ToolOrchestrator] Resetting state');
    
    this.state = {
      currentStep: 0,
      maxSteps: this.config.maxSteps,
      totalToolCalls: 0,
      recentToolCalls: [],
      shouldStop: false,
    };
    
    this.toolCallHistory = [];
  }
  
  /**
   * Stop orchestration manually
   * 
   * Call this to force stop orchestration (e.g., on user interrupt).
   */
  stop(): void {
    getEventSystem().info(EventCategory.LLM, '🛑 [ToolOrchestrator] Manual stop');
    this.state.shouldStop = true;
    this.state.stopReason = 'manual';
  }
  
  /**
   * Get statistics about tool usage
   * 
   * @returns Tool usage statistics
   */
  getStatistics(): {
    totalSteps: number;
    totalToolCalls: number;
    averageToolCallsPerStep: number;
    uniqueTools: string[];
    mostUsedTool: string | null;
  } {
    const uniqueTools = [...new Set(this.toolCallHistory.map(r => r.toolName))];
    
    // Count tool usage
    const toolCounts = new Map<string, number>();
    for (const record of this.toolCallHistory) {
      toolCounts.set(record.toolName, (toolCounts.get(record.toolName) || 0) + 1);
    }
    
    // Find most used tool
    let mostUsedTool: string | null = null;
    let maxCount = 0;
    for (const [tool, count] of toolCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostUsedTool = tool;
      }
    }
    
    return {
      totalSteps: this.state.currentStep,
      totalToolCalls: this.state.totalToolCalls,
      averageToolCallsPerStep: this.state.currentStep > 0
        ? this.state.totalToolCalls / this.state.currentStep
        : 0,
      uniqueTools,
      mostUsedTool,
    };
  }
}


