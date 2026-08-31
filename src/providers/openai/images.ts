import { isJsonObject, type JsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';
import type { ImagesRequest } from '../../images/request.js';
import { ImagesResponse } from '../../images/response.js';
import { GeneratedImage } from '../../value-objects/generated-image.js';
import { Meta } from '../../value-objects/meta.js';
import { Usage } from '../../value-objects/usage.js';
import { whereNotNull } from '../../internal/filters.js';

export function buildImagesBody(request: ImagesRequest): JsonObject {
  return {
    model: request.model(),
    prompt: request.prompt(),
    ...whereNotNull({
      n: request.providerOptions('n'),
      size: request.providerOptions('size'),
      quality: request.providerOptions('quality'),
      style: request.providerOptions('style'),
      response_format: request.providerOptions('response_format'),
      background: request.providerOptions('background'),
      output_format: request.providerOptions('output_format'),
      user: request.providerOptions('user'),
    }),
  };
}

export function parseImagesResponse(rawBody: unknown, model: string): ImagesResponse {
  if (!isJsonObject(rawBody)) {
    throw PrismError.providerResponseError('OpenAI returned an empty or non-object images response.');
  }

  const data = Array.isArray(rawBody.data) ? rawBody.data.filter(isJsonObject) : [];

  return new ImagesResponse({
    images: data.map(
      (item) =>
        new GeneratedImage(
          readOptional(item.url),
          readOptional(item.b64_json),
          readOptional(item.revised_prompt),
        ),
    ),
    // Two spellings, because the image endpoints disagree with each other:
    // `gpt-image-1` reports input/output tokens and DALL·E reports
    // prompt/completion. Reading only one would report zero cost for the other.
    usage: new Usage(
      readNumber(rawBody, 'usage.input_tokens', 'usage.prompt_tokens'),
      readNumber(rawBody, 'usage.output_tokens', 'usage.completion_tokens'),
    ),
    meta: new Meta(readString(rawBody.id), readString(rawBody.model) || model),
    raw: rawBody,
  });
}

/** Null rather than '' — a missing url and an empty one are different answers. */
function readOptional(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNumber(body: JsonObject, ...paths: readonly string[]): number {
  for (const path of paths) {
    const value = path.split('.').reduce<unknown>((carry, key) => (isJsonObject(carry) ? carry[key] : undefined), body);

    if (typeof value === 'number') {
      return value;
    }
  }

  return 0;
}
