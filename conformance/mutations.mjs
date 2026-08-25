// Discrimination probes: the deliberate defects.
//
// A conformance table that every plausible implementation passes proves
// nothing. Each mutant here is a WRONG implementation, and the corpus declares
// the exact set of case ids it must fail — so the table stops being decoration
// and starts being a measurement of which rows carry which hazard.
//
// This file is TEST SUPPORT and lives outside src/ on purpose. The shipped
// library must not carry a mutation switch: a defect you can turn on in
// production is a defect.
//
// Every mutation is a TRANSFORM over what the real library produced, never a
// re-implementation of it. That matters. A mutant that rebuilds the request
// body itself can drift from the real builder for reasons that have nothing to
// do with the mutation, and then the probe measures the mutant instead of the
// library.

const UNCONDITIONALLY_MERGED = new Set(['model', 'input', 'max_output_tokens']);

/** Keys the reference emits BEFORE `tools`, used to splice `tools` back into place. */
const KEYS_BEFORE_TOOLS = ['metadata', 'top_p', 'temperature', 'max_output_tokens'];

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rebuild an object with one extra key inserted at a chosen position. */
function insertKeyAfter(source, afterKey, key, value) {
  const result = {};

  for (const [existingKey, existingValue] of Object.entries(source)) {
    result[existingKey] = existingValue;

    if (existingKey === afterKey) result[key] = value;
  }

  if (!(key in result)) result[key] = value;

  return result;
}

function dropNullsDeeply(value) {
  if (Array.isArray(value)) return value.map(dropNullsDeeply);

  if (isObject(value)) {
    const result = {};

    for (const [key, item] of Object.entries(value)) {
      if (item !== null) result[key] = dropNullsDeeply(item);
    }

    return result;
  }

  return value;
}

/**
 * The registry. Each entry names the decision point it corrupts, matching the
 * `scope` the corpus declares for that probe.
 *
 *   requestBody   — after the body is built, before it is encoded
 *   parsedResult  — after a raw response is parsed into its stored form
 *   serialized    — when a value object is written for storage
 *   rehydrate     — when a value object is rebuilt from storage
 */
export const MUTATIONS = {
  'omit-null-keys': {
    scope: 'request body',
    requestBody(body) {
      // What JSON.stringify does to undefined, and what a naive dict
      // comprehension does to None. `max_output_tokens` is the casualty.
      const result = {};

      for (const [key, value] of Object.entries(body)) {
        if (value !== null) result[key] = value;
      }

      return result;
    },
  },

  'falsy-filter': {
    scope: 'request body',
    requestBody(body) {
      // Only the OPTIONAL keys are filtered in the reference; the three merged
      // unconditionally never see a filter at all. Filtering those too would be
      // omit-null-keys wearing a different hat.
      const result = {};

      for (const [key, value] of Object.entries(body)) {
        if (UNCONDITIONALLY_MERGED.has(key) || value) result[key] = value;
      }

      return result;
    },
  },

  'keep-empty-tools': {
    scope: 'request body',
    requestBody(body, { lib, request }) {
      if ('tools' in body) return body;

      const tools = lib.buildTools(request);
      const anchor = KEYS_BEFORE_TOOLS.find((key) => key in body);

      // Spliced into the position the reference would have emitted it, so the
      // only difference from a faithful body is the presence of the key.
      return insertKeyAfter(body, anchor, 'tools', tools);
    },
  },

  'tool-choice-any-verbatim': {
    scope: 'request body',
    requestBody(body, { lib, request }) {
      if (request.toolChoice() !== lib.ToolChoice.Any) return body;

      return { ...body, tool_choice: 'any' };
    },
  },

  'tool-arguments-as-object': {
    scope: 'request body',
    requestBody(body) {
      if (!Array.isArray(body.input)) return body;

      // Note this still PARSES the arguments first, so a tool call carrying
      // malformed JSON fails exactly as it does faithfully. The mutation is the
      // double encoding, not the decoding.
      return {
        ...body,
        input: body.input.map((item) =>
          isObject(item) && item.type === 'function_call' && typeof item.arguments === 'string'
            ? { ...item, arguments: JSON.parse(item.arguments) }
            : item,
        ),
      };
    },
  },

  'provider-tools-last': {
    scope: 'request body',
    requestBody(body, { request }) {
      const count = request.providerTools().length;

      if (count === 0 || !Array.isArray(body.tools)) return body;

      return { ...body, tools: [...body.tools.slice(count), ...body.tools.slice(0, count)] };
    },
  },

  'system-prompts-last': {
    scope: 'request body',
    requestBody(body, { lib, request }) {
      if (request.systemPrompts().length === 0) return body;

      return { ...body, input: lib.mapMessages([...request.messages(), ...request.systemPrompts()]) };
    },
  },

  'prompt-tokens-unadjusted': {
    scope: 'response parsing',
    parsedResult(result) {
      // prompt_tokens is input_tokens MINUS cached; adding the cached count back
      // is exactly the unadjusted figure, and it stays self-consistent with the
      // cache_read counter the same payload reports.
      const unadjust = (usage) =>
        isObject(usage) ? { ...usage, prompt_tokens: usage.prompt_tokens + (usage.cache_read_input_tokens ?? 0) } : usage;

      return {
        ...result,
        steps: Array.isArray(result.steps) ? result.steps.map((step) => ({ ...step, usage: unadjust(step.usage) })) : result.steps,
        usage: unadjust(result.usage),
      };
    },
  },

  'omit-null-on-serialize': {
    scope: 'value object serialization',
    serialized(value) {
      return dropNullsDeeply(value);
    },
  },

  'omit-null-on-parse': {
    scope: 'response parsing',
    // The same absent-versus-null axis as omit-null-on-serialize, on the other
    // side of the boundary — and a SEPARATE probe rather than a widening of
    // that one. A probe's declared scope is part of its contract, so broadening
    // the behaviour to match a wider intuition would make the declaration wrong
    // rather than the probe better.
    parsedResult(value) {
      return dropNullsDeeply(value);
    },
  },

  'rehydrate-reappends-text': {
    scope: 'value object rehydration',
    rehydrate({ lib, tag, object }) {
      if (tag !== 'UserMessage') return null;

      // The constructor appends a text part built from its own content
      // argument, so handing the STORED parts straight back appends a second
      // copy and the message text doubles on every save-and-load cycle.
      const parts = Array.isArray(object.additional_content) ? object.additional_content : [];

      return new lib.UserMessage(
        object.content,
        parts.map((part) => lib.Text.fromObject(part)),
        isObject(object.additional_attributes) ? object.additional_attributes : {},
      );
    },
  },
};

export function isKnownProbe(probeId) {
  return probeId === 'faithful' || Object.hasOwn(MUTATIONS, probeId);
}

/**
 * Run one decision point through the active probe.
 *
 * `faithful` is the control and touches nothing — without an implementation
 * that passes everything, the mutants prove only that the port is broken.
 */
export function mutate(probeId, hook, value, context = {}) {
  const mutation = MUTATIONS[probeId];

  if (mutation === undefined || typeof mutation[hook] !== 'function') return value;

  return mutation[hook](value, context);
}

/** The rehydrate hook replaces the default rather than transforming it. */
export function mutateRehydration(probeId, context) {
  const mutation = MUTATIONS[probeId];

  if (mutation === undefined || typeof mutation.rehydrate !== 'function') return null;

  return mutation.rehydrate(context);
}
