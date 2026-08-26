// MCP server for prism.ts, over HTTP, with no dependencies.
//
// It implements exactly the three methods prism-mcp's client speaks in
// protocol 2026-07-28 — `server/discover`, `tools/list`, `tools/call`. That
// revision removed `initialize` and the session, so there is no handshake to
// implement and none is offered.
//
// Binds to loopback. An agent that can run this repo's test suite and spend
// tokens is remote code execution wearing a friendly name; it has no business
// being reachable from anywhere else.

import { createServer } from 'node:http';

import { LANGUAGE, tools } from './agent.mjs';

const PROTOCOL_VERSION = '2026-07-28';
const PORT = Number(process.env.PRISM_AGENT_PORT ?? 7411);
const HOST = '127.0.0.1';

/** JSON-RPC error codes, plus the one MCP adds for version refusal. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function definitions() {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

async function dispatch(method, params) {
  if (method === 'server/discover') {
    return {
      protocolVersion: PROTOCOL_VERSION,
      supportedVersions: [PROTOCOL_VERSION],
      capabilities: { tools: {} },
      serverInfo: { name: `prism.${LANGUAGE}`, version: '0.1.0' },
    };
  }

  if (method === 'tools/list') {
    // No pagination: five tools fit in one page and always will. `nextCursor`
    // is returned as null rather than omitted so a client paging generically
    // sees an explicit end.
    return { tools: definitions(), nextCursor: null };
  }

  if (method === 'tools/call') {
    const name = params?.name;
    const tool = Object.hasOwn(tools, name ?? '') ? tools[name] : undefined;

    if (!tool) {
      throw Object.assign(new Error(`unknown tool: ${name}`), { code: INVALID_PARAMS });
    }

    try {
      const result = await tool.handler(params?.arguments ?? {});

      return {
        // Structured AND text. The structured form is what a caller should
        // act on; the text form is what survives being pasted into a model
        // that only reads content parts.
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: false,
      };
    } catch (error) {
      // A tool that fails returns isError on the RESULT, not a JSON-RPC error.
      // The distinction matters: the call succeeded, the work did not.
      return {
        content: [{ type: 'text', text: String(error?.message ?? error) }],
        isError: true,
      };
    }
  }

  throw Object.assign(new Error(`unknown method: ${method}`), { code: METHOD_NOT_FOUND });
}

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'MCP-Protocol-Version': PROTOCOL_VERSION,
  });
  response.end(payload);
}

const server = createServer((request, response) => {
  if (request.method !== 'POST') {
    return send(response, 405, { jsonrpc: '2.0', id: null, error: { code: INVALID_REQUEST, message: 'POST only' } });
  }

  const chunks = [];
  let size = 0;

  request.on('data', chunk => {
    size += chunk.length;
    // A body cap, because an unbounded read is a memory exhaustion away from
    // taking the lane down.
    if (size > 8 * 1024 * 1024) {
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });

  request.on('end', async () => {
    let message;

    try {
      message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return send(response, 200, { jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'invalid JSON' } });
    }

    const id = message?.id ?? null;

    try {
      const result = await dispatch(message?.method, message?.params);
      send(response, 200, { jsonrpc: '2.0', id, result });
    } catch (error) {
      send(response, 200, {
        jsonrpc: '2.0',
        id,
        error: { code: error?.code ?? INTERNAL_ERROR, message: String(error?.message ?? error) },
      });
    }
  });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`prism.${LANGUAGE} listening on http://${HOST}:${PORT}/mcp (MCP ${PROTOCOL_VERSION})\n`);
});
