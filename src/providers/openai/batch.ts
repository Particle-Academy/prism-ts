import { canonicalJson, isJsonObject, type JsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';
import {
  BatchJob,
  BatchJobRequestCounts,
  BatchListResult,
  BatchResultItem,
  BatchResultStatus,
  BatchStatus,
} from '../../batch/batch-job.js';
import type { BatchJobError } from '../../batch/batch-job.js';
import type { BatchRequestItem, ListBatchesRequest } from '../../batch/request.js';
import { Usage } from '../../value-objects/usage.js';
import { buildRequestBody } from './build-request-body.js';

/** The JSONL body OpenAI's batch endpoint expects, one request per line. */
export function buildBatchInputFile(items: readonly BatchRequestItem[]): string {
  return items
    .map((item) =>
      canonicalJson({
        custom_id: item.customId,
        method: 'POST',
        url: '/v1/responses',
        body: buildRequestBody(item.request),
      }),
    )
    .join('\n');
}

export function buildBatchBody(inputFileId: string, completionWindow: unknown): JsonObject {
  return {
    input_file_id: inputFileId,
    endpoint: '/v1/responses',
    // Required by the endpoint, and `24h` is OpenAI's only supported window
    // today — so a default here beats an error naming a field the caller never
    // knew existed.
    completion_window: typeof completionWindow === 'string' ? completionWindow : '24h',
  };
}

export function buildBatchListQuery(request: ListBatchesRequest): Record<string, string> {
  const query: Record<string, string> = {};

  if (request.limit !== null) {
    query.limit = String(request.limit);
  }

  if (request.afterId !== null) {
    query.after = request.afterId;
  }

  return query;
}

const STATUSES: readonly BatchStatus[] = Object.values(BatchStatus);

/**
 * A wire status, or a refusal.
 *
 * Matching the reference, an unrecognised status THROWS rather than mapping to
 * a plausible member. It reads harsh for a polling loop, and it is still right:
 * a new status means the provider changed something about the lifecycle, and
 * quietly calling it `InProgress` would leave a caller waiting forever on a
 * batch that had already stopped.
 */
export function batchStatusFromValue(value: unknown): BatchStatus {
  const status = STATUSES.find((known) => known === value);

  if (status === undefined) {
    throw PrismError.providerResponseError(`Unknown OpenAI batch status: ${String(value)}`);
  }

  return status;
}

export function parseBatchJob(rawBody: unknown): BatchJob {
  if (!isJsonObject(rawBody)) {
    throw PrismError.providerResponseError('OpenAI returned an empty or non-object batch response.');
  }

  const counts = isJsonObject(rawBody.request_counts) ? rawBody.request_counts : {};
  const total = readNumber(counts.total);
  const succeeded = readNumber(counts.completed);
  const failed = readNumber(counts.failed);

  return new BatchJob(
    readString(rawBody.id) ?? '',
    batchStatusFromValue(rawBody.status),
    new BatchJobRequestCounts(
      // OpenAI does not report an in-flight count, so it is derived. Clamped at
      // zero: a partial response — total missing while completed is not —
      // produces a negative, and a negative number of in-flight requests is not
      // a state anything can be in.
      Math.max(0, total - succeeded - failed),
      succeeded,
      failed,
      // OpenAI reports neither, so they stay zero rather than being guessed.
      0,
      0,
      total,
    ),
    readTimestamp(rawBody.created_at),
    readTimestamp(rawBody.expires_at),
    // OpenAI's field is `completed_at`; the port's is `endedAt`, matching the
    // reference, because a cancelled batch also ends.
    readTimestamp(rawBody.completed_at),
    readString(rawBody.results_url),
    readString(rawBody.input_file_id),
    readString(rawBody.output_file_id),
    readString(rawBody.error_file_id),
    readErrors(rawBody.errors),
  );
}

export function parseBatchListResponse(rawBody: unknown): BatchListResult {
  if (!isJsonObject(rawBody)) {
    return new BatchListResult([]);
  }

  const data = Array.isArray(rawBody.data) ? rawBody.data : [];

  return new BatchListResult(
    data.map((entry) => parseBatchJob(entry)),
    rawBody.has_more === true,
    readString(rawBody.last_id),
  );
}

/**
 * The results file, one JSON object per line.
 *
 * A line that will not parse is SKIPPED rather than fatal. The file is written
 * by the provider a request at a time, and one malformed record should not cost
 * a caller the other nine hundred.
 */
export function parseBatchResults(body: string): BatchResultItem[] {
  const items: BatchResultItem[] = [];

  for (const line of body.split('\n')) {
    const trimmed = line.trim();

    if (trimmed === '') {
      continue;
    }

    let decoded: unknown;

    try {
      decoded = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (isJsonObject(decoded)) {
      items.push(parseBatchResultItem(decoded));
    }
  }

  return items;
}

export function parseBatchResultItem(data: JsonObject): BatchResultItem {
  const customId = readString(data.custom_id) ?? '';
  const error = isJsonObject(data.error) ? data.error : null;

  if (error !== null) {
    const code = readString(error.code) ?? '';

    return new BatchResultItem(
      customId,
      // `batch_expired` is its own outcome, not an error: the request was never
      // run, so reporting it as a failure would blame the request.
      code === 'batch_expired' ? BatchResultStatus.Expired : BatchResultStatus.Errored,
      null,
      null,
      null,
      null,
      code,
      readString(error.message),
    );
  }

  const body = isJsonObject(data.response) && isJsonObject(data.response.body) ? data.response.body : {};

  return new BatchResultItem(
    customId,
    BatchResultStatus.Succeeded,
    extractText(body),
    extractUsage(body),
    readString(body.id),
    readString(body.model),
  );
}

/**
 * The assistant's text, from either API shape.
 *
 * Responses output is searched from the END: a turn that used tools has the
 * message last, and taking the first would return whatever preceded the tool
 * call.
 */
function extractText(body: JsonObject): string {
  const output = Array.isArray(body.output) ? body.output : [];

  for (const item of [...output].reverse()) {
    if (!isJsonObject(item) || item.type !== 'message') {
      continue;
    }

    const content = Array.isArray(item.content) ? item.content : [];

    for (const part of content) {
      if (isJsonObject(part) && part.type === 'output_text' && typeof part.text === 'string') {
        return part.text;
      }
    }
  }

  // The chat-completions shape, for a batch submitted against that endpoint.
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const first = choices[0];

  if (isJsonObject(first) && isJsonObject(first.message) && typeof first.message.content === 'string') {
    return first.message.content;
  }

  return '';
}

function extractUsage(body: JsonObject): Usage {
  const usage = isJsonObject(body.usage) ? body.usage : {};
  const inputDetails = isJsonObject(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const outputDetails = isJsonObject(usage.output_tokens_details) ? usage.output_tokens_details : {};

  return new Usage(
    readNumber(usage.input_tokens ?? usage.prompt_tokens),
    readNumber(usage.output_tokens ?? usage.completion_tokens),
    // Cache WRITE is not reported here. `cached_tokens` is what was READ from
    // the cache — the two are billed differently, and putting one in the
    // other's slot misreports the cost in the direction that flatters it.
    null,
    typeof inputDetails.cached_tokens === 'number' ? inputDetails.cached_tokens : null,
    typeof outputDetails.reasoning_tokens === 'number' ? outputDetails.reasoning_tokens : null,
  );
}

function readErrors(value: unknown): BatchJobError[] {
  const data = isJsonObject(value) && Array.isArray(value.data) ? value.data : [];

  return data.filter(isJsonObject).map((entry) => ({
    code: readString(entry.code) ?? '',
    message: readString(entry.message) ?? '',
    line: typeof entry.line === 'number' ? entry.line : null,
    param: readString(entry.param),
  }));
}

/** Unix seconds to ISO 8601 in UTC. Same reasoning as `files`. */
function readTimestamp(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
