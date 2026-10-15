import { PrismError } from '../../errors.js';
import { StructuredMode } from '../../enums.js';

/**
 * Which structured method a model can actually honour.
 *
 * CAPABILITY INFERRED FROM THE MODEL NAME, which is a compromise worth naming
 * rather than hiding: OpenAI publishes no endpoint that answers "does this model
 * support strict schemas", so the reference infers it, and so does this.
 *
 * A list alone goes stale in the unsafe direction: the newest models fall back
 * to JSON mode, where the schema is not enforced, and nothing says so. gpt-6.x
 * and o1/o3/o4 did exactly that until prism#83. So families are also recognised
 * by OpenAI's naming, gpt-N for N >= 5 and the oN reasoning series. A name only
 * has to LOOK like a family to be caught, so custom models served through this
 * provider under other names keep the JSON-mode default.
 */
const STRUCTURED_PREFIXES: readonly string[] = ['gpt-4o', 'gpt-4.1', 'gpt-4.5', 'gpt-5', 'chatgpt-4o', 'o3-mini'];
const GPT_FAMILY = /^gpt-(\d+)(?:[.-]|$)/;
const O_SERIES = /^o\d+(?:-|$)/;

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

  return supportsStructured(base) ? StructuredMode.Structured : StructuredMode.Json;
}

function supportsStructured(base: string): boolean {
  if (STRUCTURED_PREFIXES.some((prefix) => base.startsWith(prefix))) {
    return true;
  }

  const family = GPT_FAMILY.exec(base);
  if (family !== null) {
    return Number(family[1]) >= 5;
  }

  // o1-mini and o1-preview never supported it; UNSUPPORTED refused them above.
  return O_SERIES.test(base);
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
