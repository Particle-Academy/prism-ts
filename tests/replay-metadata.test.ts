import { expect, it } from 'vitest';
import { AssistantMessage, buildAnthropicRequestBody, buildRequestBody, parseAnthropicTextResponse, parseTextResponse, Prism } from '../src/index.js';
import type { JsonObject } from '../src/index.js';

it.each(['openai', 'anthropic'])('replays %s opaque provider state after storing the actual parsed assistant message', (provider) => {
  const request = Prism.text().using(provider, 'owned-fixture').withPrompt('fixture').toRequest();
  const opaque = 'synthetic-owned-opaque-λ+/=';
  const blocks = provider === 'openai'
    ? [{ type: 'reasoning', id: 'rs_owned', summary: [], encrypted_content: opaque },
      { type: 'message', id: 'msg_owned', role: 'assistant', content: [{ type: 'output_text', text: 'fixture' }] }]
    : [{ type: 'thinking', thinking: 'fixture', signature: opaque },
      { type: 'text', text: 'fixture' }, { type: 'redacted_thinking', data: opaque }];
  const raw: JsonObject = provider === 'openai'
    ? { id: 'resp_owned', model: 'owned-fixture', status: 'completed', output: blocks, usage: { input_tokens: 1, output_tokens: 1 } }
    : { id: 'msg_owned', model: 'owned-fixture', stop_reason: 'end_turn', content: blocks, usage: { input_tokens: 1, output_tokens: 1 } };
  const response = provider === 'openai' ? parseTextResponse(request, raw) : parseAnthropicTextResponse(request, raw);
  const assistant = response.messages.find((message) => message.type === 'assistant');
  if (!(assistant instanceof AssistantMessage)) throw new Error('No parsed assistant message');
  const stored = AssistantMessage.fromObject(JSON.parse(JSON.stringify(assistant.toObject())) as JsonObject);
  const next = Prism.text().using(provider, 'owned-fixture').withMessages([stored]).toRequest();
  const body = provider === 'openai' ? buildRequestBody(next) : buildAnthropicRequestBody(next);
  const replay = provider === 'openai' ? body.input : (body.messages as JsonObject[])[0]?.content;
  // Assert on booleans so opaque values never appear in failure diagnostics.
  expect(JSON.stringify(replay) === JSON.stringify(blocks)).toBe(true);
});
