import { isJsonObject, type JsonObject } from '../../json.js';
import { DeleteFileResult, FileData, FileListResult } from '../../files/file-data.js';
import type { ListFilesRequest, UploadFileRequest } from '../../files/request.js';
import type { MultipartBody } from '../../http/transport.js';

export function buildUploadForm(request: UploadFileRequest): MultipartBody {
  const purpose = request.providerOptions('purpose');

  return {
    fields: {
      // REQUIRED by OpenAI, and it has no default. `assistants` is the purpose
      // that accepts the widest set of file types, so it is the one that fails
      // least often for a caller who did not know they had to choose.
      purpose: typeof purpose === 'string' ? purpose : 'assistants',
    },
    files: [
      {
        field: 'file',
        filename: request.filename,
        bytes: request.content,
        ...(request.mimeType === null ? {} : { contentType: request.mimeType }),
      },
    ],
  };
}

/**
 * The list query.
 *
 * `beforeId` is deliberately dropped: OpenAI's files endpoint paginates with
 * `after` only. Sending `before` would be ignored silently, which reads to a
 * caller like a working backwards page.
 */
export function buildListQuery(request: ListFilesRequest): Record<string, string> {
  const query: Record<string, string> = {};
  const purpose = request.providerOptions('purpose');

  if (request.limit !== null) {
    query.limit = String(request.limit);
  }

  if (request.afterId !== null) {
    query.after = request.afterId;
  }

  if (typeof purpose === 'string') {
    query.purpose = purpose;
  }

  return query;
}

export function parseFileData(rawBody: unknown): FileData {
  if (!isJsonObject(rawBody)) {
    return new FileData('');
  }

  return new FileData(
    readString(rawBody.id) ?? '',
    readString(rawBody.filename),
    readString(rawBody.mime_type),
    typeof rawBody.bytes === 'number' ? rawBody.bytes : null,
    readCreatedAt(rawBody.created_at),
    readString(rawBody.purpose),
    rawBody,
  );
}

export function parseFileListResponse(rawBody: unknown): FileListResult {
  if (!isJsonObject(rawBody)) {
    return new FileListResult([]);
  }

  const data = Array.isArray(rawBody.data) ? rawBody.data : [];

  return new FileListResult(
    data.map((entry) => parseFileData(entry)),
    rawBody.has_more === true,
    readString(rawBody.first_id),
    readString(rawBody.last_id),
  );
}

export function parseDeleteResponse(rawBody: unknown): DeleteFileResult {
  const body: JsonObject = isJsonObject(rawBody) ? rawBody : {};

  return new DeleteFileResult(
    readString(body.id) ?? '',
    // The provider's own verdict, not the status code. OpenAI answers 200 with
    // `deleted: false` for a file it declined to remove.
    body.deleted === true,
  );
}

/**
 * A unix timestamp, rendered as ISO 8601 in UTC.
 *
 * The reference uses PHP's `date('c')`, which renders in the SERVER's local
 * zone — so the same file reports a different creation time on two machines.
 * UTC here, deliberately: a timestamp that means something different depending
 * on who read it is not a timestamp.
 */
function readCreatedAt(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}
