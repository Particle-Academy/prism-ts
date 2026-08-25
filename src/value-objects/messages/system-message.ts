import type { JsonObject } from '../../json.js';

export class SystemMessage {
  readonly type = 'system' as const;

  constructor(readonly content: string) {}

  toObject(): JsonObject {
    return {
      type: 'system',
      content: this.content,
    };
  }

  static fromObject(object: JsonObject): SystemMessage {
    return new SystemMessage(typeof object.content === 'string' ? object.content : '');
  }
}
