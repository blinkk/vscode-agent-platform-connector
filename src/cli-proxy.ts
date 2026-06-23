/**
 * cli-proxy.ts
 *
 * A tiny local HTTP proxy that lets GitHub Copilot CLI use the Claude models
 * served by Gemini Enterprise Agent Platform (formerly Vertex AI), using your
 * own gcloud credentials.
 *
 * Copilot CLI supports a "bring your own model provider" mode driven by
 * environment variables:
 *
 *   COPILOT_PROVIDER_TYPE=anthropic
 *   COPILOT_PROVIDER_BASE_URL=http://localhost:8787
 *   COPILOT_PROVIDER_API_KEY=<any non-empty placeholder>   # ignored here
 *   COPILOT_MODEL=claude-opus-4-8                           # a catalog id
 *
 * With `COPILOT_PROVIDER_TYPE=anthropic`, the CLI speaks the Anthropic Messages
 * wire format and POSTs to `<BASE_URL>/v1/messages`. This proxy:
 *
 *   1. accepts that Anthropic Messages request on localhost,
 *   2. converts it into the connector's normalized request shape,
 *   3. resolves the requested model to a Claude catalog entry,
 *   4. streams it through the existing Vertex client (which injects the gcloud
 *      bearer token + `x-goog-user-project` header), and
 *   5. re-emits the normalized stream back to the CLI as Anthropic SSE.
 *
 * Auth (gcloud), project, and locations all come from the same configuration
 * the VS Code extension uses (env vars / config file). This module has NO
 * dependency on `vscode`.
 *
 * SECURITY: the server binds to loopback only (127.0.0.1) by default. It never
 * trusts the inbound `COPILOT_PROVIDER_API_KEY`; the real upstream credential
 * is the gcloud token supplied inside `vertex.ts`.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { findModel, isClaudeModel, loadFileConfig } from './catalog.ts';
import type { ModelDef } from './catalog.ts';
import {
  config,
  getModels,
  log,
  setCustomModels,
  streamChat,
} from './vertex.ts';
import type {
  NormMessage,
  NormRequest,
  NormTool,
  NormToolCall,
  NormToolResult,
} from './vertex.ts';

/** Default loopback port; overridable via the GOOGLE_AGENT_PLATFORM_PROXY_PORT env var. */
const DEFAULT_PORT = 8787;
/** Bind to loopback only — this proxy must never be reachable off-host. */
const HOST = '127.0.0.1';
/** Cap inbound bodies to a sane size to avoid unbounded memory use. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* Inbound Anthropic Messages -> normalized request                          */
/* -------------------------------------------------------------------------- */

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}
interface AnthropicImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}
interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}
interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: unknown;
}
type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | Record<string, unknown>;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema?: object;
}

interface AnthropicMessagesRequest {
  model?: string;
  system?: string | Array<{ type: string; text?: string }>;
  messages?: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: { type?: string };
  max_tokens?: number;
  stream?: boolean;
}

/** Flatten an Anthropic system field (string or text blocks) into one string. */
function systemText(
  system: AnthropicMessagesRequest['system'],
): string | undefined {
  if (!system) return undefined;
  if (typeof system === 'string') return system || undefined;
  const text = system
    .map((b) => (b && b.type === 'text' ? (b.text ?? '') : ''))
    .filter(Boolean)
    .join('\n\n');
  return text || undefined;
}

/** Flatten an Anthropic tool_result content payload to plain text. */
function toolResultContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((piece) => {
        if (typeof piece === 'string') return piece;
        if (piece && typeof piece === 'object') {
          const p = piece as { type?: string; text?: string };
          if (p.type === 'text' && typeof p.text === 'string') return p.text;
          try {
            return JSON.stringify(piece);
          } catch {
            return '';
          }
        }
        return '';
      })
      .join('');
  }
  if (content && typeof content === 'object') {
    try {
      return JSON.stringify(content);
    } catch {
      return '';
    }
  }
  return content === undefined || content === null ? '' : String(content);
}

/** Convert one Anthropic message into zero or more normalized messages. */
function toNormMessages(req: AnthropicMessagesRequest): NormMessage[] {
  const out: NormMessage[] = [];

  const sys = systemText(req.system);
  if (sys) out.push({ role: 'system', text: sys });

  for (const msg of req.messages ?? []) {
    const role: NormMessage['role'] =
      msg.role === 'assistant' ? 'assistant' : 'user';

    if (typeof msg.content === 'string') {
      if (msg.content) out.push({ role, text: msg.content });
      continue;
    }

    let text = '';
    const images: NormMessage['images'] = [];
    const toolCalls: NormToolCall[] = [];
    const toolResults: NormToolResult[] = [];

    for (const block of msg.content ?? []) {
      const type = (block as { type?: string }).type;
      if (type === 'text') {
        text += (block as AnthropicTextBlock).text ?? '';
      } else if (type === 'image') {
        const src = (block as AnthropicImageBlock).source;
        if (src?.type === 'base64' && src.media_type && src.data) {
          images.push({ mimeType: src.media_type, data: src.data });
        }
      } else if (type === 'tool_use') {
        const b = block as AnthropicToolUseBlock;
        toolCalls.push({ id: b.id, name: b.name, input: b.input ?? {} });
      } else if (type === 'tool_result') {
        const b = block as AnthropicToolResultBlock;
        toolResults.push({
          callId: b.tool_use_id,
          content: toolResultContentText(b.content),
        });
      }
    }

    // tool_result blocks must travel as their own user-role turn to keep the
    // assistant tool_use -> user tool_result adjacency the upstream expects.
    if (toolResults.length) out.push({ role: 'user', toolResults });
    if (text || images.length || toolCalls.length) {
      out.push({
        role,
        text: text || undefined,
        images: images.length ? images : undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      });
    }
  }

  return out;
}

/** Convert the Anthropic tool list into the normalized tool shape. */
function toNormTools(
  req: AnthropicMessagesRequest,
): Pick<NormRequest, 'tools' | 'toolMode'> {
  const tools: NormTool[] | undefined = req.tools?.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.input_schema,
  }));
  const toolMode =
    req.tool_choice?.type === 'any' || req.tool_choice?.type === 'tool'
      ? ('required' as const)
      : ('auto' as const);
  return { tools, toolMode };
}

/**
 * Resolve the requested model id to a Claude catalog entry. Copilot CLI sends
 * whatever `COPILOT_MODEL` is set to; we accept any catalog id but require it to
 * be a Claude (`messages`) model, since this proxy only speaks Anthropic.
 */
function resolveClaudeModel(requested: string | undefined): ModelDef {
  const id = (requested || '').trim();
  if (!id) {
    throw new Error(
      'No model specified. Set COPILOT_MODEL to a Claude catalog id ' +
        `(e.g. ${claudeModelIds().join(', ') || 'claude-opus-4-8'}).`,
    );
  }
  const model = findModel(id, getModels());
  if (!model) {
    throw new Error(
      `Unknown model "${id}". Available Claude ids: ` +
        (claudeModelIds().join(', ') || '(none configured)'),
    );
  }
  if (model.api !== 'messages') {
    throw new Error(
      `Model "${id}" is not a Claude/Anthropic model. This proxy only serves ` +
        'the Anthropic wire format; use a Claude catalog id with ' +
        'COPILOT_PROVIDER_TYPE=anthropic.',
    );
  }
  return model;
}

/** The ids of all Claude (messages) models in the active catalog. */
function claudeModelIds(): string[] {
  return getModels()
    .filter((m: ModelDef) => m.api === 'messages' || isClaudeModel(m.id))
    .map((m: ModelDef) => m.id);
}

/* -------------------------------------------------------------------------- */
/* Outbound: normalized stream -> Anthropic SSE                              */
/* -------------------------------------------------------------------------- */

/** Write a single Anthropic SSE frame: an `event:` line plus a `data:` line. */
function writeSse(
  res: ServerResponse,
  event: string,
  data: unknown,
): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function randomMessageId(): string {
  return `msg_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Stream a normalized response back to the CLI as an Anthropic Messages SSE
 * sequence. The frame order mirrors the Anthropic streaming protocol so the
 * CLI's `anthropic` provider parses text and tool calls correctly:
 *
 *   message_start
 *   (content_block_start / *_delta / content_block_stop)*   per text/tool block
 *   message_delta (with stop_reason + usage)
 *   message_stop
 */
async function streamAnthropicResponse(
  res: ServerResponse,
  model: ModelDef,
  normReq: NormRequest,
  signal: AbortSignal,
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const messageId = randomMessageId();
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: 'end_turn' | 'tool_use' = 'end_turn';

  // Block bookkeeping: index 0 is reserved for streamed text (opened lazily on
  // the first text chunk); tool calls each get their own subsequent index.
  let nextIndex = 0;
  let textBlockIndex: number | null = null;

  writeSse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      model: model.id,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  const ensureTextBlock = (): number => {
    if (textBlockIndex === null) {
      textBlockIndex = nextIndex++;
      writeSse(res, 'content_block_start', {
        type: 'content_block_start',
        index: textBlockIndex,
        content_block: { type: 'text', text: '' },
      });
    }
    return textBlockIndex;
  };

  const closeTextBlock = (): void => {
    if (textBlockIndex !== null) {
      writeSse(res, 'content_block_stop', {
        type: 'content_block_stop',
        index: textBlockIndex,
      });
      textBlockIndex = null;
    }
  };

  try {
    for await (const evt of streamChat(model, normReq, signal)) {
      if (signal.aborted) break;
      if (evt.type === 'text') {
        const index = ensureTextBlock();
        writeSse(res, 'content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text: evt.text },
        });
      } else if (evt.type === 'usage') {
        inputTokens = evt.inputTokens;
        outputTokens = evt.outputTokens;
      } else {
        // A tool call: close any open text block, then emit a self-contained
        // tool_use block (start -> input_json_delta -> stop).
        closeTextBlock();
        stopReason = 'tool_use';
        const index = nextIndex++;
        writeSse(res, 'content_block_start', {
          type: 'content_block_start',
          index,
          content_block: {
            type: 'tool_use',
            id: evt.id,
            name: evt.name,
            input: {},
          },
        });
        writeSse(res, 'content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: {
            type: 'input_json_delta',
            partial_json: JSON.stringify(evt.input ?? {}),
          },
        });
        writeSse(res, 'content_block_stop', {
          type: 'content_block_stop',
          index,
        });
      }
    }

    closeTextBlock();

    writeSse(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    });
    writeSse(res, 'message_stop', { type: 'message_stop' });
    log(
      `[cli-proxy] response model=${model.id} stop=${stopReason} ` +
        `in_tokens=${inputTokens} out_tokens=${outputTokens}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`[cli-proxy] stream error: ${message}`);
    // If headers/frames are already sent, surface the error as an SSE error
    // event (the CLI shows it); otherwise fall through to the HTTP error path.
    writeSse(res, 'error', {
      type: 'error',
      error: { type: 'api_error', message },
    });
  } finally {
    res.end();
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP handling                                                              */
/* -------------------------------------------------------------------------- */

/** Read and JSON-parse the request body, enforcing the size cap. */
function readJsonBody(req: IncomingMessage): Promise<AnthropicMessagesRequest> {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(
          new Error(
            `invalid JSON body: ${e instanceof Error ? e.message : e}`,
          ),
        );
      }
    });
    req.on('error', reject);
  });
}

/** Send a JSON HTTP error in the Anthropic error envelope shape. */
function sendError(
  res: ServerResponse,
  status: number,
  message: string,
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      type: 'error',
      error: { type: status === 404 ? 'not_found_error' : 'invalid_request_error', message },
    }),
  );
}

async function handleMessages(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: AnthropicMessagesRequest;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : String(e));
    return;
  }

  let model: ModelDef;
  try {
    model = resolveClaudeModel(body.model);
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : String(e));
    return;
  }

  const normReq: NormRequest = {
    messages: toNormMessages(body),
    maxOutputTokens: body.max_tokens || model.maxOutputTokens,
    ...toNormTools(body),
  };

  log(
    `[cli-proxy] request model=${model.id} -> upstream=${model.upstream || model.id} ` +
      `messages=${normReq.messages.length} tools=${normReq.tools?.length ?? 0} ` +
      `stream=${body.stream !== false}`,
  );

  // Abort the upstream stream if the CLI disconnects mid-response.
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  // Non-streaming requests are uncommon from Copilot CLI (it requires
  // streaming), but if one arrives, we still stream upstream and aggregate.
  if (body.stream === false) {
    await respondNonStreaming(res, model, normReq, controller.signal);
    return;
  }

  await streamAnthropicResponse(res, model, normReq, controller.signal);
}

/** Aggregate a streamed response into a single Anthropic Messages JSON reply. */
async function respondNonStreaming(
  res: ServerResponse,
  model: ModelDef,
  normReq: NormRequest,
  signal: AbortSignal,
): Promise<void> {
  const content: Array<Record<string, unknown>> = [];
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: 'end_turn' | 'tool_use' = 'end_turn';

  try {
    for await (const evt of streamChat(model, normReq, signal)) {
      if (signal.aborted) break;
      if (evt.type === 'text') {
        text += evt.text;
      } else if (evt.type === 'usage') {
        inputTokens = evt.inputTokens;
        outputTokens = evt.outputTokens;
      } else {
        if (text) {
          content.push({ type: 'text', text });
          text = '';
        }
        stopReason = 'tool_use';
        content.push({
          type: 'tool_use',
          id: evt.id,
          name: evt.name,
          input: evt.input ?? {},
        });
      }
    }
    if (text) content.push({ type: 'text', text });
  } catch (e) {
    sendError(res, 502, e instanceof Error ? e.message : String(e));
    return;
  }

  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      id: randomMessageId(),
      type: 'message',
      role: 'assistant',
      model: model.id,
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }),
  );
}

/** Start the proxy HTTP server. Resolves once it is listening. */
export function startCliProxy(port = resolvePort()): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  // Honor any `customModels` defined in the connector config file so users can
  // expose distinctly-named aliases (e.g. one whose `upstream` points at a
  // built-in Claude model) to make it obvious in `/model` that a turn is being
  // served through this proxy rather than a coincidentally-named built-in.
  setCustomModels(loadFileConfig().customModels);

  const server = createServer((req, res) => {
    const url = req.url || '';
    const path = url.split('?')[0];

    if (req.method === 'GET' && (path === '/health' || path === '/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          project: config.project || null,
          authMode: config.authMode,
          models: claudeModelIds(),
        }),
      );
      return;
    }

    // The Anthropic provider POSTs to `<base>/v1/messages`.
    if (req.method === 'POST' && path.endsWith('/v1/messages')) {
      handleMessages(req, res).catch((e) => {
        log(`[cli-proxy] unhandled error: ${e instanceof Error ? e.message : e}`);
        sendError(res, 500, 'internal proxy error');
      });
      return;
    }

    sendError(res, 404, `no route for ${req.method} ${path}`);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.removeListener('error', reject);
      log(
        `[cli-proxy] listening on http://${HOST}:${port} ` +
          `(project ${config.project || '<unset>'}, auth ${config.authMode})`,
      );
      log(
        '[cli-proxy] point Copilot CLI at it with:\n' +
          `  export COPILOT_PROVIDER_TYPE=anthropic\n` +
          `  export COPILOT_PROVIDER_BASE_URL=http://${HOST}:${port}\n` +
          `  export COPILOT_PROVIDER_API_KEY=local-proxy\n` +
          `  export COPILOT_MODEL=${claudeModelIds()[0] || 'claude-opus-4-8'}`,
      );
      resolve({
        port,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
  });
}

/** Resolve the listen port from env, falling back to the default. */
function resolvePort(): number {
  const raw = process.env.GOOGLE_AGENT_PLATFORM_PROXY_PORT;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536
    ? parsed
    : DEFAULT_PORT;
}
