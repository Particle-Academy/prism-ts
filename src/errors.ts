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
  | 'canonical_json_unencodable';

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
