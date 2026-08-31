import { isJsonObject, type JsonObject } from '../../json.js';
import { PrismError } from '../../errors.js';
import type { SpeechToTextRequest, TextToSpeechRequest } from '../../audio/request.js';
import { AudioResponse, AudioTextResponse } from '../../audio/response.js';
import { GeneratedAudio } from '../../value-objects/generated-audio.js';
import { Usage } from '../../value-objects/usage.js';
import type { MultipartBody } from '../../http/transport.js';
import { whereNotNull } from '../../internal/filters.js';

export function buildSpeechBody(request: TextToSpeechRequest): JsonObject {
  return {
    model: request.model(),
    input: request.input(),
    // `alloy` is OpenAI's own default and the endpoint REQUIRES a voice, so
    // omitting it fails the call. Defaulted here rather than in the builder, so
    // a provider that has different voices can choose its own.
    voice: request.voice() ?? 'alloy',
    ...whereNotNull({
      response_format: request.providerOptions('response_format'),
      speed: request.providerOptions('speed'),
      instructions: request.providerOptions('instructions'),
    }),
  };
}

/**
 * Speech comes back as BYTES, not JSON.
 *
 * So the format has to come from the request or the content type — the payload
 * itself carries no field naming it, and guessing `mp3` would mislabel every
 * caller who asked for `wav`.
 */
export function parseSpeechResponse(
  bytes: Uint8Array,
  contentType: string | null,
  request: TextToSpeechRequest,
): AudioResponse {
  const format = request.providerOptions('response_format');
  const type = typeof format === 'string' ? format : 'mp3';

  return new AudioResponse(
    new GeneratedAudio(Buffer.from(bytes).toString('base64'), type, contentType ?? `audio/${type}`),
  );
}

export function buildTranscriptionForm(request: SpeechToTextRequest): MultipartBody {
  const audio = request.input();
  const bytes = audio.rawContent();

  if (bytes === null) {
    // The payload holds only a url, and this port does not fetch implicitly.
    throw PrismError.noAudioContent();
  }

  const mimeType = audio.mimeType();

  return {
    fields: {
      model: request.model(),
      ...stringFields({
        language: request.providerOptions('language'),
        prompt: request.providerOptions('prompt'),
        response_format: request.providerOptions('response_format'),
        temperature: request.providerOptions('temperature'),
      }),
    },
    files: [
      {
        field: 'file',
        // A filename is REQUIRED: OpenAI infers the audio format from the
        // extension, and an unnamed part is rejected as an unsupported format
        // rather than as a missing name.
        filename: audio.filename() ?? `audio.${extensionFor(mimeType)}`,
        bytes,
        // The key is OMITTED rather than set to undefined: this tsconfig runs
        // exactOptionalPropertyTypes, where an explicit undefined is a
        // different thing from an absent key — and the transport reads absence.
        ...(mimeType === null ? {} : { contentType: mimeType }),
      },
    ],
  };
}

export function parseTranscriptionResponse(rawBody: unknown): AudioTextResponse {
  if (!isJsonObject(rawBody)) {
    throw PrismError.providerResponseError('OpenAI returned an empty or non-object transcription response.');
  }

  const usage = isJsonObject(rawBody.usage) ? rawBody.usage : null;

  return new AudioTextResponse(
    typeof rawBody.text === 'string' ? rawBody.text : '',
    // Null, not zero. Transcription is billed by audio duration on most
    // providers and they report no tokens at all; zero would claim it was free.
    usage === null
      ? null
      : new Usage(readNumber(usage.input_tokens ?? usage.prompt_tokens), readNumber(usage.output_tokens)),
    rawBody,
  );
}

function stringFields(source: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (value !== null && value !== undefined) {
      // Multipart carries strings; a number field has to be spelled out rather
      // than left for the form encoder to stringify however it likes.
      fields[key] = String(value);
    }
  }

  return fields;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
};

function extensionFor(mimeType: string | null): string {
  return mimeType === null ? 'mp3' : (EXTENSIONS[mimeType] ?? 'mp3');
}

function readNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
