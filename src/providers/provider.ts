import { PrismError } from '../errors.js';
import type { TextRequest } from '../text/request.js';
import type { TextResponse } from '../text/response.js';
import type { EmbeddingsRequest } from '../embeddings/request.js';
import type { ImagesRequest } from '../images/request.js';
import type { SpeechToTextRequest, TextToSpeechRequest } from '../audio/request.js';
import type { AudioResponse, AudioTextResponse } from '../audio/response.js';
import type { ModerationRequest } from '../moderation/request.js';
import type {
  DeleteFileRequest,
  DownloadFileRequest,
  GetFileMetadataRequest,
  ListFilesRequest,
  UploadFileRequest,
} from '../files/request.js';
import type { DeleteFileResult, FileData, FileListResult } from '../files/file-data.js';
import type { ModerationResponse } from '../moderation/response.js';
import type { ImagesResponse } from '../images/response.js';
import type { EmbeddingsResponse } from '../embeddings/response.js';
import type { StreamEvent } from '../streaming/events.js';
import type { StructuredRequest } from '../structured/request.js';
import type { StructuredResponse } from '../structured/response.js';

/**
 * The provider contract.
 *
 * Every capability has a default that THROWS with a stable code, so a provider
 * implements only what it actually supports and asking for anything else fails
 * the same way everywhere instead of returning a plausible-looking empty result.
 *
 * `text` and `structured` are part of this port's slice. The remaining capabilities keep
 * their place in the contract but take `unknown` requests, because their request
 * and response types are not ported.
 */
export abstract class Provider {
  /** The name that appears in `unsupported_provider_action` failures. */
  abstract readonly providerName: string;

  text(_request: TextRequest): Promise<TextResponse> {
    throw PrismError.unsupportedProviderAction('text', this.providerName);
  }

  stream(_request: TextRequest): AsyncGenerator<StreamEvent> {
    throw PrismError.unsupportedProviderAction('stream', this.providerName);
  }

  structured(_request: StructuredRequest): Promise<StructuredResponse> {
    throw PrismError.unsupportedProviderAction('structured', this.providerName);
  }

  embeddings(_request: EmbeddingsRequest): Promise<EmbeddingsResponse> {
    throw PrismError.unsupportedProviderAction('embeddings', this.providerName);
  }

  images(_request: ImagesRequest): Promise<ImagesResponse> {
    throw PrismError.unsupportedProviderAction('images', this.providerName);
  }

  moderation(_request: ModerationRequest): Promise<ModerationResponse> {
    throw PrismError.unsupportedProviderAction('moderation', this.providerName);
  }

  textToSpeech(_request: TextToSpeechRequest): Promise<AudioResponse> {
    throw PrismError.unsupportedProviderAction('textToSpeech', this.providerName);
  }

  speechToText(_request: SpeechToTextRequest): Promise<AudioTextResponse> {
    throw PrismError.unsupportedProviderAction('speechToText', this.providerName);
  }

  fim(_request: unknown): never {
    throw PrismError.unsupportedProviderAction('fim', this.providerName);
  }

  batch(_request: unknown): never {
    throw PrismError.unsupportedProviderAction('batch', this.providerName);
  }

  uploadFile(_request: UploadFileRequest): Promise<FileData> {
    throw PrismError.unsupportedProviderAction('uploadFile', this.providerName);
  }

  listFiles(_request: ListFilesRequest): Promise<FileListResult> {
    throw PrismError.unsupportedProviderAction('listFiles', this.providerName);
  }

  getFileMetadata(_request: GetFileMetadataRequest): Promise<FileData> {
    throw PrismError.unsupportedProviderAction('getFileMetadata', this.providerName);
  }

  deleteFile(_request: DeleteFileRequest): Promise<DeleteFileResult> {
    throw PrismError.unsupportedProviderAction('deleteFile', this.providerName);
  }

  /** Bytes, not a string. See `FilesPendingRequest.download`. */
  downloadFile(_request: DownloadFileRequest): Promise<Uint8Array> {
    throw PrismError.unsupportedProviderAction('downloadFile', this.providerName);
  }
}
