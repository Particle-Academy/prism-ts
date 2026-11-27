import { describe, expect, it } from 'vitest';
import {
  AssistantMessage,
  Prism,
  ToolCall,
  ToolResult,
  ToolResultMessage,
  UserMessage,
} from '../src/index.js';
import type { HttpRequest, HttpTransport, JsonObject, Message } from '../src/index.js';

// G-416 property: in every request a provider mapper builds, each tool result
// pairs with exactly one tool call ahead of it in the same turn, and every
// tool call gets exactly one result: Anthropic tool_use / tool_result, OpenAI
// Responses function_call / function_call_output, Mistral tool_calls / tool
// messages. prism-ts ships these three providers (there is no Gemini mapper).
//
// The conversations are generated in the test, from a seeded generator
// (mulberry32): several steps, each a user turn, an assistant turn with tool
// calls (ids from a small pool, so repeated and empty ids occur), with or
// without stored provider content (Anthropic content_blocks of text, thinking,
// fallback and some of the turn's own tool_use blocks; OpenAI output_items of
// reasoning, message and some of the turn's own function_call items), then
// one result per call. Each conversation is sent through Prism.text()
// .withMessages() to every provider with a recording transport, no network.
//
// Normal CI runs a fixed seed set. PRISM_PROPERTY_EXAMPLES sets how many
// conversations, PRISM_PROPERTY_BASE_SEED where they start.

const DEFAULT_EXAMPLES = 300;
const FIXED_BASE_SEED = 0x416;

function setting(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be a whole number, got '${raw}'`);
  return Number(raw);
}

class Rng {
  #state: number;
  constructor(seed: number) { this.#state = seed >>> 0; }
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(items: readonly T[]): T { return items[Math.floor(this.next() * items.length)]!; }
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(this.next() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
    return out;
  }
}

const ID_POOL = ['a', 'b', '', 'toolu_1'];

interface Shape { steps: number; repeated: boolean; empty: boolean; blocks: boolean; items: boolean; fallback: boolean; thinking: boolean; partial: boolean }

/** One conversation, and what it is made of (for the coverage check). */
function generate(seed: number): { messages: Message[]; shape: Shape } {
  const rng = new Rng(seed);
  const messages: Message[] = [];
  const shape: Shape = { steps: 0, repeated: false, empty: false, blocks: false, items: false, fallback: false, thinking: false, partial: false };
  const steps = rng.int(1, 3);
  shape.steps = steps;
  for (let step = 0; step < steps; step += 1) {
    messages.push(new UserMessage(`Question ${step}.`));
    const count = rng.int(1, 3);
    const ids = Array.from({ length: count }, () => rng.pick(ID_POOL));
    if (new Set(ids).size < ids.length) shape.repeated = true;
    if (ids.includes('')) shape.empty = true;
    const calls = ids.map((id, at) => new ToolCall(id, 'lookup', { q: `${step}-${at}` }, `call_${id}`));
    const text = rng.chance(0.6) ? `Looking ${step}.` : '';
    const additional: JsonObject = {};
    if (rng.chance(0.6)) {
      // Anthropic blocks: text, thinking, a fallback block and some of the
      // turn's own tool_use blocks, in a random order.
      const own = calls.filter(() => rng.chance(0.5)).map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.parsedArguments() }));
      if (own.length < calls.length) shape.partial = true;
      const blocks: JsonObject[] = [...own];
      if (text !== '') blocks.push({ type: 'text', text });
      if (rng.chance(0.4)) { blocks.push({ type: 'thinking', thinking: 'Thinking.', signature: 'sig' }); shape.thinking = true; }
      if (rng.chance(0.3)) { blocks.push({ type: 'fallback' }); shape.fallback = true; }
      additional.content_blocks = rng.shuffle(blocks);
      shape.blocks = true;
    }
    if (rng.chance(0.6)) {
      // OpenAI output items: reasoning, the message, and some of the turn's own calls.
      const own = calls.filter(() => rng.chance(0.5)).map((call) => ({ type: 'function_call', id: `fc_${call.id}`, call_id: call.resultId, name: call.name, arguments: JSON.stringify(call.parsedArguments()) }));
      if (own.length < calls.length) shape.partial = true;
      const items: JsonObject[] = [];
      if (rng.chance(0.5)) items.push({ type: 'reasoning', id: `rs_${step}`, summary: [] });
      if (text !== '') items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
      items.push(...own);
      additional.output_items = items;
      shape.items = true;
    }
    messages.push(new AssistantMessage(text, calls, additional));
    messages.push(new ToolResultMessage(calls.map((call, at) => new ToolResult(call.id, call.name, call.parsedArguments(), `found ${step}-${at}`, call.resultId))));
  }
  messages.push(new UserMessage('Thanks.'));
  return { messages, shape };
}

const BODIES: Record<string, unknown> = {
  anthropic: { id: 'msg_1', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } },
  openai: { id: 'resp_1', model: 'gpt-5', status: 'completed', output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'ok' }] }], usage: { input_tokens: 1, output_tokens: 1 } },
  mistral: { id: 'cmpl-1', object: 'chat.completion', model: 'mistral-large-latest', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
};
const MODELS: Record<string, string> = { anthropic: 'claude-sonnet-5-5', openai: 'gpt-5', mistral: 'mistral-large-latest' };

async function sent(provider: string, messages: Message[]): Promise<JsonObject> {
  const calls: HttpRequest[] = [];
  const transport: HttpTransport = (request) => {
    calls.push(request);
    return Promise.resolve({ status: 200, headers: {}, body: BODIES[provider] as JsonObject, rawBody: JSON.stringify(BODIES[provider]) });
  };
  await Prism.text().using(provider, MODELS[provider]!, { apiKey: 'sk-test', transport }).withMessages(messages).asText();
  return JSON.parse(String(calls[0]?.body ?? '{}')) as JsonObject;
}

/**
 * The turns of a mapped request as (calls, results) pairs of id lists, one per
 * assistant turn that holds calls or is followed by results, read the way each
 * provider pairs them.
 */
function turns(provider: string, body: JsonObject): { calls: string[]; results: string[] }[] {
  const out: { calls: string[]; results: string[] }[] = [];
  if (provider === 'anthropic') {
    const messages = body.messages as JsonObject[];
    const blocks = (m: JsonObject | undefined): JsonObject[] => (Array.isArray(m?.content) ? m.content as JsonObject[] : []);
    messages.forEach((message, at) => {
      const results = blocks(message).filter((b) => b.type === 'tool_result').map((b) => String(b.tool_use_id));
      const previous = messages[at - 1];
      const calls = message.role === 'assistant' ? blocks(message).filter((b) => b.type === 'tool_use').map((b) => String(b.id)) : [];
      if (calls.length > 0) out.push({ calls, results: blocks(messages[at + 1]).filter((b) => b.type === 'tool_result').map((b) => String(b.tool_use_id)) });
      // A result whose previous message is not an assistant turn with calls is its own turn, with no calls.
      if (results.length > 0 && !(previous?.role === 'assistant' && blocks(previous).some((b) => b.type === 'tool_use'))) out.push({ calls: [], results });
    });
  } else if (provider === 'openai') {
    // Flat input items: a turn runs from one user message to the next.
    let current: { calls: string[]; results: string[] } | null = null;
    for (const item of body.input as JsonObject[]) {
      if (item.role === 'user') { if (current !== null) out.push(current); current = { calls: [], results: [] }; continue; }
      current ??= { calls: [], results: [] };
      if (item.type === 'function_call') current.calls.push(String(item.call_id));
      if (item.type === 'function_call_output') current.results.push(String(item.call_id));
    }
    if (current !== null) out.push(current);
  } else {
    let current: { calls: string[]; results: string[] } | null = null;
    for (const message of body.messages as JsonObject[]) {
      if (message.role === 'assistant') {
        if (current !== null) out.push(current);
        current = { calls: Array.isArray(message.tool_calls) ? (message.tool_calls as JsonObject[]).map((c) => String(c.id)) : [], results: [] };
      } else if (message.role === 'tool') {
        current ??= { calls: [], results: [] };
        current.results.push(String(message.tool_call_id));
      } else if (current !== null) { out.push(current); current = null; }
    }
    if (current !== null) out.push(current);
  }
  return out.filter((turn) => turn.calls.length > 0 || turn.results.length > 0);
}

/** Each result pairs with exactly one call (by occurrence) and every call gets one: the same multiset. */
function unpaired(provider: string, body: JsonObject): string[] {
  return turns(provider, body).flatMap((turn, at) => {
    const sort = (ids: string[]) => [...ids].sort().map((id) => JSON.stringify(id)).join(',');
    return sort(turn.calls) === sort(turn.results) ? [] : [`turn ${at}: calls [${sort(turn.calls)}] results [${sort(turn.results)}]`];
  });
}

describe('G-416 property: every mapped tool result pairs with exactly one tool call', () => {
  const examples = setting('PRISM_PROPERTY_EXAMPLES', DEFAULT_EXAMPLES);
  const base = setting('PRISM_PROPERTY_BASE_SEED', FIXED_BASE_SEED);

  it(`holds for ${examples} generated conversations from base seed ${base}, on anthropic, openai and mistral`, async () => {
    const seen: Shape[] = [];
    for (let i = 0; i < examples; i += 1) {
      const seed = (base + i) >>> 0;
      const { messages, shape } = generate(seed);
      seen.push(shape);
      for (const provider of ['anthropic', 'openai', 'mistral']) {
        const problems = unpaired(provider, await sent(provider, messages));
        if (problems.length > 0) throw new Error(`${provider}, seed ${seed} (replay: PRISM_PROPERTY_BASE_SEED=${seed} PRISM_PROPERTY_EXAMPLES=1): ${problems.join('; ')}`);
      }
    }
    // The generator reaches every shape it is meant to.
    if (examples >= DEFAULT_EXAMPLES) {
      for (const key of ['repeated', 'empty', 'blocks', 'items', 'fallback', 'thinking', 'partial'] as const) expect(seen.some((shape) => shape[key]), key).toBe(true);
      expect(seen.some((shape) => shape.steps > 1), 'several steps').toBe(true);
      expect(seen.some((shape) => !shape.blocks && !shape.items), 'no stored provider content').toBe(true);
    }
  }, 120_000);
});
