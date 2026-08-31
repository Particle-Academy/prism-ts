import type { JsonObject } from '../json.js';
import { PrismError } from '../errors.js';
import type { Provider } from '../providers/provider.js';
import { resolveProvider } from '../providers/registry.js';
import type { DeleteFileResult, FileData, FileListResult } from './file-data.js';
import {
  DeleteFileRequest,
  DownloadFileRequest,
  GetFileMetadataRequest,
  ListFilesRequest,
  UploadFileRequest,
} from './request.js';

/**
 * The builder for provider-side file storage.
 *
 * FIVE terminals rather than one, because these are five different operations
 * on a store, not five renderings of one request. `using()` is the only thing
 * they share — there is no model, no prompt, and nothing to accumulate between
 * calls, so the builder is thin by nature rather than by omission.
 */
export class FilesPendingRequest {
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

  async upload(content: Uint8Array, filename: string, mimeType: string | null = null): Promise<FileData> {
    return this.provider().uploadFile(this.toUploadRequest(content, filename, mimeType));
  }

  async list(
    limit: number | null = null,
    afterId: string | null = null,
    beforeId: string | null = null,
  ): Promise<FileListResult> {
    return this.provider().listFiles(this.toListRequest(limit, afterId, beforeId));
  }

  async getMetadata(fileId: string): Promise<FileData> {
    return this.provider().getFileMetadata(this.toGetMetadataRequest(fileId));
  }

  async delete(fileId: string): Promise<DeleteFileResult> {
    return this.provider().deleteFile(this.toDeleteRequest(fileId));
  }

  /**
   * The file's bytes.
   *
   * The reference returns a PHP string, which is a byte array. `Uint8Array`
   * here for the same reason `UploadFileRequest.content` takes one: decoding a
   * PDF as UTF-16 to hand back a JavaScript string corrupts it, and the caller
   * has no way to tell.
   */
  async download(fileId: string): Promise<Uint8Array> {
    return this.provider().downloadFile(this.toDownloadRequest(fileId));
  }

  toUploadRequest(content: Uint8Array, filename: string, mimeType: string | null = null): UploadFileRequest {
    return new UploadFileRequest({
      providerKey: this.#providerKey,
      filename,
      content,
      mimeType,
      clientOptions: this.#clientOptions,
      providerOptions: this.#providerOptions,
    });
  }

  toListRequest(
    limit: number | null = null,
    afterId: string | null = null,
    beforeId: string | null = null,
  ): ListFilesRequest {
    return new ListFilesRequest({
      providerKey: this.#providerKey,
      limit,
      afterId,
      beforeId,
      clientOptions: this.#clientOptions,
      providerOptions: this.#providerOptions,
    });
  }

  toGetMetadataRequest(fileId: string): GetFileMetadataRequest {
    return new GetFileMetadataRequest({ ...this.#base(), fileId });
  }

  toDeleteRequest(fileId: string): DeleteFileRequest {
    return new DeleteFileRequest({ ...this.#base(), fileId });
  }

  toDownloadRequest(fileId: string): DownloadFileRequest {
    return new DownloadFileRequest({ ...this.#base(), fileId });
  }

  #base(): { providerKey: string; clientOptions: Record<string, unknown>; providerOptions: JsonObject } {
    return {
      providerKey: this.#providerKey,
      clientOptions: this.#clientOptions,
      providerOptions: this.#providerOptions,
    };
  }
}
