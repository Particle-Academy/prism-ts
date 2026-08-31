/**
 * Server-sent events, reassembled from whatever the network handed over.
 *
 * THE TRANSPORT YIELDS CHUNKS, NOT LINES, and this is where that costs
 * something and pays for itself. A chunk can end mid-line, mid-JSON, or mid
 * anything — providers do not align their writes to the reader's convenience —
 * so the buffer below is the whole point of the split. A transport that
 * promised lines would have to do this internally, where no test could split a
 * payload at an awkward place on purpose.
 *
 * Only `data:` lines are surfaced. SSE also carries `event:`, `id:` and
 * comments; neither provider this port speaks to uses them for anything the
 * payload does not already say, and inventing meaning for them would be
 * guessing at a protocol rather than reading it.
 */
export async function* sseData(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let buffer = '';

  for await (const chunk of chunks) {
    buffer += chunk;

    // `\n` rather than `\r\n`: the spec allows either, and splitting on the
    // longer one leaves a stray `\r` on every line from a server that uses it.
    let newline = buffer.indexOf('\n');

    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);

      const payload = dataPayload(line);

      if (payload !== null) {
        yield payload;
      }

      newline = buffer.indexOf('\n');
    }
  }

  // A final line with no trailing newline is still a line. Dropping it loses
  // the last event of any stream a server closes without one.
  const payload = dataPayload(buffer.replace(/\r$/, ''));

  if (payload !== null) {
    yield payload;
  }
}

function dataPayload(line: string): string | null {
  if (!line.startsWith('data:')) {
    return null;
  }

  // One optional space after the colon is part of the format, not content.
  const payload = line.slice(5).replace(/^ /, '');

  // `[DONE]` is OpenAI's sentinel, not JSON. Filtered here rather than left for
  // the caller to parse and fail on.
  return payload === '' || payload === '[DONE]' ? null : payload;
}
