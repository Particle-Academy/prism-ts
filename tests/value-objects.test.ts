import { describe, expect, it } from 'vitest';
import {
  Artifact,
  AssistantMessage,
  Meta,
  PrismError,
  ProviderRateLimit,
  ProviderTool,
  SystemMessage,
  Text,
  ToolCall,
  ToolResult,
  ToolResultMessage,
  Usage,
  UserMessage,
  messageFromObject,
} from '../src/index.js';
import type { JsonObject } from '../src/index.js';

/**
 * The reference has toArray() and no counterpart, which left every consumer to
 * invent its own — and one of them shipped a defect doing it. Both directions
 * ship here, so these assert the round trip rather than the shape alone.
 */
const roundTrips = (object: { toObject(): JsonObject }, rebuild: (raw: JsonObject) => { toObject(): JsonObject }): void => {
  expect(rebuild(object.toObject()).toObject()).toEqual(object.toObject());
};

describe('message toObject', () => {
  it('emits snake_case keys in the reference order', () => {
    expect(Object.keys(new UserMessage('hi').toObject())).toEqual([
      'type',
      'content',
      'additional_content',
      'additional_attributes',
    ]);
    expect(Object.keys(new AssistantMessage('hi').toObject())).toEqual([
      'type',
      'content',
      'tool_calls',
      'additional_content',
      'tool_approval_requests',
    ]);
    expect(Object.keys(new SystemMessage('hi').toObject())).toEqual(['type', 'content']);
    expect(Object.keys(new ToolResultMessage().toObject())).toEqual([
      'type',
      'tool_results',
      'tool_approval_responses',
    ]);
  });

  it('carries the turn text as a trailing text part', () => {
    expect(new UserMessage('hi').toObject()).toEqual({
      type: 'user',
      content: 'hi',
      additional_content: [{ text: 'hi' }],
      additional_attributes: {},
    });
  });
});

describe('message fromObject', () => {
  it('round-trips a user message without duplicating its own text part', () => {
    const message = new UserMessage('hi', [], { id: 'msg_1' });

    roundTrips(message, (raw) => UserMessage.fromObject(raw));
    expect(UserMessage.fromObject(message.toObject()).additionalContent).toHaveLength(1);
  });

  it('round-trips a user message that carries extra text parts', () => {
    const message = new UserMessage('world', [new Text('hello ')]);

    roundTrips(message, (raw) => UserMessage.fromObject(raw));
    expect(UserMessage.fromObject(message.toObject()).text()).toBe('hello world');
  });

  it('round-trips an assistant message with tool calls', () => {
    const message = new AssistantMessage('', [new ToolCall('fc_1', 'weather', { city: 'Paris' }, 'call_1')], {
      note: 'x',
    });

    roundTrips(message, (raw) => AssistantMessage.fromObject(raw));
  });

  it('round-trips a tool result message', () => {
    const message = new ToolResultMessage([
      new ToolResult('fc_1', 'weather', { city: 'Paris' }, { temp: 21 }, 'call_1', [
        new Artifact('ZGF0YQ==', 'text/plain', { source: 'test' }, 'art_1'),
      ]),
    ]);

    roundTrips(message, (raw) => ToolResultMessage.fromObject(raw));
  });

  it('round-trips a system message', () => {
    roundTrips(new SystemMessage('be terse'), (raw) => SystemMessage.fromObject(raw));
  });

  it('dispatches on the type discriminant', () => {
    expect(messageFromObject(new UserMessage('hi').toObject())).toBeInstanceOf(UserMessage);
    expect(messageFromObject(new AssistantMessage('hi').toObject())).toBeInstanceOf(AssistantMessage);
    expect(messageFromObject(new SystemMessage('hi').toObject())).toBeInstanceOf(SystemMessage);
    expect(messageFromObject(new ToolResultMessage().toObject())).toBeInstanceOf(ToolResultMessage);
  });

  it('refuses an unknown message type with a code', () => {
    try {
      messageFromObject({ type: 'nonsense' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PrismError);
      expect((error as PrismError).code).toBe('unknown_message_type');
    }
  });

  it('refuses a media part it cannot rebuild', () => {
    try {
      UserMessage.fromObject({ type: 'user', content: 'hi', additional_content: [{ image_url: 'x' }] });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as PrismError).code).toBe('unknown_message_type');
    }
  });
});

describe('supporting value objects', () => {
  it('round-trips a tool call', () => {
    roundTrips(new ToolCall('fc_1', 'weather', '{"city":"Paris"}', 'call_1', 'rs_1', [{ text: 'why' }]), (raw) =>
      ToolCall.fromObject(raw),
    );
    expect(Object.keys(new ToolCall('a', 'b', {}).toObject())).toEqual([
      'id',
      'name',
      'arguments',
      'result_id',
      'reasoning_id',
      'reasoning_summary',
    ]);
  });

  it('round-trips usage, meta, a rate limit, a provider tool and an artifact', () => {
    roundTrips(new Usage(10, 5, 1, 2, 3, 0.25), (raw) => Usage.fromObject(raw));
    roundTrips(new Meta('resp_1', 'gpt-4o', [new ProviderRateLimit('tokens', 100, 90, new Date(0))], 'flex'), (raw) =>
      Meta.fromObject(raw),
    );
    roundTrips(new ProviderTool('web_search_preview', 'search', { depth: 2 }), (raw) => ProviderTool.fromObject(raw));
    roundTrips(new Artifact('ZGF0YQ==', 'text/plain', { a: 1 }, 'art_1'), (raw) => Artifact.fromObject(raw));
  });

  it('emits usage keys in the reference order', () => {
    expect(Object.keys(new Usage(1, 2).toObject())).toEqual([
      'prompt_tokens',
      'completion_tokens',
      'cache_write_input_tokens',
      'cache_read_input_tokens',
      'thought_tokens',
      'cost',
    ]);
  });

  it('formats a rate-limit reset with an explicit UTC offset', () => {
    expect(new ProviderRateLimit('tokens', 1, 1, new Date('2026-08-25T11:15:00Z')).toObject().resets_at).toBe(
      '2026-08-25T11:15:00+00:00',
    );
  });

  it('round-trips a tool result and keeps a null result null', () => {
    roundTrips(new ToolResult('fc_1', 'weather', { city: 'Paris' }, 'sunny', 'call_1'), (raw) =>
      ToolResult.fromObject(raw),
    );
    expect(ToolResult.fromObject(new ToolResult('a', 'b', {}, null).toObject()).result).toBeNull();
  });
});

describe('ToolCall.parsedArguments', () => {
  it('passes an already-decoded object through', () => {
    expect(new ToolCall('a', 'b', { city: 'Paris' }).parsedArguments()).toEqual({ city: 'Paris' });
  });

  it('decodes a JSON string', () => {
    expect(new ToolCall('a', 'b', '{"city":"Paris"}').parsedArguments()).toEqual({ city: 'Paris' });
  });

  it('treats an empty string and the string zero as no arguments', () => {
    expect(new ToolCall('a', 'b', '').parsedArguments()).toEqual({});
    expect(new ToolCall('a', 'b', '0').parsedArguments()).toEqual({});
  });

  it('recovers from raw control characters inside string values', () => {
    expect(new ToolCall('a', 'b', '{"note":"line\none"}').parsedArguments()).toEqual({ note: 'line\none' });
  });

  it('fails with a code on arguments that are not JSON at all', () => {
    try {
      new ToolCall('a', 'weather', '{not json').parsedArguments();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as PrismError).code).toBe('malformed_tool_call_arguments');
    }
  });
});
