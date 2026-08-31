import type { JsonObject, JsonValue } from '../json.js';
import type { TextRequest } from '../text/request.js';

interface BaseOptions {
  providerKey: string;
  clientOptions?: Readonly<Record<string, unknown>>;
  providerOptions?: Readonly<JsonObject>;
}

abstract class BatchRequestBase {
  readonly #providerKey: string;

  readonly #clientOptions: Readonly<Record<string, unknown>>;

  readonly #providerOptions: JsonObject;

  constructor(options: BaseOptions) {
    this.#providerKey = options.providerKey;
    this.#clientOptions = options.clientOptions ?? {};
    this.#providerOptions = { ...(options.providerOptions ?? {}) };
  }

  providerKey(): string {
    return this.#providerKey;
  }

  clientOptions(): Readonly<Record<string, unknown>> {
    return this.#clientOptions;
  }

  providerOptions(): JsonObject;
  providerOptions(path: string): JsonValue | undefined;
  providerOptions(path?: string): JsonObject | JsonValue | undefined {
    return path === undefined ? this.#providerOptions : this.#providerOptions[path];
  }
}

/**
 * One request inside a batch, and the id the caller will match it back by.
 *
 * `customId` is the caller's, not the provider's: results come back in whatever
 * order the provider finished them, so this is the only thing tying a result to
 * the request that produced it.
 */
export class BatchRequestItem {
  constructor(
    readonly customId: string,
    readonly request: TextRequest,
  ) {}
}

export interface BatchRequestOptions extends BaseOptions {
  items?: readonly BatchRequestItem[] | null;
  inputFileId?: string | null;
}

/**
 * A batch to create, described either way.
 *
 * `items` and `inputFileId` are alternatives, not a pair. Supplying items means
 * the provider mapping builds a JSONL file and uploads it; supplying a file id
 * means one was uploaded already. Which of the two is set is checked at send
 * time rather than here, because it is a PROVIDER rule — a provider that
 * accepted inline items would have nothing to complain about.
 */
export class BatchRequest extends BatchRequestBase {
  readonly items: readonly BatchRequestItem[] | null;

  readonly inputFileId: string | null;

  constructor(options: BatchRequestOptions) {
    super(options);
    this.items = options.items ?? null;
    this.inputFileId = options.inputFileId ?? null;
  }
}

export interface ListBatchesRequestOptions extends BaseOptions {
  limit?: number | null;
  afterId?: string | null;
  beforeId?: string | null;
}

export class ListBatchesRequest extends BatchRequestBase {
  readonly limit: number | null;

  readonly afterId: string | null;

  /** Carried and dropped by the OpenAI mapper, exactly as on `ListFilesRequest`. */
  readonly beforeId: string | null;

  constructor(options: ListBatchesRequestOptions) {
    super(options);
    this.limit = options.limit ?? null;
    this.afterId = options.afterId ?? null;
    this.beforeId = options.beforeId ?? null;
  }
}

export interface BatchIdRequestOptions extends BaseOptions {
  batchId: string;
}

/** The three requests that are nothing but a batch id. */
class BatchIdRequest extends BatchRequestBase {
  readonly batchId: string;

  constructor(options: BatchIdRequestOptions) {
    super(options);
    this.batchId = options.batchId;
  }
}

export class RetrieveBatchRequest extends BatchIdRequest {}

export class GetBatchResultsRequest extends BatchIdRequest {}

export class CancelBatchRequest extends BatchIdRequest {}
