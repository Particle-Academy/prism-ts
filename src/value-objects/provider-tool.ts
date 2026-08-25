import type { JsonObject } from '../json.js';
import { isJsonObject } from '../json.js';

/**
 * A tool the PROVIDER runs itself (web search, code interpreter, …) rather than
 * one the caller implements.
 *
 * The reference has no `toArray()` for this object; the shape below is this
 * port's, chosen to mirror the constructor. Note that `name` is deliberately
 * NOT part of what reaches the wire — the OpenAI mapper emits `type` plus the
 * `options` spread and nothing else.
 */
export class ProviderTool {
  constructor(
    readonly type: string,
    readonly name: string | null = null,
    readonly options: Readonly<JsonObject> = {},
  ) {}

  toObject(): JsonObject {
    return {
      type: this.type,
      name: this.name,
      options: { ...this.options },
    };
  }

  static fromObject(object: JsonObject): ProviderTool {
    return new ProviderTool(
      typeof object.type === 'string' ? object.type : '',
      typeof object.name === 'string' ? object.name : null,
      isJsonObject(object.options) ? object.options : {},
    );
  }
}
