import type { JsonObject } from '../json.js';
import type { FinishReason } from '../enums.js';
import type { ToolCall } from '../value-objects/tool-call.js';
import type { Usage } from '../value-objects/usage.js';

/**
 * What a stream emits.
 *
 * The reference defines twenty event types; this port emits the seven that
 * OpenAI and Anthropic actually produce through the paths implemented here.
 * The enum lists ONLY those seven rather than all twenty, deliberately: a
 * member nothing can ever emit reads to a consumer as a case they must handle,
 * and writing a branch for an event that never arrives is worse than not
 * knowing it exists. They are added when a provider can emit them.
 */
export enum StreamEventType {
  StreamStart = 'stream_start',
  TextStart = 'text_start',
  TextDelta = 'text_delta',
  TextComplete = 'text_complete',
  ToolCall = 'tool_call',
  Error = 'error',
  StreamEnd = 'stream_end',
}

let counter = 0;

/** Unique within a process, and cheap. Streams are correlated by run, not by this. */
export function eventId(prefix = 'evt'): string {
  counter += 1;

  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export abstract class StreamEvent {
  readonly id: string;

  readonly timestamp: number;

  constructor(id?: string, timestamp?: number) {
    this.id = id ?? eventId();
    this.timestamp = timestamp ?? Date.now();
  }

  abstract type(): StreamEventType;

  abstract toObject(): JsonObject;

  protected base(): JsonObject {
    return { id: this.id, timestamp: this.timestamp, type: this.type() };
  }
}

export class StreamStartEvent extends StreamEvent {
  constructor(
    readonly model: string,
    id?: string,
    timestamp?: number,
  ) {
    super(id, timestamp);
  }

  type(): StreamEventType {
    return StreamEventType.StreamStart;
  }

  toObject(): JsonObject {
    return { ...this.base(), model: this.model };
  }
}

export class TextStartEvent extends StreamEvent {
  constructor(
    readonly messageId: string,
    id?: string,
    timestamp?: number,
  ) {
    super(id, timestamp);
  }

  type(): StreamEventType {
    return StreamEventType.TextStart;
  }

  toObject(): JsonObject {
    return { ...this.base(), message_id: this.messageId };
  }
}

/** The one a consumer renders. Everything else is bookkeeping around it. */
export class TextDeltaEvent extends StreamEvent {
  constructor(
    readonly delta: string,
    readonly messageId: string,
    id?: string,
    timestamp?: number,
  ) {
    super(id, timestamp);
  }

  type(): StreamEventType {
    return StreamEventType.TextDelta;
  }

  toObject(): JsonObject {
    return { ...this.base(), delta: this.delta, message_id: this.messageId };
  }
}

export class TextCompleteEvent extends StreamEvent {
  constructor(
    readonly text: string,
    readonly messageId: string,
    id?: string,
    timestamp?: number,
  ) {
    super(id, timestamp);
  }

  type(): StreamEventType {
    return StreamEventType.TextComplete;
  }

  toObject(): JsonObject {
    return { ...this.base(), text: this.text, message_id: this.messageId };
  }
}

export class ToolCallEvent extends StreamEvent {
  constructor(
    readonly toolCall: ToolCall,
    readonly messageId: string,
    id?: string,
    timestamp?: number,
  ) {
    super(id, timestamp);
  }

  type(): StreamEventType {
    return StreamEventType.ToolCall;
  }

  toObject(): JsonObject {
    return { ...this.base(), tool_call: this.toolCall.toObject(), message_id: this.messageId };
  }
}

/**
 * The provider reported a failure MID-STREAM.
 *
 * Emitted rather than thrown, and the distinction is the reason this type
 * exists: by the time it arrives the consumer has already rendered text, and
 * throwing would discard a partial answer the user watched appear. The stream
 * ends after it; the caller decides what the partial answer was worth.
 */
export class ErrorEvent extends StreamEvent {
  constructor(
    readonly code: string,
    readonly message: string,
    id?: string,
    timestamp?: number,
  ) {
    super(id, timestamp);
  }

  type(): StreamEventType {
    return StreamEventType.Error;
  }

  toObject(): JsonObject {
    return { ...this.base(), code: this.code, message: this.message };
  }
}

export class StreamEndEvent extends StreamEvent {
  constructor(
    readonly finishReason: FinishReason,
    readonly usage: Usage | null = null,
    id?: string,
    timestamp?: number,
  ) {
    super(id, timestamp);
  }

  type(): StreamEventType {
    return StreamEventType.StreamEnd;
  }

  toObject(): JsonObject {
    return {
      ...this.base(),
      finish_reason: this.finishReason,
      usage: this.usage === null ? null : this.usage.toObject(),
    };
  }
}
