import type { JsonObject } from '../json.js';
import type { Usage } from '../value-objects/usage.js';

/** Where a batch is in its lifecycle, as the provider names it. */
export enum BatchStatus {
  Validating = 'validating',
  InProgress = 'in_progress',
  Finalizing = 'finalizing',
  Completed = 'completed',
  Failed = 'failed',
  Cancelling = 'cancelling',
  Cancelled = 'cancelled',
  Expired = 'expired',
}

/** How one item inside a batch turned out. */
export enum BatchResultStatus {
  Succeeded = 'succeeded',
  Errored = 'errored',
  Canceled = 'canceled',
  Expired = 'expired',
}

/**
 * How many requests are in each state.
 *
 * FIVE counts and a total, matching the reference — but OpenAI reports only
 * three (`total`, `completed`, `failed`), so `canceled` and `expired` stay zero
 * on that provider. They are not dropped, because a batch that was cancelled
 * mid-flight is a real thing another provider does report.
 */
export class BatchJobRequestCounts {
  constructor(
    readonly processing = 0,
    readonly succeeded = 0,
    readonly failed = 0,
    readonly canceled = 0,
    readonly expired = 0,
    readonly total = 0,
  ) {}

  toObject(): JsonObject {
    return {
      processing: this.processing,
      succeeded: this.succeeded,
      failed: this.failed,
      canceled: this.canceled,
      expired: this.expired,
      total: this.total,
    };
  }
}

export interface BatchJobError {
  code: string;
  message: string;
  line: number | null;
  param: string | null;
}

/** A submitted batch: what it is, where it is, and what came of it. */
export class BatchJob {
  constructor(
    readonly id: string,
    readonly status: BatchStatus,
    readonly requestCounts: BatchJobRequestCounts,
    /** ISO 8601, in UTC — see `parseBatchJob`. */
    readonly createdAt: string | null = null,
    readonly expiresAt: string | null = null,
    readonly endedAt: string | null = null,
    readonly resultsUrl: string | null = null,
    readonly inputFileId: string | null = null,
    readonly outputFileId: string | null = null,
    readonly errorFileId: string | null = null,
    readonly errors: readonly BatchJobError[] = [],
  ) {}

  toObject(): JsonObject {
    return {
      id: this.id,
      status: this.status,
      request_counts: this.requestCounts.toObject(),
      created_at: this.createdAt,
      expires_at: this.expiresAt,
      ended_at: this.endedAt,
      results_url: this.resultsUrl,
      input_file_id: this.inputFileId,
      output_file_id: this.outputFileId,
      error_file_id: this.errorFileId,
      errors: this.errors.map((error) => ({ ...error })),
    };
  }
}

/** One page of batches. */
export class BatchListResult {
  constructor(
    readonly data: readonly BatchJob[],
    readonly hasMore = false,
    readonly lastId: string | null = null,
  ) {}

  toObject(): JsonObject {
    return {
      data: this.data.map((job) => job.toObject()),
      has_more: this.hasMore,
      last_id: this.lastId,
    };
  }
}

/**
 * What one request in a batch produced.
 *
 * `text` and `usage` are null on a failure and `errorType`/`errorMessage` are
 * null on a success — the four fields are read together with `status`, which is
 * the field that says which pair means anything.
 */
export class BatchResultItem {
  constructor(
    readonly customId: string,
    readonly status: BatchResultStatus,
    readonly text: string | null = null,
    readonly usage: Usage | null = null,
    readonly messageId: string | null = null,
    readonly model: string | null = null,
    readonly errorType: string | null = null,
    readonly errorMessage: string | null = null,
  ) {}

  toObject(): JsonObject {
    return {
      custom_id: this.customId,
      status: this.status,
      text: this.text,
      usage: this.usage === null ? null : this.usage.toObject(),
      message_id: this.messageId,
      model: this.model,
      error_type: this.errorType,
      error_message: this.errorMessage,
    };
  }
}
