import type { JsonObject } from '../json.js';
import { PrismError } from '../errors.js';
import type { ToolChoice } from '../enums.js';
import { Tool } from '../tool.js';
import type { Provider } from '../providers/provider.js';
import { resolveProvider } from '../providers/registry.js';
import { SystemMessage } from '../value-objects/messages/index.js';
import type { Message } from '../value-objects/messages/index.js';
import { UserMessage } from '../value-objects/messages/index.js';
import type { Text } from '../value-objects/media/text.js';
import type { ProviderTool } from '../value-objects/provider-tool.js';
import { TextRequest, type TextRequestOptions } from './request.js';
import type { TextResponse } from './response.js';
import type { StreamEvent } from '../streaming/events.js';

export type TextResponseCallback = (
  pending: TextPendingRequest,
  response: TextResponse,
) => void | Promise<void>;

/**
 * The fluent builder.
 *
 * Method names match the reference's spelling exactly, so a call script written
 * against one reads the same against the other.
 */
export class TextPendingRequest {
  #provider: Provider | null = null;

  #providerKey = '';

  #model = '';

  #prompt: string | null = null;

  #additionalContent: readonly Text[] = [];

  #systemPrompts: SystemMessage[] = [];

  #messages: readonly Message[] = [];

  #maxSteps = 1;

  #maxTokens: number | null = null;

  #temperature: number | null = null;

  #topP: number | null = null;

  #topK: number | null = null;

  #tools: readonly Tool[] = [];

  #toolChoice: string | ToolChoice | null = null;

  #providerOptions: JsonObject = {};

  #providerTools: readonly ProviderTool[] = [];

  #reasoningEnabled: boolean | null = null;

  #clientOptions: Record<string, unknown> = {};

  using(provider: string, model = '', providerConfig: Record<string, unknown> = {}): this {
    this.#providerKey = provider;
    this.#model = model;
    this.#provider = resolveProvider(provider, providerConfig);

    return this;
  }

  withPrompt(prompt: string, additionalContent: readonly Text[] = []): this {
    this.#prompt = prompt;
    this.#additionalContent = additionalContent;

    return this;
  }

  /** APPENDS. Two calls give two system messages, in call order. */
  withSystemPrompt(message: string | SystemMessage): this {
    this.#systemPrompts.push(typeof message === 'string' ? new SystemMessage(message) : message);

    return this;
  }

  /** REPLACES, unlike `withSystemPrompt`. */
  withSystemPrompts(messages: readonly SystemMessage[]): this {
    this.#systemPrompts = [...messages];

    return this;
  }

  withMessages(messages: readonly Message[]): this {
    this.#messages = messages;

    return this;
  }

  withMaxTokens(maxTokens: number | null): this {
    this.#maxTokens = maxTokens;

    return this;
  }

  usingTemperature(temperature: number | null): this {
    this.#temperature = temperature;

    return this;
  }

  usingTopP(topP: number): this {
    this.#topP = topP;

    return this;
  }

  usingTopK(topK: number): this {
    this.#topK = topK;

    return this;
  }

  withTools(tools: readonly Tool[]): this {
    this.#tools = tools;

    return this;
  }

  withToolChoice(toolChoice: string | ToolChoice | Tool): this {
    this.#toolChoice = toolChoice instanceof Tool ? toolChoice.name() : toolChoice;

    return this;
  }

  withProviderOptions(options: Readonly<JsonObject> = {}): this {
    this.#providerOptions = { ...options };

    return this;
  }

  withProviderTools(providerTools: readonly ProviderTool[]): this {
    this.#providerTools = providerTools;

    return this;
  }

  withReasoning(enabled = true): this {
    this.#reasoningEnabled = enabled;

    return this;
  }

  withClientOptions(options: Record<string, unknown>): this {
    this.#clientOptions = { ...options };

    return this;
  }

  withMaxSteps(steps: number): this {
    this.#maxSteps = steps;

    return this;
  }

  providerKey(): string {
    return this.#providerKey;
  }

  model(): string {
    return this.#model;
  }

  provider(): Provider {
    if (this.#provider === null) {
      throw PrismError.unsupportedProviderAction('Sending a request', 'a pending request with no provider — call using() first');
    }

    return this.#provider;
  }

  /**
   * Resolve the builder into a request, without sending it.
   *
   * @throws PrismError code `prompt_and_messages` when both were set — they are
   *   two ways of saying the same thing and the reference cannot merge them.
   */
  toRequest(): TextRequest {
    return new TextRequest(this.requestOptions());
  }

  /**
   * Every field this builder has collected, as request options.
   *
   * Extracted so a SUBCLASS can build a different request from the same
   * twenty fields — see `StructuredPendingRequest`. The fields are `#private`,
   * so a subclass cannot read them directly and the alternative is a second
   * copy of this list that nobody diffs: add a field to one and forget the
   * other, and the request builds fine while silently dropping it.
   */
  protected requestOptions(): TextRequestOptions {
    if (this.#messages.length > 0 && this.#prompt !== null) {
      throw PrismError.promptAndMessages();
    }

    const messages = [...this.#messages];

    // DELIBERATE DIVERGENCE FROM THE REFERENCE. The reference gates this on
    // truthiness, so a prompt of "" or "0" is dropped and the request carries no
    // user message at all — the caller's turn never reaches the model. That is a
    // defect (prism-parity finding F-2); an empty prompt is a prompt. The gate
    // here is on ABSENCE, so only a prompt that was never set is skipped.
    if (this.#prompt !== null) {
      messages.push(new UserMessage(this.#prompt, this.#additionalContent));
    }

    return {
      model: this.#model,
      providerKey: this.#providerKey,
      systemPrompts: [...this.#systemPrompts],
      prompt: this.#prompt,
      messages,
      maxSteps: this.#maxSteps,
      maxTokens: this.#maxTokens,
      temperature: this.#temperature,
      topP: this.#topP,
      topK: this.#topK,
      tools: this.#tools,
      clientOptions: this.#clientOptions,
      toolChoice: this.#toolChoice,
      providerOptions: this.#providerOptions,
      providerTools: this.#providerTools,
      reasoningEnabled: this.#reasoningEnabled,
    };
  }

  /**
   * The same generation, delivered as it arrives.
   *
   * Yields the provider's events and accumulates NOTHING. A caller that wants
   * the finished text collects the deltas it is already being handed; a builder
   * that quietly buffered them would double the memory of every stream to serve
   * the callers who do not need it.
   */
  asStream(): AsyncGenerator<StreamEvent> {
    return this.provider().stream(this.toRequest());
  }

  async asText(callback?: TextResponseCallback): Promise<TextResponse> {
    const response = await this.provider().text(this.toRequest());

    if (callback !== undefined) {
      await callback(this, response);
    }

    return response;
  }
}
