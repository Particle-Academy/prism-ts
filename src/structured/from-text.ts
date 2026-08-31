import type { TextResponse } from '../text/response.js';
import { extractStructured } from './extract.js';
import { StructuredResponse } from './response.js';

/**
 * Turn a parsed text response into a structured one.
 *
 * Every provider that answers a structured request answers it as TEXT — OpenAI
 * with a schema-constrained string, Anthropic with a message it was asked to
 * keep to JSON. So the parsing, the finish-reason handling, the usage and the
 * metadata are the text path's, and this adds the one thing that differs.
 *
 * Sharing it this way is what keeps a structured call from quietly diverging:
 * when the text parser learns that a provider reports token limits differently,
 * structured learns it in the same commit.
 */
export function structuredFromTextResponse(response: TextResponse): StructuredResponse {
  return new StructuredResponse({
    steps: response.steps,
    text: response.text,
    structured: extractStructured(response.text),
    finishReason: response.finishReason,
    usage: response.usage,
    meta: response.meta,
    additionalContent: response.additionalContent,
    raw: response.raw,
  });
}
