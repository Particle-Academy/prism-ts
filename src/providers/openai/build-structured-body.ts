import type { JsonObject } from '../../json.js';
import { isJsonObject } from '../../json.js';
import { StructuredMode } from '../../enums.js';
import type { StructuredRequest } from '../../structured/request.js';
import { buildRequestBody } from './build-request-body.js';
import { resolveStructuredMode } from './structured-mode-resolver.js';

/**
 * The text body, plus the instruction that makes it structured.
 *
 * Built ON TOP of `buildRequestBody` rather than beside it, so every rule that
 * decides the text body — the unconditional keys, the not-null filter, the
 * empty-tools collapse — applies identically here. A second builder would drift
 * from the first the moment either changed.
 *
 * `Auto` is resolved to a concrete mode against the MODEL, because "auto" is not
 * something OpenAI accepts; somebody has to decide, and doing it here means the
 * decision is inspectable in one place rather than implied by the wire format.
 */
export function buildStructuredBody(request: StructuredRequest): JsonObject {
  const body = buildRequestBody(request);
  const mode = request.mode() === StructuredMode.Auto ? resolveStructuredMode(request.model()) : request.mode();

  // `text` may already hold a verbosity from the text builder. Merged rather
  // than overwritten: asking for a schema is not a reason to silently drop the
  // caller's verbosity setting.
  const existing = isJsonObject(body.text) ? body.text : {};

  return {
    ...body,
    text: { ...existing, format: format(request, mode) },
  };
}

function format(request: StructuredRequest, mode: StructuredMode): JsonObject {
  if (mode === StructuredMode.Json) {
    // JSON mode guarantees syntactic validity and nothing about the shape. The
    // schema still reaches the model through the prompt the caller wrote; it
    // cannot be enforced here, and pretending otherwise would be the dangerous
    // half of this feature.
    return { type: 'json_object' };
  }

  const schema = request.schema();

  return {
    type: 'json_schema',
    name: schema.name,
    schema: schema.toObject(),
    // The whole reason to prefer this mode. Without it the model may return a
    // near-miss that parses and is missing a required field.
    strict: true,
  };
}
