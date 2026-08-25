import type { JsonObject } from '../json.js';
import { isJsonObject } from '../json.js';

/** A binary payload a tool produced alongside its textual result. */
export class Artifact {
  constructor(
    readonly data: string,
    readonly mimeType: string,
    readonly metadata: Readonly<JsonObject> = {},
    readonly id: string | null = null,
  ) {}

  rawContent(): Uint8Array {
    return Uint8Array.from(Buffer.from(this.data, 'base64'));
  }

  static fromRawContent(
    content: string | Uint8Array,
    mimeType: string,
    metadata: Readonly<JsonObject> = {},
    id: string | null = null,
  ): Artifact {
    return new Artifact(Buffer.from(content).toString('base64'), mimeType, metadata, id);
  }

  toObject(): JsonObject {
    return {
      id: this.id,
      data: this.data,
      mime_type: this.mimeType,
      metadata: { ...this.metadata },
    };
  }

  static fromObject(object: JsonObject): Artifact {
    return new Artifact(
      typeof object.data === 'string' ? object.data : '',
      typeof object.mime_type === 'string' ? object.mime_type : '',
      isJsonObject(object.metadata) ? object.metadata : {},
      typeof object.id === 'string' ? object.id : null,
    );
  }
}
