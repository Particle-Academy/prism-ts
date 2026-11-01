import type { TextResponse } from '../text/response.js';
import { extractStructured } from './extract.js';
import { StructuredResponse } from './response.js';
import { StructuredStep } from './step.js';
import { AssistantMessage } from '../value-objects/messages/index.js';

/**
 * Turn a parsed text response into a structured one.
 *
 * Reuse provider parsing, then preserve structured step serialization and the
 * assistant turn. Native output-format providers expose JSON through the
 * structured value and retain the original JSON in the assistant conversation.
 */
export function structuredFromTextResponse(
  response: TextResponse,
  options: { nativeOutputFormat?: boolean; parsedStep?: boolean; assistantAdditionalContent?: boolean } = {},
): StructuredResponse {
  const native = options.nativeOutputFormat === true;
  const steps = response.steps.map((step) => new StructuredStep({
    ...step,
    text: native ? '' : step.text,
    structured: native || options.parsedStep === true ? extractStructured(step.text) ?? {} : {},
    messages: [...step.messages, new AssistantMessage(step.text, step.toolCalls,
      options.assistantAdditionalContent === false ? {} : step.additionalContent, step.toolApprovalRequests)],
  }));
  return new StructuredResponse({
    steps,
    text: native ? '' : response.text,
    structured: extractStructured(response.text),
    finishReason: response.finishReason,
    usage: response.usage,
    meta: response.meta,
    additionalContent: response.additionalContent,
    raw: response.raw,
    toolCalls: steps.flatMap((step) => step.toolCalls),
    providerToolCalls: steps.flatMap((step) => step.providerToolCalls),
    toolResults: steps.flatMap((step) => step.toolResults),
  });
}
