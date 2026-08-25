import type { JsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';
import { AssistantMessage } from './assistant-message.js';
import { SystemMessage } from './system-message.js';
import { ToolResultMessage } from './tool-result-message.js';
import { UserMessage } from './user-message.js';

export { AssistantMessage } from './assistant-message.js';
export { SystemMessage } from './system-message.js';
export { ToolResultMessage } from './tool-result-message.js';
export { UserMessage } from './user-message.js';

/**
 * The message union, discriminated on `type`.
 *
 * `type` is the same string each message's `toObject()` emits, so the
 * discriminant and the serialized form cannot drift apart.
 */
export type Message = UserMessage | AssistantMessage | SystemMessage | ToolResultMessage;

export type MessageType = Message['type'];

/**
 * Rebuild a message from its serialized form.
 *
 * The reference package has `toArray()` and no counterpart, which left every
 * consumer to invent its own. This is the counterpart.
 *
 * @throws PrismError code `unknown_message_type`
 */
export function messageFromObject(object: JsonObject): Message {
  switch (object.type) {
    case 'user':
      return UserMessage.fromObject(object);
    case 'assistant':
      return AssistantMessage.fromObject(object);
    case 'system':
      return SystemMessage.fromObject(object);
    case 'tool_result':
      return ToolResultMessage.fromObject(object);
    default:
      throw PrismError.unknownMessageType(String(object.type));
  }
}
