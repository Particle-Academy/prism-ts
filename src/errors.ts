/**
 * Failures carry a stable CODE.
 *
 * The PHP reference identifies every failure by an English sentence and nothing
 * else, so any consumer that needs to branch on a failure ends up matching on
 * prose and every wording improvement becomes a silent breaking change. Here the
 * code is the contract and the message is not: treat `PrismError.code` as
 * stable and `PrismError.message` as free to change in any release.
 */

export type PrismErrorCode =
  /** `prompt` and `messages` were both set on the same pending request. */
  | 'prompt_and_messages'
  /** The provider stopped because it ran out of output tokens. */
  | 'max_tokens_exceeded'
  /** The provider returned a payload that is missing, empty or carries an error. */
  | 'provider_response_error'
  /** The provider does not implement the capability that was asked for. */
  | 'unsupported_provider_action'
  /** A tool call's `arguments` string is not valid JSON. */
  | 'malformed_tool_call_arguments'
  /** A value in the message list is not a message this port knows how to map. */
  | 'unknown_message_type'
  /** The response finished on tool calls; the tool-execution loop is not ported. */
  | 'tool_loop_not_supported'
  /** A value handed to the canonical encoder cannot survive a JSON round trip. */
  | 'canonical_json_unencodable'
  /** A structured request reached `toRequest()` with no schema set. */
  | 'missing_schema'
  /** The model cannot produce structured output at all, by name. */
  | 'unsupported_structured_model'
  /** An embeddings request reached `toRequest()` with no input. */
  | 'no_embedding_input'
  /** `fromFile()` could not read the path it was given. */
  | 'unreadable_input_file'
  /** An images request reached `toRequest()` with no prompt. */
  | 'no_image_prompt'
  /** A moderation request reached `toRequest()` with no input. */
  | 'no_moderation_input'
  /** A media file could not be read from disk. */
  | 'unreadable_media_file'
  /** A media payload could not be fetched from its url. */
  | 'unfetchable_media';

export interface PrismErrorOptions {
  cause?: unknown;
  httpStatus?: number | null;
  responseBody?: string | null;
}

export class PrismError extends Error {
  readonly code: PrismErrorCode;

  readonly httpStatus: number | null;

  readonly responseBody: string | null;

  constructor(code: PrismErrorCode, message: string, options: PrismErrorOptions = {}) {
    super(message, 'cause' in options ? { cause: options.cause } : undefined);

    this.name = 'PrismError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.responseBody = options.responseBody ?? null;
  }

  static promptAndMessages(): PrismError {
    return new PrismError('prompt_and_messages', 'You can only use `prompt` or `messages`.');
  }

  /**
   * A structured request with no schema.
   *
   * Refused rather than defaulted. "Any object" would produce a response that
   * parses and means nothing, and the caller would discover that at the point
   * they read a field that was never asked for.
   */
  static missingSchema(): PrismError {
    return new PrismError(
      'missing_schema',
      'A structured request needs a schema. Call withSchema() before asStructured().',
    );
  }

  static unsupportedStructuredModel(model: string): PrismError {
    return new PrismError('unsupported_structured_model', `Structured output is not supported for ${model}`);
  }

  /**
   * An embeddings request with no input.
   *
   * Refused rather than sent. The call is billable, comes back with an empty
   * list, and reads to the caller as a provider that answered nothing.
   */
  static noEmbeddingInput(): PrismError {
    return new PrismError(
      'no_embedding_input',
      'An embeddings request needs at least one input. Call fromInput(), fromArray() or fromFile().',
    );
  }

  /**
   * A moderation request with no input.
   *
   * Refused rather than sent, and this matters more than the other empty-input
   * guards: an empty moderation call returns no results, `isFlagged()` is then
   * false, and a caller gating on it lets everything through. A safety check
   * that fails OPEN because it was called wrong is the worst shape here.
   */
  static unreadableMediaFile(path: string, cause?: unknown): PrismError {
    return new PrismError('unreadable_media_file', `Could not read the media file [${path}].`, { cause });
  }

  static unfetchableMedia(reason: string): PrismError {
    return new PrismError('unfetchable_media', `Could not fetch the media payload: ${reason}.`);
  }

  static noModerationInput(): PrismError {
    return new PrismError(
      'no_moderation_input',
      'A moderation request needs at least one input. Call withInput().',
    );
  }

  static noImagePrompt(): PrismError {
    return new PrismError('no_image_prompt', 'An images request needs a prompt. Call withPrompt().');
  }

  static unreadableInputFile(path: string, cause?: unknown): PrismError {
    return new PrismError('unreadable_input_file', `Could not read the embeddings input file [${path}].`, { cause });
  }

  static maxTokensExceeded(status: string, type: string): PrismError {
    return new PrismError(
      'max_tokens_exceeded',
      `The provider stopped before finishing because it ran out of output tokens (status: ${status || 'n/a'}, type: ${type || 'n/a'}). If you are using a reasoning model, raise max tokens to cover its internal reasoning tokens.`,
    );
  }

  static providerResponseError(
    message: string,
    options: { httpStatus?: number | null; responseBody?: string | null; cause?: unknown } = {},
  ): PrismError {
    return new PrismError('provider_response_error', message, options);
  }

  static unsupportedProviderAction(action: string, provider: string): PrismError {
    return new PrismError('unsupported_provider_action', `${action} is not supported by ${provider}.`);
  }

  static malformedToolCallArguments(toolName: string, cause?: unknown): PrismError {
    return new PrismError(
      'malformed_tool_call_arguments',
      `Tool call arguments for tool ${toolName} are not valid JSON.`,
      { cause },
    );
  }

  static unknownMessageType(description: string): PrismError {
    return new PrismError('unknown_message_type', `Could not map message type ${description}.`);
  }

  static toolLoopNotSupported(): PrismError {
    return new PrismError(
      'tool_loop_not_supported',
      'The response finished on tool calls. This port maps requests and parses text responses; it does not run the tool-execution loop.',
    );
  }

  static canonicalJsonUnencodable(path: string, value: unknown): PrismError {
    return new PrismError(
      'canonical_json_unencodable',
      `Cannot canonically encode ${typeof value} at ${path}: JSON.stringify would drop or rewrite it. Use an explicit null if the key should carry null, or omit the key entirely.`,
    );
  }
}
