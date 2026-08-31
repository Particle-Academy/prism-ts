import { describe, expect, it } from 'vitest';
import { Audio, Prism, PrismError } from '../src/index.js';
import type { HttpBinaryResponse, HttpBinaryTransport, HttpRequest, MultipartBody } from '../src/index.js';

type Recorded = HttpRequest & { multipart?: MultipartBody };

function binaryTransport(
  bytes: Uint8Array,
  status = 200,
  headers: Record<string, string> = {},
): { transport: HttpBinaryTransport; calls: Recorded[] } {
  const calls: Recorded[] = [];

  const transport: HttpBinaryTransport = (request) => {
    calls.push(request);

    return Promise.resolve({ status, headers, bytes } as HttpBinaryResponse);
  };

  return { transport, calls };
}

const json = (value: unknown): Uint8Array => new Uint8Array(Buffer.from(JSON.stringify(value)));

describe('text to speech', () => {
  it('posts the text and returns the bytes as audio', async () => {
    const { transport, calls } = binaryTransport(new Uint8Array(Buffer.from('MP3BYTES')), 200, {
      'content-type': 'audio/mpeg',
    });

    const response = await Prism.audio()
      .using('openai', 'gpt-4o-mini-tts', { apiKey: 'sk-test', binaryTransport: transport })
      .withInput('hello there')
      .withVoice('nova')
      .asAudio();

    expect(calls[0]?.url).toContain('/audio/speech');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      model: 'gpt-4o-mini-tts',
      input: 'hello there',
      voice: 'nova',
    });
    expect(response.audio.base64()).toBe(Buffer.from('MP3BYTES').toString('base64'));
    expect(response.audio.mimeType()).toBe('audio/mpeg');
  });

  it('defaults the voice, because the endpoint requires one', async () => {
    // Omitting it fails the call, so a default beats a provider error naming a
    // field the caller never saw.
    const { transport, calls } = binaryTransport(new Uint8Array(Buffer.from('x')));

    await Prism.audio()
      .using('openai', 'gpt-4o-mini-tts', { apiKey: 'sk-test', binaryTransport: transport })
      .withInput('hi')
      .asAudio();

    expect(JSON.parse(calls[0]?.body ?? '{}').voice).toBe('alloy');
  });

  it('labels the audio with the format that was ASKED for', async () => {
    // The bytes carry no field naming the format, so guessing mp3 would
    // mislabel every caller who asked for wav.
    const { transport } = binaryTransport(new Uint8Array(Buffer.from('x')));

    const response = await Prism.audio()
      .using('openai', 'gpt-4o-mini-tts', { apiKey: 'sk-test', binaryTransport: transport })
      .withInput('hi')
      .withProviderOptions({ response_format: 'wav' })
      .asAudio();

    expect(response.audio.type).toBe('wav');
  });

  it('reads the provider message out of an error body that is JSON, not audio', async () => {
    const { transport } = binaryTransport(json({ error: { message: 'no such voice' } }), 400);

    await expect(
      Prism.audio()
        .using('openai', 'gpt-4o-mini-tts', { apiKey: 'sk-test', binaryTransport: transport })
        .withInput('hi')
        .asAudio(),
    ).rejects.toThrowError(/no such voice/);
  });

  it('refuses to speak an audio payload', () => {
    // There is no sensible reading of "speak this recording", and stringifying
    // it would send `[object Object]` to be read aloud.
    expect(() =>
      Prism.audio()
        .using('openai', 'gpt-4o-mini-tts', { apiKey: 'sk-test' })
        .withInput(Audio.fromBase64('aGk='))
        .toTextToSpeechRequest(),
    ).toThrowError(PrismError);
  });
});

describe('speech to text', () => {
  it('uploads the audio as multipart and returns the transcript', async () => {
    const { transport, calls } = binaryTransport(json({ text: 'hello there' }));

    const response = await Prism.audio()
      .using('openai', 'whisper-1', { apiKey: 'sk-test', binaryTransport: transport })
      .withInput(Audio.fromBase64(Buffer.from('WAVBYTES').toString('base64'), 'audio/wav'))
      .asText();

    const form = calls[0]?.multipart;

    expect(calls[0]?.url).toContain('/audio/transcriptions');
    expect(form?.fields.model).toBe('whisper-1');
    expect(form?.files[0]?.field).toBe('file');
    // OpenAI infers the format from the extension, so an unnamed part is
    // rejected as an unsupported format rather than as a missing name.
    expect(form?.files[0]?.filename).toBe('audio.wav');
    expect(response.text).toBe('hello there');
  });

  it('keeps a filename the caller chose', async () => {
    const { transport, calls } = binaryTransport(json({ text: 'x' }));

    await Prism.audio()
      .using('openai', 'whisper-1', { apiKey: 'sk-test', binaryTransport: transport })
      .withInput(Audio.fromBase64('aGk=', 'audio/mpeg').as('interview.mp3'))
      .asText();

    expect(calls[0]?.multipart?.files[0]?.filename).toBe('interview.mp3');
  });

  it('refuses an input with no bytes rather than posting an empty file', () => {
    // A url payload is not fetched implicitly, so it has nothing to upload. An
    // empty file comes back as a transcript of silence.
    expect(() =>
      Prism.audio()
        .using('openai', 'whisper-1', { apiKey: 'sk-test' })
        .withInput(Audio.fromUrl('https://example.test/a.mp3'))
        .toSpeechToTextRequest(),
    ).not.toThrow();

    expect(() =>
      Prism.audio()
        .using('openai', 'whisper-1', { apiKey: 'sk-test' })
        .withInput(Audio.fromUrl('https://example.test/a.mp3'))
        .asText(),
    ).rejects.toThrowError(PrismError);
  });

  it('reports no usage as null rather than zero tokens', async () => {
    // Transcription is billed by audio duration on most providers and they
    // report no tokens at all; zero would claim it was free.
    const { transport } = binaryTransport(json({ text: 'x' }));

    const response = await Prism.audio()
      .using('openai', 'whisper-1', { apiKey: 'sk-test', binaryTransport: transport })
      .withInput(Audio.fromBase64('aGk=', 'audio/wav'))
      .asText();

    expect(response.usage).toBeNull();
  });

  it('refuses to transcribe a string', () => {
    expect(() =>
      Prism.audio().using('openai', 'whisper-1', { apiKey: 'sk-test' }).withInput('hi').toSpeechToTextRequest(),
    ).toThrowError(PrismError);
  });
});
