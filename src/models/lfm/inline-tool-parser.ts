import {
  extractPythonicToolCall,
  repairPythonicToolCall,
  type PythonicToolCall,
} from '../shared/pythonic-tool-call';

export interface InlineParserUpdate {
  textDelta?: string;
  toolCall?: PythonicToolCall;
}

export class LfmInlineToolParser {
  private readonly toolStartToken = '<|tool_call_start|>';
  private textBuffer = '';
  private toolBuffer = '';
  private inToolCall = false;

  pushDelta(delta: string): InlineParserUpdate[] {
    if (!delta) {
      return [];
    }

    const updates: InlineParserUpdate[] = [];

    if (this.inToolCall) {
      this.toolBuffer += delta;
      const toolUpdate = this.tryExtractToolCall();
      if (toolUpdate) {
        updates.push(toolUpdate);
      }
      return updates;
    }

    this.textBuffer += delta;
    const startIndex = this.textBuffer.indexOf(this.toolStartToken);
    if (startIndex === -1) {
      const overlapLength = this.getTokenPrefixOverlap(this.textBuffer);
      const safePrefix = this.textBuffer.slice(0, this.textBuffer.length - overlapLength);
      this.textBuffer = this.textBuffer.slice(this.textBuffer.length - overlapLength);

      if (safePrefix) {
        updates.push({ textDelta: safePrefix });
      }

      return updates;
    }

    const safeText = this.textBuffer.slice(0, startIndex);
    if (safeText) {
      updates.push({ textDelta: safeText });
    }

    this.inToolCall = true;
    this.toolBuffer = this.textBuffer.slice(startIndex);
    this.textBuffer = '';

    const toolUpdate = this.tryExtractToolCall();
    if (toolUpdate) {
      updates.push(toolUpdate);
    }

    return updates;
  }

  flush(): InlineParserUpdate[] {
    const updates: InlineParserUpdate[] = [];

    if (this.inToolCall) {
      const repaired = repairPythonicToolCall(this.toolBuffer);
      const toolCall = extractPythonicToolCall(repaired.repaired);
      if (toolCall) {
        toolCall.repairsApplied = repaired.repairsApplied;
        updates.push({ toolCall });
      }

      this.toolBuffer = '';
      this.inToolCall = false;
    }

    if (this.textBuffer) {
      if (this.toolStartToken.startsWith(this.textBuffer)) {
        this.textBuffer = '';
        return updates;
      }

      updates.push({ textDelta: this.textBuffer });
      this.textBuffer = '';
    }

    return updates;
  }

  private tryExtractToolCall(): InlineParserUpdate | null {
    const extracted = extractPythonicToolCall(this.toolBuffer);
    if (!extracted) {
      return null;
    }

    this.toolBuffer = '';
    this.inToolCall = false;
    return { toolCall: extracted };
  }

  private getTokenPrefixOverlap(text: string): number {
    const maxLength = Math.min(text.length, this.toolStartToken.length - 1);
    for (let length = maxLength; length > 0; length -= 1) {
      if (text.endsWith(this.toolStartToken.slice(0, length))) {
        return length;
      }
    }

    return 0;
  }
}
