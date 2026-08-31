import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Audio, GeneratedImage, Image, PrismError, guessMimeType } from '../src/index.js';

function tempFile(name: string, contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'prism-media-')), name);
  writeFileSync(path, contents);

  return path;
}

describe('media', () => {
  it('reads a local file and derives its mime type from the extension', () => {
    const path = tempFile('note.txt', 'hello');
    const media = Image.fromLocalPath(path);

    expect(media.isFile()).toBe(true);
    expect(media.mimeType()).toBe('text/plain');
    expect(media.base64()).toBe(Buffer.from('hello').toString('base64'));
  });

  it('refuses an empty file, naming the path', () => {
    // A zero-byte upload is almost always a mistake upstream, and a provider's
    // error for it is far less useful than one naming the path.
    const path = tempFile('empty.png', '');

    expect(() => Image.fromLocalPath(path)).toThrowError(/empty\.png/);
  });

  it('refuses a path that does not exist', () => {
    expect(() => Image.fromLocalPath('nope/missing.png')).toThrowError(PrismError);
  });

  it('NEVER fetches a url just because something read it', async () => {
    // The reference reads url content on demand inside rawContent(), so
    // touching a property performs an outbound request. A stored locator
    // becoming a request the moment something replays it is the hazard.
    const media = Image.fromUrl('https://example.test/cat.png');

    expect(media.isUrl()).toBe(true);
    expect(media.rawContent()).toBeNull();
    expect(media.base64()).toBeNull();
  });

  it('decodes base64 into raw content without a network call', () => {
    const media = Image.fromBase64(Buffer.from('bytes').toString('base64'), 'image/png');

    expect(media.rawContent()).toEqual(new Uint8Array(Buffer.from('bytes')));
    expect(media.mimeType()).toBe('image/png');
  });

  it('carries a provider-side file id without any content', () => {
    const media = Audio.fromFileId('file_123');

    expect(media.isFileId()).toBe(true);
    expect(media.fileId()).toBe('file_123');
    expect(media.hasBase64()).toBe(false);
  });

  it('names a payload for providers that want a filename', () => {
    expect(Audio.fromBase64('aGk=').as('clip.mp3').filename()).toBe('clip.mp3');
  });

  it('returns null for an unknown extension rather than a plausible default', () => {
    // `application/octet-stream` would be accepted by a provider and then
    // rejected as the wrong kind of file — a worse failure than being asked.
    expect(guessMimeType('thing.qqq')).toBeNull();
    expect(guessMimeType('clip.mp3')).toBe('audio/mpeg');
  });

  it('gives GeneratedImage the media surface as well as its revised prompt', () => {
    // The move under Media is the point: a generated image is a file, and now
    // it answers the same questions every other file does.
    const image = new GeneratedImage(null, 'aGk=', 'a cat, photographic');

    expect(image).toBeInstanceOf(Image);
    expect(image.hasBase64()).toBe(true);
    expect(image.hasRevisedPrompt()).toBe(true);
    expect(image.toObject().revised_prompt).toBe('a cat, photographic');
  });
});
