export { Prism } from './prism.js';

export { PrismError } from './errors.js';
export type { PrismErrorCode, PrismErrorOptions } from './errors.js';

export { FinishReason, StructuredMode, ToolChoice, finishReasonFromValue, toolChoiceFromName } from './enums.js';

export { Tool } from './tool.js';
export type { ToolHandler } from './tool.js';
export { BooleanSchema, NumberSchema, StringSchema } from './schema/index.js';
export type { BooleanSchemaOptions, NumberSchemaOptions, Schema, StringSchemaOptions } from './schema/index.js';

export {
  Artifact,
  AssistantMessage,
  Meta,
  ProviderRateLimit,
  ProviderTool,
  SystemMessage,
  Text,
  ToolCall,
  ToolResult,
  ToolResultMessage,
  Usage,
  UserMessage,
  messageFromObject,
} from './value-objects/index.js';
export type { Message, MessageType, ToolCallArguments, ToolResultValue } from './value-objects/index.js';

export { TextPendingRequest } from './text/pending-request.js';
export type { TextResponseCallback } from './text/pending-request.js';
export { TextRequest } from './text/request.js';
export type { TextRequestOptions } from './text/request.js';
export { TextResponse } from './text/response.js';
export type { TextResponseOptions } from './text/response.js';
export { TextStep } from './text/step.js';
export type { TextStepOptions } from './text/step.js';
export { ResponseBuilder } from './text/response-builder.js';

export { Provider } from './providers/provider.js';
export { Anthropic } from './providers/anthropic/anthropic.js';
export type { AnthropicConfig } from './providers/anthropic/anthropic.js';
export { registerProvider, registeredProviders, resolveProvider } from './providers/registry.js';
export type { ProviderFactory } from './providers/registry.js';
export { OpenAI } from './providers/openai/openai.js';
export type { OpenAIConfig } from './providers/openai/openai.js';

// The seams a conformance runner needs: build a body without sending it, and
// parse a stored payload without a network.
export { buildRequestBody, buildTools } from './providers/openai/build-request-body.js';
export { parseTextResponse } from './providers/openai/parse-response.js';
export type { ParseTextResponseOptions } from './providers/openai/parse-response.js';
export { mapMessages } from './providers/openai/maps/message-map.js';
export { mapTools } from './providers/openai/maps/tool-map.js';
export { mapToolChoice } from './providers/openai/maps/tool-choice-map.js';
export { lastOutputItem, mapFinishReason, mapFinishReasonFromOutput } from './providers/openai/maps/finish-reason-map.js';
export { parseRateLimits } from './providers/openai/rate-limits.js';

export { canonicalJson, getByPath, isJsonObject } from './json.js';
export type { JsonObject, JsonPrimitive, JsonValue } from './json.js';

export { fetchTransport } from './http/transport.js';
export type { HttpRequest, HttpResponse, HttpTransport } from './http/transport.js';

export { StructuredPendingRequest } from './structured/pending-request.js';
export type { StructuredResponseCallback } from './structured/pending-request.js';
export { StructuredRequest } from './structured/request.js';
export type { StructuredRequestOptions } from './structured/request.js';
export { StructuredResponse } from './structured/response.js';
export type { StructuredResponseOptions } from './structured/response.js';
export { extractStructured } from './structured/extract.js';
export { fetchStreamTransport } from './http/transport.js';
export type { HttpStreamResponse, HttpStreamTransport } from './http/transport.js';
export { ObjectSchema, ArraySchema, EnumSchema } from './schema/index.js';
export type { ObjectSchemaOptions, ArraySchemaOptions, EnumSchemaOptions } from './schema/index.js';
export { structuredFromTextResponse } from './structured/from-text.js';

export { sseData } from './streaming/sse.js';
export {
  ErrorEvent,
  StreamEndEvent,
  StreamEvent,
  StreamEventType,
  StreamStartEvent,
  TextCompleteEvent,
  TextDeltaEvent,
  TextStartEvent,
  ToolCallEvent,
  eventId,
} from './streaming/events.js';
export { mapStreamEvent } from './providers/openai/stream-events.js';

export { EmbeddingsPendingRequest } from './embeddings/pending-request.js';
export { EmbeddingsRequest } from './embeddings/request.js';
export type { EmbeddingsRequestOptions } from './embeddings/request.js';
export { EmbeddingsResponse } from './embeddings/response.js';
export type { EmbeddingsResponseOptions } from './embeddings/response.js';
export { Embedding } from './value-objects/embedding.js';
export { EmbeddingsUsage } from './value-objects/embeddings-usage.js';
export { buildEmbeddingsBody, parseEmbeddingsResponse } from './providers/openai/embeddings.js';

export { ImagesPendingRequest } from './images/pending-request.js';
export { ImagesRequest } from './images/request.js';
export type { ImagesRequestOptions } from './images/request.js';
export { ImagesResponse } from './images/response.js';
export type { ImagesResponseOptions } from './images/response.js';
export { GeneratedImage } from './value-objects/generated-image.js';
export { buildImagesBody, parseImagesResponse } from './providers/openai/images.js';
