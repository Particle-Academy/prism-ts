import type { JsonObject, JsonValue } from '../json.js';
import { getByPath } from '../json.js';
import { ToolChoice } from '../enums.js';
import type { Tool } from '../tool.js';
import type { Message } from '../value-objects/messages/index.js';
import type { SystemMessage } from '../value-objects/messages/index.js';
import type { ProviderTool } from '../value-objects/provider-tool.js';

export interface TextRequestOptions {
  model: string;
  providerKey?: string | null;
  systemPrompts?: readonly SystemMessage[];
  prompt?: string | null;
  messages?: readonly Message[];
  maxSteps?: number;
  maxTokens?: number | null;
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  tools?: readonly Tool[];
  clientOptions?: Readonly<Record<string, unknown>>;
  toolChoice?: string | ToolChoice | null;
  providerOptions?: Readonly<JsonObject>;
  providerTools?: readonly ProviderTool[];
  reasoningEnabled?: boolean | null;
}

/**
 * A resolved text request: everything the provider needs, and nothing that only
 * the builder needed.
 *
 * Accessors are methods rather than properties so the shape mirrors the
 * reference exactly, and so `messages()` can stay a method while `addMessage()`
 * mutates the list beneath it.
 */
export class TextRequest {
  readonly #model: string;

  readonly #providerKey: string | null;

  readonly #systemPrompts: readonly SystemMessage[];

  readonly #prompt: string | null;

  #messages: readonly Message[];

  readonly #maxSteps: number;

  readonly #maxTokens: number | null;

  readonly #temperature: number | null;

  readonly #topP: number | null;

  readonly #topK: number | null;

  readonly #tools: readonly Tool[];

  readonly #clientOptions: Readonly<Record<string, unknown>>;

  #toolChoice: string | ToolChoice | null;

  #providerOptions: JsonObject;

  readonly #providerTools: readonly ProviderTool[];

  readonly #reasoningEnabled: boolean | null;

  constructor(options: TextRequestOptions) {
    this.#model = options.model;
    this.#providerKey = options.providerKey ?? null;
    this.#systemPrompts = options.systemPrompts ?? [];
    this.#prompt = options.prompt ?? null;
    this.#messages = options.messages ?? [];
    this.#maxSteps = options.maxSteps ?? 1;
    this.#maxTokens = options.maxTokens ?? null;
    this.#temperature = options.temperature ?? null;
    this.#topP = options.topP ?? null;
    this.#topK = options.topK ?? null;
    this.#tools = options.tools ?? [];
    this.#clientOptions = options.clientOptions ?? {};
    this.#toolChoice = options.toolChoice ?? null;
    this.#providerOptions = { ...(options.providerOptions ?? {}) };
    this.#providerTools = options.providerTools ?? [];
    this.#reasoningEnabled = options.reasoningEnabled ?? null;
  }

  model(): string {
    return this.#model;
  }

  provider(): string | null {
    return this.#providerKey;
  }

  systemPrompts(): readonly SystemMessage[] {
    return this.#systemPrompts;
  }

  prompt(): string | null {
    return this.#prompt;
  }

  messages(): readonly Message[] {
    return this.#messages;
  }

  maxSteps(): number {
    return this.#maxSteps;
  }

  maxTokens(): number | null {
    return this.#maxTokens;
  }

  temperature(): number | null {
    return this.#temperature;
  }

  topP(): number | null {
    return this.#topP;
  }

  topK(): number | null {
    return this.#topK;
  }

  tools(): readonly Tool[] {
    return this.#tools;
  }

  clientOptions(): Readonly<Record<string, unknown>> {
    return this.#clientOptions;
  }

  toolChoice(): string | ToolChoice | null {
    return this.#toolChoice;
  }

  providerTools(): readonly ProviderTool[] {
    return this.#providerTools;
  }

  reasoningEnabled(): boolean | null {
    return this.#reasoningEnabled;
  }

  providerOptions(): JsonObject;
  providerOptions(path: string): JsonValue | undefined;
  providerOptions(path?: string): JsonObject | JsonValue | undefined {
    return path === undefined ? this.#providerOptions : getByPath(this.#providerOptions, path);
  }

  withProviderOptions(options: Readonly<JsonObject> = {}): this {
    this.#providerOptions = { ...options };

    return this;
  }

  addMessage(message: Message): this {
    this.#messages = [...this.#messages, message];

    return this;
  }

  setMessages(messages: readonly Message[]): this {
    this.#messages = messages;

    return this;
  }

  /**
   * After a tool has been called once, a forced choice must relax to `Auto` or
   * the model would be pinned to that tool for every remaining step.
   */
  resetToolChoice(): this {
    if (typeof this.#toolChoice === 'string' || this.#toolChoice === ToolChoice.Any) {
      this.#toolChoice = ToolChoice.Auto;
    }

    return this;
  }
}
