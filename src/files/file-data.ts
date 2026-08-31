import type { JsonObject } from '../json.js';

/** One file, as the provider describes it. */
export class FileData {
  constructor(
    readonly id: string,
    readonly filename: string | null = null,
    /**
     * NULL on OpenAI, always. Its files endpoint reports `id`, `object`,
     * `bytes`, `created_at`, `filename` and `purpose` — and no content type at
     * all. The field is here because the reference has it and another provider
     * may fill it; it is not a parsing bug when it is empty.
     */
    readonly mimeType: string | null = null,
    readonly sizeBytes: number | null = null,
    /** ISO 8601, in UTC. See `fileDataFromObject`. */
    readonly createdAt: string | null = null,
    readonly purpose: string | null = null,
    readonly raw: Readonly<JsonObject> | null = null,
  ) {}

  toObject(): JsonObject {
    return {
      id: this.id,
      filename: this.filename,
      mime_type: this.mimeType,
      size_bytes: this.sizeBytes,
      created_at: this.createdAt,
      purpose: this.purpose,
    };
  }
}

/** Files that came back from a list call, and where the page ends. */
export class FileListResult {
  constructor(
    readonly data: readonly FileData[],
    readonly hasMore = false,
    readonly firstId: string | null = null,
    readonly lastId: string | null = null,
  ) {}

  toObject(): JsonObject {
    return {
      data: this.data.map((file) => file.toObject()),
      has_more: this.hasMore,
      first_id: this.firstId,
      last_id: this.lastId,
    };
  }
}

/**
 * What a delete call reported.
 *
 * `deleted` is the provider's own answer, not an inference from the status
 * code: OpenAI answers 200 with `deleted: false` for a file it declined to
 * remove, and treating the status as the verdict would report a success that
 * did not happen.
 */
export class DeleteFileResult {
  constructor(
    readonly id: string,
    readonly deleted: boolean,
  ) {}

  toObject(): JsonObject {
    return { id: this.id, deleted: this.deleted };
  }
}
