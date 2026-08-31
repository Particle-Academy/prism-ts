import { PrismError } from '../../errors.js';
import { StructuredMode } from '../../enums.js';

/**
 * Which structured method a model can actually honour.
 *
 * CAPABILITY INFERRED FROM THE MODEL NAME, which is a compromise worth naming
 * rather than hiding: OpenAI publishes no endpoint that answers "does this model
 * support strict schemas", so the reference matches prefixes, and so does this.
 * The cost is that a model released tomorrow is treated as JSON-only until this
 * list learns about it — a conservative failure, but a failure.
 *
 * prism-provider-watch treats changes to this list as actionable drift for
 * exactly that reason.
 */
const STRUCTURED_PREFIXES: readonly string[] = ['gpt-4o', 'gpt-4.1', 'gpt-4.5', 'gpt-5', 'chatgpt-4o', 'o3-mini'];

/** Models that cannot do structured output at all, by exact name. */
const UNSUPPORTED: readonly string[] = [
  'o1-mini',
  'o1-mini-2024-09-12',
  'o1-preview',
  'o1-preview-2024-09-12',
];

export function resolveStructuredMode(model: string): StructuredMode {
  const base = resolveBaseModel(model);

  if (UNSUPPORTED.includes(base)) {
    throw PrismError.unsupportedStructuredModel(model);
  }

  return STRUCTURED_PREFIXES.some((prefix) => base.startsWith(prefix)) ? StructuredMode.Structured : StructuredMode.Json;
}

/**
 * A fine-tune is named `ft:<base>:<org>:<name>:<hash>`, and its capability is
 * the BASE model's. Matching prefixes against the whole string would classify
 * every fine-tune as JSON-only, including ones built on gpt-4o.
 */
function resolveBaseModel(model: string): string {
  if (!model.startsWith('ft:')) {
    return model;
  }

  return model.split(':', 3)[1] ?? model;
}
