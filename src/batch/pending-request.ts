import type { JsonObject } from '../json.js';
import { PrismError } from '../errors.js';
import type { Provider } from '../providers/provider.js';
import { resolveProvider } from '../providers/registry.js';
import type { BatchJob, BatchListResult, BatchResultItem } from './batch-job.js';
import {
  BatchRequest,
  type BatchRequestItem,
  CancelBatchRequest,
  GetBatchResultsRequest,
  ListBatchesRequest,
  RetrieveBatchRequest,
} from './request.js';

/**
 * The builder for batch jobs.
 *
 * Five terminals, like `files`, and for the same reason: submitting a batch,
 * polling one, listing them, reading results and cancelling are five operations
 * on a queue rather than five renderings of one request.
 */
export class BatchPendingRequest {
  #provider: Provider | null = null;

  #providerKey = '';

  #providerOptions: JsonObject = {};

  #clientOptions: Record<string, unknown> = {};

  using(provider: string, providerConfig: Record<string, unknown> = {}): this {
    this.#providerKey = provider;
    this.#provider = resolveProvider(provider, providerConfig);

    return this;
  }

  withProviderOptions(options: Readonly<JsonObject> = {}): this {
    this.#providerOptions = { ...options };

    return this;
  }

  withClientOptions(options: Record<string, unknown>): this {
    this.#clientOptions = { ...options };

    return this;
  }

  provider(): Provider {
    if (this.#provider === null) {
      throw PrismError.unsupportedProviderAction(
        'Sending a request',
        'a pending request with no provider — call using() first',
      );
    }

    return this.#provider;
  }

  async create(
    items: readonly BatchRequestItem[] | null = null,
    inputFileId: string | null = null,
  ): Promise<BatchJob> {
    return this.provider().batch(this.toCreateRequest(items, inputFileId));
  }

  async retrieve(batchId: string): Promise<BatchJob> {
    return this.provider().retrieveBatch(this.toRetrieveRequest(batchId));
  }

  async list(
    limit: number | null = null,
    afterId: string | null = null,
    beforeId: string | null = null,
  ): Promise<BatchListResult> {
    return this.provider().listBatches(this.toListRequest(limit, afterId, beforeId));
  }

  async getResults(batchId: string): Promise<readonly BatchResultItem[]> {
    return this.provider().getBatchResults(this.toGetResultsRequest(batchId));
  }

  async cancel(batchId: string): Promise<BatchJob> {
    return this.provider().cancelBatch(this.toCancelRequest(batchId));
  }

  toCreateRequest(
    items: readonly BatchRequestItem[] | null = null,
    inputFileId: string | null = null,
  ): BatchRequest {
    return new BatchRequest({ ...this.#base(), items, inputFileId });
  }

  toRetrieveRequest(batchId: string): RetrieveBatchRequest {
    return new RetrieveBatchRequest({ ...this.#base(), batchId });
  }

  toListRequest(
    limit: number | null = null,
    afterId: string | null = null,
    beforeId: string | null = null,
  ): ListBatchesRequest {
    return new ListBatchesRequest({ ...this.#base(), limit, afterId, beforeId });
  }

  toGetResultsRequest(batchId: string): GetBatchResultsRequest {
    return new GetBatchResultsRequest({ ...this.#base(), batchId });
  }

  toCancelRequest(batchId: string): CancelBatchRequest {
    return new CancelBatchRequest({ ...this.#base(), batchId });
  }

  #base(): { providerKey: string; clientOptions: Record<string, unknown>; providerOptions: JsonObject } {
    return {
      providerKey: this.#providerKey,
      clientOptions: this.#clientOptions,
      providerOptions: this.#providerOptions,
    };
  }
}
