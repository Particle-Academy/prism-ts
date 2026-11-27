import { describe, expect, it } from 'vitest';
import {
  AssistantMessage,
  Prism,
  ToolCall,
  ToolResult,
  ToolResultMessage,
  UserMessage,
} from '../src/index.js';
import type { HttpRequest, HttpTransport, JsonObject } from '../src/index.js';

// G-416: an assistant message that carries `additionalContent.content_blocks`
// is replayed from those blocks, and its tool calls must still reach Anthropic
// as tool_use blocks. This package's own parse-response stores content_blocks
// without tool_use, so a turn rebuilt from the blocks alone left the next
// tool_result with no tool_use before it, which Anthropic refuses. Checked on
// the request body sent through withMessages, with no network.

const OK_BODY = {
  id: 'msg_1',
  model: 'claude-sonnet-5-5',
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

async function sentMessages(assistant: AssistantMessage): Promise<JsonObject[]> {
  const calls: HttpRequest[] = [];
  const transport: HttpTransport = (request) => {
    calls.push(request);
    return Promise.resolve({ status: 200, headers: {}, body: OK_BODY, rawBody: JSON.stringify(OK_BODY) });
  };
  await Prism.text()
    .using('anthropic', 'claude-sonnet-5-5', { apiKey: 'sk-test', transport })
    .withMessages([
      new UserMessage('Look it up.'),
      assistant,
      new ToolResultMessage([new ToolResult('toolu_1', 'lookup', { q: 'x' }, 'found')]),
    ])
    .asText();
  return (JSON.parse(String(calls[0]?.body ?? '{}')) as { messages: JsonObject[] }).messages;
}

/** Every tool_result in a message paired with a tool_use of the same id in the message just before it, and the reverse. */
function pairing(messages: JsonObject[]): string[] {
  const blocks = (message: JsonObject | undefined): JsonObject[] => (Array.isArray(message?.content) ? message.content as JsonObject[] : []);
  const problems: string[] = [];
  messages.forEach((message, at) => {
    for (const result of blocks(message).filter((block) => block.type === 'tool_result')) {
      if (!blocks(messages[at - 1]).some((block) => block.type === 'tool_use' && block.id === result.tool_use_id)) problems.push(`tool_result ${String(result.tool_use_id)} has no tool_use before it`);
    }
    if (message.role !== 'assistant') return;
    for (const use of blocks(message).filter((block) => block.type === 'tool_use')) {
      if (!blocks(messages[at + 1]).some((block) => block.type === 'tool_result' && block.tool_use_id === use.id)) problems.push(`tool_use ${String(use.id)} has no tool_result after it`);
    }
  });
  return problems;
}

const call = new ToolCall('toolu_1', 'lookup', { q: 'x' });
const thinking = { type: 'thinking', thinking: 'Need to look.', signature: 'sig_1' };
const text = { type: 'text', text: 'Looking it up.' };
const toolUse = { type: 'tool_use', id: 'toolu_1', name: 'lookup', input: { q: 'x' } };

describe('G-416: a replayed Anthropic turn still sends its tool calls', () => {
  const cases: [string, JsonObject[]][] = [
    ['[text]', [text]],
    ['[thinking, text]', [thinking, text]],
    ['[text, tool_use]', [text, toolUse]],
    ['[fallback, text]', [{ type: 'fallback' }, text]],
    ['[tool_use, fallback, text] (the tool_use ahead of the fallback block is not replayed)', [toolUse, { type: 'fallback' }, text]],
  ];

  for (const [label, contentBlocks] of cases) {
    it(`content_blocks ${label}: every tool_result is paired with a tool_use in the turn before it, and the call is sent once`, async () => {
      const messages = await sentMessages(new AssistantMessage('Looking it up.', [call], { content_blocks: contentBlocks }));
      expect(pairing(messages)).toEqual([]);
      const assistant = messages.find((message) => message.role === 'assistant')!;
      expect((assistant.content as JsonObject[]).filter((block) => block.type === 'tool_use').map((block) => block.id)).toEqual(['toolu_1']);
    });
  }

  it('the order stays thinking, then text, then tool_use', async () => {
    const messages = await sentMessages(new AssistantMessage('Looking it up.', [call], { content_blocks: [thinking, text] }));
    const assistant = messages.find((message) => message.role === 'assistant')!;
    expect((assistant.content as JsonObject[]).map((block) => block.type)).toEqual(['thinking', 'text', 'tool_use']);
    expect((assistant.content as JsonObject[]).at(-1)).toEqual(toolUse);
  });

  it('a turn with no tool calls is replayed from its blocks unchanged', async () => {
    const calls: HttpRequest[] = [];
    const transport: HttpTransport = (request) => {
      calls.push(request);
      return Promise.resolve({ status: 200, headers: {}, body: OK_BODY, rawBody: JSON.stringify(OK_BODY) });
    };
    await Prism.text()
      .using('anthropic', 'claude-sonnet-5-5', { apiKey: 'sk-test', transport })
      .withMessages([new UserMessage('Hi.'), new AssistantMessage('Hello.', [], { content_blocks: [thinking, { type: 'text', text: 'Hello.' }] }), new UserMessage('Again.')])
      .asText();
    const messages = (JSON.parse(String(calls[0]?.body ?? '{}')) as { messages: JsonObject[] }).messages;
    expect(messages[1]).toEqual({ role: 'assistant', content: [thinking, { type: 'text', text: 'Hello.' }] });
  });
});
