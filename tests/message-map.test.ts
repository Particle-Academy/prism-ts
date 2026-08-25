import { describe, expect, it } from 'vitest';
import {
  AssistantMessage,
  PrismError,
  SystemMessage,
  Text,
  ToolCall,
  ToolResult,
  ToolResultMessage,
  UserMessage,
  canonicalJson,
  mapMessages,
} from '../src/index.js';
import type { Message } from '../src/index.js';

describe('mapMessages', () => {
  it('prepends system prompts and shapes the two roles differently', () => {
    const items = mapMessages([new UserMessage('Who are you?')], [new SystemMessage('You are terse.')]);

    expect(items).toEqual([
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: [{ type: 'input_text', text: 'Who are you?' }] },
    ]);
  });

  it('keeps system prompts in the order they were given', () => {
    const items = mapMessages([], [new SystemMessage('A'), new SystemMessage('B')]);

    expect(items).toEqual([
      { role: 'system', content: 'A' },
      { role: 'system', content: 'B' },
    ]);
  });

  it('maps an assistant turn without tool calls to an output_text part', () => {
    expect(mapMessages([new AssistantMessage('4')])).toEqual([
      { role: 'assistant', content: [{ type: 'output_text', text: '4' }] },
    ]);
  });

  it('emits no assistant item at all when the content is empty', () => {
    // An empty output_text part is rejected by the API, so the item is omitted
    // rather than emitted empty.
    expect(mapMessages([new UserMessage('hi'), new AssistantMessage('')])).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    ]);
  });

  it('expands each tool call into its own item with JSON-STRING arguments', () => {
    const items = mapMessages([
      new AssistantMessage('', [new ToolCall('fc_1', 'weather', { city: 'Paris' }, 'call_1')]),
    ]);

    expect(items).toEqual([
      {
        id: 'fc_1',
        call_id: 'call_1',
        type: 'function_call',
        name: 'weather',
        arguments: '{"city":"Paris"}',
      },
    ]);
  });

  it('encodes empty tool-call arguments as an object, not an array', () => {
    const items = mapMessages([new AssistantMessage('', [new ToolCall('fc_1', 'ping', {}, 'call_1')])]);

    expect(canonicalJson(items)).toContain('"arguments":"{}"');
  });

  it('groups tool calls that share a reasoning id behind one reasoning item', () => {
    const items = mapMessages([
      new AssistantMessage('', [
        new ToolCall('fc_1', 'a', {}, 'call_1', 'rs_1', [{ text: 'thinking' }]),
        new ToolCall('fc_2', 'b', {}, 'call_2', 'rs_1', [{ text: 'thinking' }]),
      ]),
    ]);

    expect(items[0]).toEqual({ type: 'reasoning', id: 'rs_1', summary: [{ text: 'thinking' }] });
    expect(items).toHaveLength(3);
  });

  it('keys a tool result by the RESULT id, not the tool call id', () => {
    const items = mapMessages([
      new ToolResultMessage([new ToolResult('fc_1', 'weather', { city: 'Paris' }, 'sunny', 'call_1')]),
    ]);

    expect(items).toEqual([{ type: 'function_call_output', call_id: 'call_1', output: 'sunny' }]);
  });

  it('passes a string tool result through untouched and encodes a structured one', () => {
    const items = mapMessages([
      new ToolResultMessage([
        new ToolResult('fc_1', 'a', {}, 'plain', 'call_1'),
        new ToolResult('fc_2', 'b', {}, { temp: 21 }, 'call_2'),
        new ToolResult('fc_3', 'c', {}, null, 'call_3'),
        new ToolResult('fc_4', 'd', {}, 42, 'call_4'),
      ]),
    ]);

    expect(items.map((item) => (item as { output: string }).output)).toEqual(['plain', '{"temp":21}', '', '42']);
  });

  it('spreads a user message additional attributes at ITEM level', () => {
    const items = mapMessages([new UserMessage('hi', [], { id: 'msg_local_1' })]);

    expect(items).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }], id: 'msg_local_1' },
    ]);
  });

  it('concatenates every text part of a user message', () => {
    const items = mapMessages([new UserMessage('world', [new Text('hello ')])]);

    expect(items).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'hello world' }] }]);
  });

  it('sends an empty prompt as an empty turn rather than dropping it', () => {
    expect(mapMessages([new UserMessage('')])).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: '' }] },
    ]);
  });

  it('rejects a value that is not a message with a coded error', () => {
    const notAMessage = { type: 'nonsense' } as unknown as Message;

    try {
      mapMessages([notAMessage]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PrismError);
      expect((error as PrismError).code).toBe('unknown_message_type');
    }
  });
});
