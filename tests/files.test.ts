import { describe, expect, it } from 'vitest';
import { Prism, PrismError, parseFileData } from '../src/index.js';
import type { HttpBinaryResponse, HttpBinaryTransport, HttpRequest, MultipartBody } from '../src/index.js';

type Recorded = HttpRequest & { multipart?: MultipartBody };

function transportFor(
  bytes: Uint8Array,
  status = 200,
): { transport: HttpBinaryTransport; calls: Recorded[] } {
  const calls: Recorded[] = [];

  const transport: HttpBinaryTransport = (request) => {
    calls.push(request);

    return Promise.resolve({ status, headers: {}, bytes } as HttpBinaryResponse);
  };

  return { transport, calls };
}

const json = (value: unknown): Uint8Array => new Uint8Array(Buffer.from(JSON.stringify(value)));

const FILE = {
  id: 'file-abc',
  object: 'file',
  bytes: 1234,
  created_at: 1735689600,
  filename: 'notes.pdf',
  purpose: 'assistants',
};

const files = (transport: HttpBinaryTransport) =>
  Prism.files().using('openai', { apiKey: 'sk-test', binaryTransport: transport });

describe('upload', () => {
  it('posts the bytes as multipart and returns the file', async () => {
    const { transport, calls } = transportFor(json(FILE));

    const file = await files(transport).upload(new Uint8Array(Buffer.from('%PDF-1.4')), 'notes.pdf');

    expect(calls[0]?.url).toContain('/files');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.multipart?.files[0]?.filename).toBe('notes.pdf');
    expect(file.id).toBe('file-abc');
    expect(file.sizeBytes).toBe(1234);
  });

  it('defaults the purpose, because OpenAI requires one and has no default', async () => {
    // `assistants` accepts the widest set of file types, so it is the choice
    // that fails least often for a caller who did not know they had to make it.
    const { transport, calls } = transportFor(json(FILE));

    await files(transport).upload(new Uint8Array([1]), 'a.txt');

    expect(calls[0]?.multipart?.fields.purpose).toBe('assistants');
  });

  it('keeps a purpose the caller chose', async () => {
    const { transport, calls } = transportFor(json(FILE));

    await Prism.files()
      .using('openai', { apiKey: 'sk-test', binaryTransport: transport })
      .withProviderOptions({ purpose: 'batch' })
      .upload(new Uint8Array([1]), 'a.jsonl');

    expect(calls[0]?.multipart?.fields.purpose).toBe('batch');
  });
});

describe('list', () => {
  it('sends only the pagination fields that were set', async () => {
    const { transport, calls } = transportFor(json({ data: [FILE], has_more: false, first_id: 'file-abc' }));

    const result = await files(transport).list(10, 'file-zzz');

    expect(calls[0]?.url).toContain('limit=10');
    expect(calls[0]?.url).toContain('after=file-zzz');
    expect(result.data).toHaveLength(1);
    expect(result.hasMore).toBe(false);
    expect(result.firstId).toBe('file-abc');
  });

  it('drops beforeId, because OpenAI has no such parameter', async () => {
    // Sending it would be ignored silently, which reads to a caller like a
    // working backwards page.
    const { transport, calls } = transportFor(json({ data: [] }));

    await files(transport).list(null, null, 'file-aaa');

    expect(calls[0]?.url).not.toContain('before');
    expect(calls[0]?.url).toMatch(/\/files$/);
  });
});

describe('metadata, delete and download', () => {
  it('reads one file by id', async () => {
    const { transport, calls } = transportFor(json(FILE));

    const file = await files(transport).getMetadata('file-abc');

    expect(calls[0]?.url).toContain('/files/file-abc');
    expect(file.filename).toBe('notes.pdf');
  });

  it('reports what the provider said about the delete, not the status code', async () => {
    // OpenAI answers 200 with `deleted: false` for a file it declined to
    // remove, and treating 200 as the verdict reports a success that did not
    // happen.
    const { transport } = transportFor(json({ id: 'file-abc', object: 'file', deleted: false }));

    const result = await files(transport).delete('file-abc');

    expect(result.deleted).toBe(false);
    expect(result.id).toBe('file-abc');
  });

  it('returns download content as bytes, not a decoded string', async () => {
    // A PDF decoded as text is corrupt, and the caller has no way to tell.
    const { transport, calls } = transportFor(new Uint8Array([0x25, 0x50, 0x44, 0x46]));

    const bytes = await files(transport).download('file-abc');

    expect(calls[0]?.url).toContain('/files/file-abc/content');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('escapes a file id rather than pasting it into the path', async () => {
    const { transport, calls } = transportFor(json(FILE));

    await files(transport).getMetadata('a/../b');

    expect(calls[0]?.url).toContain('a%2F..%2Fb');
  });
});

describe('failures', () => {
  it('raises on an HTTP error', async () => {
    const { transport } = transportFor(json({ error: { message: 'no such file' } }), 404);

    await expect(files(transport).getMetadata('file-nope')).rejects.toThrowError(PrismError);
  });

  it('raises when the provider reports an error inside a 200', async () => {
    // The files endpoints do this, so the status alone is not the verdict.
    const { transport } = transportFor(json({ error: { type: 'invalid_request_error', message: 'bad purpose' } }));

    await expect(files(transport).upload(new Uint8Array([1]), 'a.txt')).rejects.toThrowError(/bad purpose/);
  });
});

describe('parsing', () => {
  it('renders created_at as ISO 8601 in UTC', () => {
    // The reference uses PHP `date('c')`, which renders in the server's local
    // zone, so the same file reports a different creation time on two machines.
    expect(parseFileData(FILE).createdAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('leaves mimeType null, because OpenAI never reports one', () => {
    // The field exists because the reference has it; empty is not a parse bug.
    expect(parseFileData(FILE).mimeType).toBeNull();
  });

  it('survives a response that is not an object', () => {
    expect(parseFileData(null).id).toBe('');
  });
});
