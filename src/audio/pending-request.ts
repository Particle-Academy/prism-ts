import type { JsonObject } from '../json.js';
import { PrismError } from '../errors.js';
import type { Provider } from '../providers/provider.js';
import { resolveProvider } from '../providers/registry.js';
import { Audio } from '../value-objects/media/audio.js';
import { SpeechToTextRequest, TextToSpeechRequest } from './request.js';
import type { AudioResponse, AudioTextResponse } from './response.js';

/**
 * The builder for both audio directions.
 *
 * ONE builder with two terminals, matching the reference: `withInput()` takes
 * either a string to speak or an `Audio` to transcribe, and the terminal method
 * decides which request is built. The alternative — two builders — would force
 * a caller to know the direction before they have the input, which is backwards
 * from how audio work actually arrives.
 */
export class AudioPendingRequest {
  #provider: Provider | null = null;

  #providerKey = '';

  #model = '';

  #input: string | Audio | null = null;

  #voice: string | null = null;

  #providerOptions: JsonObject = {};

  #clientOptions: Record<string, unknown> = {};

  using(provider: string, model = '', providerConfig: Record<string, unknown> = {}): this {
    this.#providerKey = provider;
    this.#model = model;
    this.#provider = resolveProvider(provider, providerConfig);

    return this;
  }

  /** A string to speak, or an `Audio` to transcribe. */
  withInput(input: string | Audio): this {
    this.#input = input;

    return this;
  }

  withVoice(voice: string): this {
    this.#voice = voice;

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

  /**
   * @throws PrismError code `wrong_audio_input` when the input is an `Audio`.
   *
   * Refused rather than coerced. There is no sensible reading of "speak this
   * recording", and the alternative — stringifying it — would send a provider
   * something like `[object Object]` to read aloud.
   */
  toTextToSpeechRequest(): TextToSpeechRequest {
    if (typeof this.#input !== 'string') {
      throw PrismError.wrongAudioInput('text to speak', 'an audio payload');
    }

    return new TextToSpeechRequest({
      model: this.#model,
      providerKey: this.#providerKey,
      input: this.#input,
      voice: this.#voice,
      clientOptions: this.#clientOptions,
      providerOptions: this.#providerOptions,
    });
  }

  /** @throws PrismError code `wrong_audio_input` when the input is a string. */
  toSpeechToTextRequest(): SpeechToTextRequest {
    if (!(this.#input instanceof Audio)) {
      throw PrismError.wrongAudioInput('an audio payload', 'text');
    }

    return new SpeechToTextRequest({
      model: this.#model,
      providerKey: this.#providerKey,
      input: this.#input,
      clientOptions: this.#clientOptions,
      providerOptions: this.#providerOptions,
    });
  }

  async asAudio(): Promise<AudioResponse> {
    return this.provider().textToSpeech(this.toTextToSpeechRequest());
  }

  async asText(): Promise<AudioTextResponse> {
    return this.provider().speechToText(this.toSpeechToTextRequest());
  }
}
