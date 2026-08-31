import { describe, expect, it } from 'vitest';
import {
  BatchRequestItem,
  BatchResultStatus,
  BatchStatus,
  Prism,
  PrismError,
  parseBatchJob,
  parseBatchResults,
} from '../src/index.js';
import type { HttpBinaryResponse, HttpBinaryTransport, HttpRequest, MultipartBody } from '../src/index.js';

type Recorded = HttpRequest & { multipart?: MultipartBody };

/** Answers each call in turn, so a two-hop operation can be driven end to end. */
function scriptedTransport(responses: (Uint8Array | { bytes: Uint8Array; status: number })[]): {
  transport: HttpBinaryTransport;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  let index = 0;

  const transport: HttpBinaryTransport = (request) => {
    calls.push(request);
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    const resolved = next instanceof Uint8Array ? { bytes: next, status: 200 } : (next ?? { bytes: json({}), status: 200 });

    return Promise.resolve({ status: resolved.status, headers: {}, bytes: resolved.bytes } as HttpBinaryResponse);
  };

  return { transport, calls };
}

const json = (value: unknown): Uint8Array => new Uint8Array(Buffer.from(JSON.stringify(value)));
const text = (value: string): Uint8Array => new Uint8Array(Buffer.from(value));

const JOB = {
  id: 'batch_1',
  status: 'in_progress',
  request_counts: { total: 10, completed: 4, failed: 1 },
  created_at: 1735689600,
  input_file_id: 'file-in',
};

const batch = (transport: HttpBinaryTransport) =>
  Prism.batch().using('openai', { apiKey: 'sk-test', binaryTransport: transport });

describe('create', () => {
  it('uploads the items as JSONL and then creates the batch', async () => {
    const { transport, calls } = scriptedTransport([json({ id: 'file-in' }), json(JOB)]);

    const item = new BatchRequestItem(
      'row-1',
      Prism.text().using('openai', 'gpt-4o').withPrompt('Who?').toRequest(),
    );

    const job = await batch(transport).create([item]);

    // Two hops: the file, then the batch that points at it.
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain('/files');
    expect(calls[0]?.multipart?.fields.purpose).toBe('batch');

    const jsonl = Buffer.from(calls[0]?.multipart?.files[0]?.bytes ?? new Uint8Array()).toString('utf8');
    const line = JSON.parse(jsonl) as { custom_id: string; url: string; body: { model: string } };

    expect(line.custom_id).toBe('row-1');
    expect(line.url).toBe('/v1/responses');
    expect(line.body.model).toBe('gpt-4o');

    expect(calls[1]?.url).toContain('/batches');
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({
      input_file_id: 'file-in',
      endpoint: '/v1/responses',
      completion_window: '24h',
    });
    expect(job.id).toBe('batch_1');
  });

  it('skips the upload when an input file id was given', async () => {
    const { transport, calls } = scriptedTransport([json(JOB)]);

    await batch(transport).create(null, 'file-already-there');

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.body ?? '{}').input_file_id).toBe('file-already-there');
  });

  it('refuses both an input file id and items', async () => {
    // They are alternatives, and sending both would mean silently ignoring one.
    const { transport } = scriptedTransport([json(JOB)]);
    const item = new BatchRequestItem('a', Prism.text().using('openai', 'gpt-4o').withPrompt('x').toRequest());

    await expect(batch(transport).create([item], 'file-x')).rejects.toThrowError(/not both/);
  });

  it('refuses neither', async () => {
    const { transport } = scriptedTransport([json(JOB)]);

    await expect(batch(transport).create()).rejects.toThrowError(PrismError);
  });
});

describe('retrieve, list and cancel', () => {
  it('derives the in-flight count OpenAI does not report', async () => {
    const { transport } = scriptedTransport([json(JOB)]);

    const job = await batch(transport).retrieve('batch_1');

    expect(job.requestCounts.total).toBe(10);
    expect(job.requestCounts.succeeded).toBe(4);
    expect(job.requestCounts.failed).toBe(1);
    expect(job.requestCounts.processing).toBe(5);
  });

  it('never reports a negative in-flight count', () => {
    // A partial response — total missing while completed is not — would produce
    // one, and a negative number of in-flight requests is not a state anything
    // can be in.
    const job = parseBatchJob({ id: 'b', status: 'completed', request_counts: { completed: 5 } });

    expect(job.requestCounts.processing).toBe(0);
  });

  it('refuses a status it does not recognise', () => {
    // Quietly calling it in-progress would leave a caller waiting forever on a
    // batch that had already stopped.
    expect(() => parseBatchJob({ id: 'b', status: 'reticulating' })).toThrowError(/reticulating/);
  });

  it('lists with only the parameters that were set', async () => {
    const { transport, calls } = scriptedTransport([json({ data: [JOB], has_more: true, last_id: 'batch_1' })]);

    const result = await batch(transport).list(5);

    expect(calls[0]?.url).toContain('limit=5');
    expect(calls[0]?.url).not.toContain('after');
    expect(result.data[0]?.status).toBe(BatchStatus.InProgress);
    expect(result.hasMore).toBe(true);
    expect(result.lastId).toBe('batch_1');
  });

  it('cancels by posting to the cancel path', async () => {
    const { transport, calls } = scriptedTransport([json({ ...JOB, status: 'cancelling' })]);

    const job = await batch(transport).cancel('batch_1');

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toContain('/batches/batch_1/cancel');
    expect(job.status).toBe(BatchStatus.Cancelling);
  });
});

describe('results', () => {
  it('reads BOTH the output and the error file', async () => {
    // A batch where some requests succeeded and others failed writes to both,
    // and reading only the output file reports a clean run.
    const { transport, calls } = scriptedTransport([
      json({ ...JOB, status: 'completed', output_file_id: 'file-out', error_file_id: 'file-err' }),
      text(
        JSON.stringify({
          custom_id: 'row-1',
          response: { body: { id: 'resp_1', model: 'gpt-4o', output: [{ type: 'message', content: [{ type: 'output_text', text: 'hello' }] }] } },
        }),
      ),
      text(JSON.stringify({ custom_id: 'row-2', error: { code: 'invalid_request', message: 'bad' } })),
    ]);

    const results = await batch(transport).getResults('batch_1');

    expect(calls).toHaveLength(3);
    expect(calls[1]?.url).toContain('/files/file-out/content');
    expect(calls[2]?.url).toContain('/files/file-err/content');
    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe(BatchResultStatus.Succeeded);
    expect(results[0]?.text).toBe('hello');
    expect(results[1]?.status).toBe(BatchResultStatus.Errored);
    expect(results[1]?.errorMessage).toBe('bad');
  });

  it('returns nothing for a batch that has not written a file yet', async () => {
    // Nothing went wrong; there is just nothing yet.
    const { transport } = scriptedTransport([json(JOB)]);

    expect(await batch(transport).getResults('batch_1')).toEqual([]);
  });

  it('calls an expired item expired, not errored', () => {
    // The request was never run, so reporting it as a failure blames the
    // request for something the queue did.
    const [item] = parseBatchResults(
      JSON.stringify({ custom_id: 'row-1', error: { code: 'batch_expired', message: 'too late' } }),
    );

    expect(item?.status).toBe(BatchResultStatus.Expired);
  });

  it('skips a line that will not parse rather than losing the file', () => {
    const body = ['{"custom_id":"a","response":{"body":{}}}', 'not json at all', '', '{"custom_id":"b","response":{"body":{}}}'].join('\n');

    expect(parseBatchResults(body).map((item) => item.customId)).toEqual(['a', 'b']);
  });

  it('takes the LAST message from a responses output, not the first', () => {
    // A turn that used tools has the message last; taking the first returns
    // whatever preceded the tool call.
    const [item] = parseBatchResults(
      JSON.stringify({
        custom_id: 'a',
        response: {
          body: {
            output: [
              { type: 'message', content: [{ type: 'output_text', text: 'thinking out loud' }] },
              { type: 'message', content: [{ type: 'output_text', text: 'the answer' }] },
            ],
          },
        },
      }),
    );

    expect(item?.text).toBe('the answer');
  });

  it('reads the chat-completions shape too', () => {
    const [item] = parseBatchResults(
      JSON.stringify({ custom_id: 'a', response: { body: { choices: [{ message: { content: 'hi' } }] } } }),
    );

    expect(item?.text).toBe('hi');
  });

  it('puts cached tokens in the cache-READ slot', () => {
    // They are billed differently from cache writes, and the wrong slot
    // misreports the cost in the direction that flatters it.
    const [item] = parseBatchResults(
      JSON.stringify({
        custom_id: 'a',
        response: {
          body: {
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              input_tokens_details: { cached_tokens: 80 },
              output_tokens_details: { reasoning_tokens: 5 },
            },
          },
        },
      }),
    );

    expect(item?.usage?.cacheReadInputTokens).toBe(80);
    expect(item?.usage?.cacheWriteInputTokens).toBeNull();
    expect(item?.usage?.thoughtTokens).toBe(5);
  });
});
