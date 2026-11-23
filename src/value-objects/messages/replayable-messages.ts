import { AssistantMessage } from './assistant-message.js';
import type { Message } from './index.js';

/**
 * The conversation as a provider can be sent it.
 *
 * A tool call whose arguments could not be parsed cannot go back as written,
 * and a provider requires the call beside its result. Once a later message
 * answers the call, the error is on record and the call is sent with no
 * arguments. A call nobody answered is left alone, so that mapping it still
 * fails with `malformed_tool_call_arguments`.
 */
export function replayableMessages(messages: readonly Message[]): Message[] {
  const replayable = [...messages];
  const answered = new Set<string>();

  for (let index = replayable.length - 1; index >= 0; index -= 1) {
    const message = replayable[index];

    if (message?.type === 'tool_result') {
      for (const result of message.toolResults) answered.add(result.toolCallId);
      continue;
    }

    if (message?.type !== 'assistant' || answered.size === 0) continue;

    const toolCalls = message.toolCalls.map((call) => (answered.has(call.id) ? call.withoutMalformedArguments() : call));

    if (toolCalls.some((call, position) => call !== message.toolCalls[position])) {
      replayable[index] = new AssistantMessage(message.content, toolCalls, message.additionalContent, message.toolApprovalRequests);
    }
  }

  return replayable;
}
