import { describe, expect, it } from 'vitest';
import { Prism, Tool } from '../src/index.js';
import type { HttpResponse, HttpTransport } from '../src/index.js';

const TOOL_CALL_BODY = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-5',
  content: [{ type: 'tool_use', id: 'toolu_1', name: 'delete_file', input: { path: 'a.txt' } }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 10, output_tokens: 2 },
};

describe('tool calls in core', () => {
  it('has no approval check that could fail open', () => {
    // If one is added, its failure behaviour needs its own test here.
    expect('requiresApproval' in Tool.prototype).toBe(false);
    expect('needsApproval' in Tool.prototype).toBe(false);
  });

  it('refuses a model tool call without running the handler', async () => {
    let ran = 0;
    const transport: HttpTransport = () => Promise.resolve({
      status: 200,
      headers: {},
      body: TOOL_CALL_BODY,
      rawBody: JSON.stringify(TOOL_CALL_BODY),
    } as HttpResponse);

    const request = Prism.text()
      .using('anthropic', 'claude-sonnet-4-5', { apiKey: 'sk-test', url: 'https://api.example.test/v1', transport })
      .withTools([new Tool().as('delete_file').for('Delete a file').withStringParameter('path', 'Path').using(() => { ran += 1; return 'deleted'; })])
      .withPrompt('Delete a.txt.')
      .withMaxTokens(64)
      .asText();

    await expect(request).rejects.toThrow('does not run the tool-execution loop');
    expect(ran).toBe(0);
  });
});
