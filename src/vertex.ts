/**
 * vertex.ts
 *
 * Dependency-free Vertex AI client for the Blinkk Agent Platform Chat Connector
 * connector.
 *
 * Unlike the old local HTTP proxy, this module talks to Vertex AI *directly*
 * from inside the VS Code extension host (via the native Language Model Chat
 * Provider API). It:
 *
 *   - obtains a Google access token from `gcloud` (ADC or the connector's
 *     isolated credential store), cached and auto-refreshed;
 *   - converts a normalized chat request into the right upstream shape
 *     (OpenAI Chat Completions for Gemini, Anthropic Messages for Claude);
 *   - streams the response back as normalized {text | tool-call} events by
 *     parsing each provider's SSE format.
 *
 * It has NO dependency on `vscode` — the extension does the VS Code <-> normal
 * conversion and feeds plain data in/out — and no third-party dependencies.
 *
 * Configuration (env overrides VS Code settings override
 * ~/.config/blinkk-vscode-google-agent-platform-connector/config.json):
 *   GOOGLE_AGENT_PLATFORM_PROJECT          GCP project to bill (required; no default)
 *   GOOGLE_AGENT_PLATFORM_GEMINI_LOCATION  default: global
 *   GOOGLE_AGENT_PLATFORM_CLAUDE_LOCATION  default: global
 *   GOOGLE_AGENT_PLATFORM_AUTH_MODE        'adc' (default) | 'isolated'
 *   GOOGLE_AGENT_PLATFORM_AUTH_ACCOUNT     optional account to pin
 *   GOOGLE_AGENT_PLATFORM_DEBUG=1          verbose logging
 */

import {spawn} from 'node:child_process';
import fs from 'node:fs';

import {
  DEFAULTS,
  ISOLATED_GCLOUD_DIR,
  anthropicUrl,
  chatCompletionsUrl,
  isClaudeModel,
  loadFileConfig,
  modelGardenUrl,
  normalizeCustomModel,
  resolveModels,
  upstreamModelId,
} from './catalog.ts';
import type {AuthMode, ConnectorConfig, ModelDef} from './catalog.ts';

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

const fileConfig = loadFileConfig();

export type ResolvedConfig = Required<
  Pick<
    ConnectorConfig,
    | 'project'
    | 'geminiLocation'
    | 'claudeLocation'
    | 'debug'
    | 'authMode'
    | 'authAccount'
  >
>;

/**
 * Fields whose value came from an environment variable. Env vars are an
 * explicit, process-level escape hatch, so they win over VS Code settings
 * applied later via {@link applyConfigOverrides}.
 */
const envLocked = new Set<keyof ResolvedConfig>();
function fromEnv<K extends keyof ResolvedConfig>(
  key: K,
  value: string | undefined,
): string | undefined {
  if (value) envLocked.add(key);
  return value;
}

export const config: ResolvedConfig = {
  project:
    fromEnv('project', process.env.GOOGLE_AGENT_PLATFORM_PROJECT) ||
    fileConfig.project ||
    DEFAULTS.project,
  geminiLocation:
    fromEnv(
      'geminiLocation',
      process.env.GOOGLE_AGENT_PLATFORM_GEMINI_LOCATION,
    ) ||
    fileConfig.geminiLocation ||
    DEFAULTS.geminiLocation,
  claudeLocation:
    fromEnv(
      'claudeLocation',
      process.env.GOOGLE_AGENT_PLATFORM_CLAUDE_LOCATION,
    ) ||
    fileConfig.claudeLocation ||
    DEFAULTS.claudeLocation,
  debug:
    process.env.GOOGLE_AGENT_PLATFORM_DEBUG === '1' ||
    Boolean(fileConfig.debug),
  authMode:
    (fromEnv('authMode', process.env.GOOGLE_AGENT_PLATFORM_AUTH_MODE) as
      | AuthMode
      | undefined) ||
    fileConfig.authMode ||
    'adc',
  authAccount:
    fromEnv('authAccount', process.env.GOOGLE_AGENT_PLATFORM_AUTH_ACCOUNT) ||
    fileConfig.authAccount ||
    '',
};

if (process.env.GOOGLE_AGENT_PLATFORM_DEBUG === '1') envLocked.add('debug');

/**
 * The effective model list: built-in defaults merged with any user-supplied
 * custom models. Rebuilt by {@link setCustomModels}; read via {@link getModels}.
 */
let activeModels: ModelDef[] = resolveModels();

/** The current effective model list (defaults + validated custom models). */
export function getModels(): readonly ModelDef[] {
  return activeModels;
}

/**
 * Validate and apply a list of raw custom-model definitions (e.g. from the
 * `customModels` VS Code setting). Invalid entries are skipped with a logged,
 * actionable warning so one typo never hides the working defaults. The built-in
 * defaults always remain available unless a custom entry overrides one by id.
 */
export function setCustomModels(raw: unknown): void {
  const valid: ModelDef[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      try {
        valid.push(normalizeCustomModel(entry));
      } catch (e) {
        log(
          `ignoring invalid custom model: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
  } else if (raw !== null && raw !== undefined) {
    log('"customModels" must be an array; ignoring it');
  }
  activeModels = resolveModels(valid);
}

/**
 * Apply overrides (e.g. from VS Code settings) onto the live config. Only
 * non-empty values are applied, and never for fields locked by an env var.
 * Returns true if any auth-affecting field changed (so callers can drop any
 * cached access token).
 */
export function applyConfigOverrides(
  overrides: Partial<ResolvedConfig>,
): boolean {
  let authChanged = false;
  const assign = <K extends keyof ResolvedConfig>(
    key: K,
    value: ResolvedConfig[K] | undefined | '',
  ): void => {
    if (value === undefined || value === '' || envLocked.has(key)) return;
    if (config[key] === value) return;
    config[key] = value as ResolvedConfig[K];
    if (key === 'authMode' || key === 'authAccount') authChanged = true;
  };
  assign('project', overrides.project);
  assign('geminiLocation', overrides.geminiLocation);
  assign('claudeLocation', overrides.claudeLocation);
  assign('authMode', overrides.authMode);
  assign('authAccount', overrides.authAccount);
  if (typeof overrides.debug === 'boolean' && !envLocked.has('debug')) {
    config.debug = overrides.debug;
  }
  if (authChanged) tokenCache = {value: '', expiresAt: 0};
  return authChanged;
}

/**
 * Optional log sinks. Embedders (e.g. the VS Code extension) can push a
 * listener here to mirror connector logs into their own output channel.
 */
export const logListeners: Array<(line: string) => void> = [];

export const log = (...args: unknown[]) => {
  const line = `[google-agent-platform ${new Date().toISOString()}] ${args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}`;
  console.error(line);
  for (const listener of logListeners) {
    try {
      listener(line);
    } catch {
      /* never let a listener break logging */
    }
  }
};
const debug = (...args: unknown[]) => {
  if (config.debug) log('debug', ...args);
};

/* -------------------------------------------------------------------------- */
/* Access token                                                               */
/* -------------------------------------------------------------------------- */

let tokenCache = {value: '', expiresAt: 0};

/**
 * Build the `gcloud` argv + environment for the active auth mode.
 *   - 'adc':      the user's global Application Default Credentials.
 *   - 'isolated': the connector's own credential store (CLOUDSDK_CONFIG).
 */
function gcloudTokenInvocation(): {args: string[]; env: NodeJS.ProcessEnv} {
  const account = config.authAccount ? [`--account=${config.authAccount}`] : [];
  if (config.authMode === 'isolated') {
    return {
      args: ['auth', 'print-access-token', ...account],
      env: {...process.env, CLOUDSDK_CONFIG: ISOLATED_GCLOUD_DIR},
    };
  }
  return {
    args: ['auth', 'application-default', 'print-access-token', ...account],
    env: process.env,
  };
}

function fetchAccessToken(): Promise<string> {
  const {args, env} = gcloudTokenInvocation();
  return new Promise((resolve, reject) => {
    const child = spawn('gcloud', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && out.trim()) {
        resolve(out.trim());
      } else {
        const hint =
          config.authMode === 'isolated'
            ? ' (run the "Sign In (isolated credentials)" command to populate isolated credentials)'
            : ' (run `gcloud auth application-default login`)';
        reject(
          new Error(
            `gcloud print-access-token failed (exit ${code}): ${
              err.trim() || 'no output'
            }${hint}`,
          ),
        );
      }
    });
  });
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && tokenCache.value && now < tokenCache.expiresAt) {
    return tokenCache.value;
  }
  const value = await fetchAccessToken();
  // ADC access tokens last ~60 min; refresh proactively at 50 min.
  tokenCache = {value, expiresAt: now + 50 * 60 * 1000};
  debug('refreshed access token');
  return value;
}

function locationFor(model: ModelDef): string {
  return model.api === 'messages'
    ? config.claudeLocation
    : config.geminiLocation;
}

/* -------------------------------------------------------------------------- */
/* Normalized request/response types                                          */
/* -------------------------------------------------------------------------- */

export interface NormToolCall {
  id: string;
  name: string;
  input: unknown;
  /**
   * Gemini 3+ thought signature for this call (OpenAI-compat:
   * `extra_content.google.thought_signature`). Must be echoed back on the next
   * turn or the request fails with a 400. Usually unavailable after VS Code's
   * tool-call part round-trip, in which case a validator-skip sentinel is sent.
   */
  signature?: string;
}

export interface NormToolResult {
  callId: string;
  content: string;
}

export interface NormImage {
  /** Image MIME type, e.g. `image/png`. */
  mimeType: string;
  /** Base64-encoded image bytes (no data: prefix). */
  data: string;
}

export interface NormMessage {
  role: 'system' | 'user' | 'assistant';
  /** Plain text content (concatenated). */
  text?: string;
  /** Image attachments (carried on a user-role message). */
  images?: NormImage[];
  /** Assistant tool-call requests. */
  toolCalls?: NormToolCall[];
  /** Tool results to feed back (carried on a user-role message). */
  toolResults?: NormToolResult[];
}

export interface NormTool {
  name: string;
  description: string;
  inputSchema?: object;
}

export interface NormRequest {
  messages: NormMessage[];
  tools?: NormTool[];
  toolMode?: 'auto' | 'required';
  maxOutputTokens?: number;
  /** Provider-specific overrides merged into the upstream body. */
  modelOptions?: Record<string, unknown>;
}

/** A normalized streaming event emitted while a response is produced. */
export type StreamEvent =
  | {type: 'text'; text: string}
  | {
      type: 'tool-call';
      id: string;
      name: string;
      input: unknown;
      signature?: string;
    }
  | {type: 'usage'; inputTokens: number; outputTokens: number};

/* -------------------------------------------------------------------------- */
/* Upstream body construction                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Documented sentinel that tells Gemini 3+ to skip thought-signature validation
 * for a function-call part that has no real signature (e.g. one whose signature
 * was lost crossing VS Code's tool-call round-trip). See
 * https://ai.google.dev/gemini-api/docs/thought-signatures (FAQ).
 */
const SKIP_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

/** Build an OpenAI Chat Completions body for a Gemini model. */
export function buildGeminiBody(model: ModelDef, req: NormRequest): unknown {
  const messages: Array<Record<string, unknown>> = [];
  for (const m of req.messages) {
    if (m.toolResults?.length) {
      for (const r of m.toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: r.callId,
          content: r.content,
        });
      }
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      messages.push({
        role: 'assistant',
        content: m.text || '',
        tool_calls: m.toolCalls.map((t) => ({
          id: t.id,
          type: 'function',
          function: {name: t.name, arguments: JSON.stringify(t.input ?? {})},
          // Gemini 3+ requires the thought signature echoed back on every
          // function call of the current turn, or it returns a 400. The real
          // signature is lost across VS Code's tool-call round-trip, so fall
          // back to the documented validator-skip sentinel when absent.
          extra_content: {
            google: {
              thought_signature: t.signature || SKIP_THOUGHT_SIGNATURE,
            },
          },
        })),
      });
    } else if (m.images?.length) {
      const parts: Array<Record<string, unknown>> = [];
      if (m.text) parts.push({type: 'text', text: m.text});
      for (const img of m.images) {
        parts.push({
          type: 'image_url',
          image_url: {url: `data:${img.mimeType};base64,${img.data}`},
        });
      }
      messages.push({role: m.role, content: parts});
    } else if (m.text !== undefined && m.text !== '') {
      messages.push({role: m.role, content: m.text});
    } else if (!m.toolResults?.length) {
      messages.push({role: m.role, content: ''});
    }
  }

  const body: Record<string, unknown> = {
    model: upstreamModelId(model),
    messages,
    stream: true,
    stream_options: {include_usage: true},
    max_tokens: req.maxOutputTokens || model.maxOutputTokens,
  };
  if (model.thinking) {
    body.reasoning_effort = model.thinking.effort || 'high';
  }
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema || {type: 'object', properties: {}},
      },
    }));
    body.tool_choice = req.toolMode === 'required' ? 'required' : 'auto';
  }
  return {...body, ...req.modelOptions};
}

/**
 * Anthropic applies a *stricter* per-image dimension limit (the "many-image
 * requests" cap, e.g. 2576px on the long edge) once a single request carries
 * more than this many image (and document) blocks. Below the threshold Claude
 * silently downscales oversized images; at or above it, oversized images are
 * rejected with an `invalid_request_error`. Because the rejected image stays in
 * the conversation history, every subsequent turn re-sends it and fails too,
 * leaving the conversation in an unrecoverable state.
 *
 * See https://docs.anthropic.com/en/docs/build-with-claude/vision ("General
 * limits").
 */
const CLAUDE_MANY_IMAGE_THRESHOLD = 20;

/**
 * Keep a Claude request below the many-image threshold so its normal automatic
 * downscaling applies (instead of hard-rejecting oversized images). When the
 * request carries more than {@link CLAUDE_MANY_IMAGE_THRESHOLD} images, retain
 * the most recent ones as real image blocks and replace older ones with a short
 * text placeholder. Returns the same request when no pruning is needed.
 */
export function pruneClaudeImages(req: NormRequest): NormRequest {
  let total = 0;
  for (const m of req.messages) total += m.images?.length ?? 0;
  if (total <= CLAUDE_MANY_IMAGE_THRESHOLD) return req;

  // Walk newest-to-oldest, keeping the most recent images as real blocks and
  // dropping the rest (replaced with a placeholder on their message).
  let kept = 0;
  let dropped = 0;
  const messages = [...req.messages]
    .reverse()
    .map((m) => {
      if (!m.images?.length) return m;
      const room = CLAUDE_MANY_IMAGE_THRESHOLD - kept;
      if (room <= 0) {
        dropped += m.images.length;
        return stripImages(m, m.images.length);
      }
      if (m.images.length <= room) {
        kept += m.images.length;
        return m;
      }
      // Partially keep: this message straddles the threshold. Keep the most
      // recent images within the message (the tail of the array).
      const keepCount = room;
      const dropCount = m.images.length - keepCount;
      kept += keepCount;
      dropped += dropCount;
      return {...m, images: m.images.slice(dropCount)};
    })
    .reverse();

  log(
    `claude many-image safeguard: kept ${kept} most recent image(s), ` +
      `replaced ${dropped} older image(s) with a placeholder ` +
      `(threshold ${CLAUDE_MANY_IMAGE_THRESHOLD})`,
  );
  return {...req, messages};
}

/** Drop `count` images from a message, appending a placeholder note. */
function stripImages(m: NormMessage, count: number): NormMessage {
  const note =
    count === 1
      ? '[1 earlier image omitted to stay within image limits]'
      : `[${count} earlier images omitted to stay within image limits]`;
  const text = m.text ? `${m.text}\n\n${note}` : note;
  const rest = {...m};
  delete rest.images;
  return {...rest, text};
}

/** Build an Anthropic Messages body for a Claude model. */
function buildClaudeBody(model: ModelDef, req: NormRequest): unknown {
  let system = '';
  const messages: Array<Record<string, unknown>> = [];

  for (const m of req.messages) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + (m.text || '');
      continue;
    }
    if (m.toolResults?.length) {
      messages.push({
        role: 'user',
        content: m.toolResults.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.callId,
          content: r.content,
        })),
      });
      continue;
    }
    const content: Array<Record<string, unknown>> = [];
    if (m.text) content.push({type: 'text', text: m.text});
    if (m.images?.length) {
      for (const img of m.images) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mimeType,
            data: img.data,
          },
        });
      }
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      for (const t of m.toolCalls) {
        content.push({
          type: 'tool_use',
          id: t.id,
          name: t.name,
          input: t.input ?? {},
        });
      }
    }
    if (content.length) messages.push({role: m.role, content});
  }

  const body: Record<string, unknown> = {
    anthropic_version: 'vertex-2023-10-16',
    messages,
    stream: true,
    max_tokens: req.maxOutputTokens || model.maxOutputTokens,
  };
  if (system) body.system = system;
  if (model.thinking) {
    body.thinking = {type: 'adaptive'};
    body.output_config = {effort: model.thinking.effort || 'high'};
  }
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema || {type: 'object', properties: {}},
    }));
    body.tool_choice =
      req.toolMode === 'required' ? {type: 'any'} : {type: 'auto'};
  }
  return {...body, ...req.modelOptions};
}

/* -------------------------------------------------------------------------- */
/* SSE plumbing                                                               */
/* -------------------------------------------------------------------------- */

/** Yield raw `data:` payload strings from a fetch Response SSE body. */
async function* sseData(
  res: Response,
  signal?: AbortSignal,
): AsyncIterable<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (signal?.aborted) return;
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      let nl: number;
      // SSE frames are separated by blank lines; lines start with "data:".
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data:')) {
          yield line.slice(5).trim();
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

/** Parse JSON, returning `{}` on any error (for partial/best-effort args). */
function safeJsonParse(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Throw a clear error if no GCP project has been configured. */
function requireProject(): void {
  if (!config.project) {
    throw new Error(
      'No GCP project configured. Set "blinkkAgentPlatformConnector.project" ' +
        'in VS Code settings, the GOOGLE_AGENT_PLATFORM_PROJECT env var, or ' +
        '"project" in the connector config file.',
    );
  }
}

async function postVertex(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  requireProject();
  const doFetch = (token: string) =>
    fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-goog-user-project': config.project,
      },
      body: JSON.stringify(body),
      signal,
    });

  let token = await getAccessToken();
  let res = await doFetch(token);
  if (res.status === 401) {
    debug('upstream 401, refreshing token and retrying once');
    token = await getAccessToken(true);
    res = await doFetch(token);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const message = explainHttpError(res.status, res.statusText, text);
    const overflow = parseContextOverflow(res.status, text);
    if (overflow) throw new ContextOverflowError(message, overflow);
    throw new Error(message);
  }
  return res;
}

/** Details parsed from a context-window-overflow error, when recognizable. */
export interface ContextOverflow {
  /** Actual prompt token count reported by the upstream, if present. */
  actual?: number;
  /** The model's token limit reported by the upstream, if present. */
  limit?: number;
}

/**
 * Recognize a 400 caused by exceeding the model's context window and, when
 * possible, extract the actual/limit token counts the upstream reported. Returns
 * undefined when the body is not a context-overflow error. Matches both Gemini's
 * and Claude-on-Vertex's phrasings (e.g. "prompt is too long", "input token
 * count", "conversation is too long ... context window").
 */
export function parseContextOverflow(
  status: number,
  body: string,
): ContextOverflow | undefined {
  if (status !== 400) return undefined;
  const isOverflow =
    /prompt is too long|conversation is too long|context window|maximum.*tokens|token.*maximum|exceeds the maximum number of tokens|input token count/i.test(
      body,
    );
  if (!isOverflow) return undefined;
  // Match both phrasings: "N tokens > M maximum" (Claude) and
  // "N > M tokens" (the "conversation is too long ... (a > b tokens)" form).
  // The word "tokens"/"maximum" may appear after either number.
  const counts = body.match(
    /(\d[\d,]{3,})(?:\s*tokens?)?\s*>\s*(\d[\d,]{3,})/i,
  );
  if (!counts) {
    const single = body.match(/(\d[\d,]{3,})\s*tokens?/i);
    return {limit: single ? toInt(single[1]) : undefined};
  }
  return {actual: toInt(counts[1]), limit: toInt(counts[2])};
}

/** Parse a possibly comma-grouped integer string ("1,010,342" -> 1010342). */
function toInt(s: string): number {
  return parseInt(s.replace(/,/g, ''), 10);
}

/**
 * Thrown for a 400 that means the request exceeded the model's context window.
 * Carries the actual/limit token counts (when the upstream reported them) so the
 * caller can trim more aggressively and retry instead of failing the turn.
 */
export class ContextOverflowError extends Error {
  readonly actual?: number;
  readonly limit?: number;
  constructor(message: string, info: ContextOverflow) {
    super(message);
    this.name = 'ContextOverflowError';
    this.actual = info.actual;
    this.limit = info.limit;
  }
}

/**
 * Turn a raw Vertex HTTP error into a message that tells the user how to fix it.
 * Status codes from Vertex map to a small set of common, recoverable problems.
 */
export function explainHttpError(
  status: number,
  statusText: string,
  body: string,
): string {
  const detail = body.slice(0, 400).replace(/\s+/g, ' ').trim();
  const project = config.project;

  // A 400 caused by exceeding the model's context window is common and has
  // nothing to do with project/location/model config, so give it a dedicated,
  // actionable message instead of the generic "check your settings" hint.
  const overflow = parseContextOverflow(status, body);
  if (overflow) {
    const over =
      overflow.actual && overflow.limit
        ? ` (${overflow.actual} > ${overflow.limit} tokens)`
        : '';
    return (
      `Vertex ${status} ${statusText}: The conversation is too long for this ` +
      `model's context window${over}. Start a new chat, remove large files or ` +
      'tool results from the context, or switch to a model with a larger ' +
      'context window.'
    );
  }

  let hint: string;
  switch (status) {
    case 401:
      hint =
        config.authMode === 'isolated'
          ? 'Authentication failed. Run the "Sign In (isolated credentials)" ' +
            "command to refresh the connector's gcloud credentials."
          : 'Authentication failed. Re-run `gcloud auth application-default ' +
            'login` (or use the "Sign In" command), then try again.';
      break;
    case 403:
      hint =
        `Permission denied for project "${project}". Make sure (1) the Vertex ` +
        'AI API is enabled, (2) your account has the "Vertex AI User" role, and ' +
        '(3) the model is enabled in Model Garden: ' +
        modelGardenUrl(project);
      break;
    case 404:
      hint =
        'Model not found. The model may not be enabled in this project, or the ' +
        'location/id is wrong. Enable it in Model Garden, then retry: ' +
        modelGardenUrl(project);
      break;
    case 429:
      hint =
        'Rate limited / quota exceeded for this project. Wait and retry, or ' +
        'request more Vertex AI quota in the Google Cloud console.';
      break;
    default:
      hint =
        status >= 500
          ? 'Vertex AI returned a server error. This is usually transient — ' +
            'wait a moment and try again.'
          : 'Check your project, location, and model settings, then try again.';
  }
  return `Vertex ${status} ${statusText}: ${hint}${detail ? ` (details: ${detail})` : ''}`;
}

/* -------------------------------------------------------------------------- */
/* Streaming                                                                  */
/* -------------------------------------------------------------------------- */

/** POST a Gemini (OpenAI Chat Completions) request and return the open stream. */
function postGemini(
  model: ModelDef,
  req: NormRequest,
  signal?: AbortSignal,
): Promise<Response> {
  const url = chatCompletionsUrl(config.project, locationFor(model));
  return postVertex(url, buildGeminiBody(model, req), signal);
}

/** Parse a Gemini (OpenAI Chat Completions) response stream as events. */
async function* parseGemini(
  res: Response,
  signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
  // Tool calls arrive as deltas keyed by index; accumulate name + arguments
  // (plus the Gemini thought signature, when present on the first FC part).
  const toolAcc = new Map<
    number,
    {id: string; name: string; args: string; signature?: string}
  >();

  for await (const data of sseData(res, signal)) {
    if (data === '[DONE]') break;
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    // The final chunk (stream_options.include_usage) carries token totals.
    if (json?.usage) {
      yield {
        type: 'usage',
        inputTokens: json.usage.prompt_tokens || 0,
        outputTokens: json.usage.completion_tokens || 0,
      };
    }
    const delta = json?.choices?.[0]?.delta;
    if (!delta) continue;
    if (typeof delta.content === 'string' && delta.content) {
      yield {type: 'text', text: delta.content};
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const acc = toolAcc.get(idx) || {id: '', name: '', args: ''};
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        if (tc.function?.arguments) acc.args += tc.function.arguments;
        const sig = tc.extra_content?.google?.thought_signature;
        if (sig) acc.signature = sig;
        toolAcc.set(idx, acc);
      }
    }
  }

  for (const acc of toolAcc.values()) {
    if (!acc.name) continue;
    yield {
      type: 'tool-call',
      id: acc.id || `call_${acc.name}_${Math.random().toString(36).slice(2)}`,
      name: acc.name,
      input: safeJsonParse(acc.args),
      signature: acc.signature,
    };
  }
}

/** POST a Claude (Anthropic Messages) request and return the open stream. */
function postClaude(
  model: ModelDef,
  req: NormRequest,
  signal?: AbortSignal,
): Promise<Response> {
  const upstream = upstreamModelId(model).replace(/^anthropic\//, '');
  const url = anthropicUrl(
    config.project,
    config.claudeLocation,
    upstream,
    true,
  );
  return postVertex(url, buildClaudeBody(model, req), signal);
}

/** Parse a Claude (Anthropic Messages) response stream as events. */
async function* parseClaude(
  res: Response,
  signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
  // Track the current content block so input_json_delta can be accumulated.
  const blocks = new Map<
    number,
    {type: string; id?: string; name?: string; json: string}
  >();
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const data of sseData(res, signal)) {
    let evt: any;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }
    switch (evt?.type) {
      case 'message_start': {
        const u = evt.message?.usage || {};
        inputTokens = u.input_tokens || 0;
        outputTokens = u.output_tokens || 0;
        break;
      }
      case 'message_delta': {
        const delta = evt.usage?.output_tokens;
        if (typeof delta === 'number') {
          outputTokens = delta;
        }
        break;
      }
      case 'content_block_start': {
        const cb = evt.content_block || {};
        blocks.set(evt.index, {
          type: cb.type,
          id: cb.id,
          name: cb.name,
          json: '',
        });
        break;
      }
      case 'content_block_delta': {
        const d = evt.delta || {};
        if (d.type === 'text_delta' && d.text) {
          yield {type: 'text', text: d.text};
        } else if (d.type === 'input_json_delta') {
          const b = blocks.get(evt.index);
          if (b) b.json += d.partial_json || '';
        }
        break;
      }
      case 'content_block_stop': {
        const b = blocks.get(evt.index);
        if (b && b.type === 'tool_use' && b.name) {
          yield {
            type: 'tool-call',
            id: b.id || `call_${b.name}`,
            name: b.name,
            input: safeJsonParse(b.json),
          };
        }
        break;
      }
      default:
        break;
    }
  }

  if (inputTokens || outputTokens) {
    yield {type: 'usage', inputTokens, outputTokens};
  }
}

/** Stream a normalized chat request against the given model. */
/* -------------------------------------------------------------------------- */
/* Context-window safeguard                                                    */
/* -------------------------------------------------------------------------- */

/** Rough chars-per-token heuristic; must mirror the extension's estimator. */
const CHARS_PER_TOKEN = 4;
/** Fixed overhead added per message for role/structure framing. */
const PER_MESSAGE_TOKENS = 4;
/** Conservative per-image token cost (matches the picker-side estimate). */
const IMAGE_MIN_TOKENS = 256;
const IMAGE_MAX_TOKENS = 4096;

function estimateImageTokens(img: NormImage): number {
  // `data` is base64 of the raw bytes; recover the byte count.
  const rawBytes = Math.floor((img.data?.length ?? 0) * 3) / 4;
  const est = Math.ceil(rawBytes / 750);
  return Math.min(IMAGE_MAX_TOKENS, Math.max(IMAGE_MIN_TOKENS, est));
}

/** Estimate the token cost of a single normalized message. */
function estimateMessageTokens(m: NormMessage): number {
  let chars = (m.text ?? '').length;
  for (const tc of m.toolCalls ?? []) {
    chars += (tc.name ?? '').length;
    try {
      chars += JSON.stringify(tc.input ?? '').length;
    } catch {
      /* ignore non-serializable input */
    }
  }
  for (const tr of m.toolResults ?? []) {
    chars += (tr.content ?? '').length;
  }
  let tokens = Math.ceil(chars / CHARS_PER_TOKEN) + PER_MESSAGE_TOKENS;
  for (const img of m.images ?? []) tokens += estimateImageTokens(img);
  return tokens;
}

/** Estimate the total input-token cost of a normalized request. */
export function estimateRequestTokens(req: NormRequest): number {
  let total = 0;
  for (const m of req.messages) total += estimateMessageTokens(m);
  for (const t of req.tools ?? []) {
    let chars = (t.name ?? '').length + (t.description ?? '').length;
    try {
      chars += JSON.stringify(t.inputSchema ?? '').length;
    } catch {
      /* ignore */
    }
    total += Math.ceil(chars / CHARS_PER_TOKEN);
  }
  return total;
}

/**
 * Drop the oldest non-system messages until the estimated input fits inside the
 * model's context window (reserving room for the response). This is a last-line
 * safeguard so a runaway conversation degrades gracefully instead of failing
 * with an upstream 400; VS Code's own summarization should normally kick in
 * first. System messages and the final user turn are always preserved.
 *
 * Returns the request to send (the same object when no trim was needed).
 */
export function fitRequestToContext(
  model: ModelDef,
  req: NormRequest,
  budgetOverride?: number,
): NormRequest {
  const limit = model.maxInputTokens;
  if (!limit || !Number.isFinite(limit)) return req;

  // Reserve headroom for the response plus heuristic slack (our estimator is
  // approximate, so leave a margin below the hard upstream cap).
  const reserve = Math.min(
    limit - 1,
    (model.maxOutputTokens ?? 4096) + Math.ceil(limit * 0.05),
  );
  const budget =
    budgetOverride !== undefined
      ? Math.max(1, budgetOverride)
      : Math.max(1, limit - reserve);

  let total = estimateRequestTokens(req);
  if (total <= budget) return req;

  const messages = [...req.messages];
  // Indices we must never drop: all system messages and the final message.
  const lastIdx = messages.length - 1;
  const protectedIdx = new Set<number>([lastIdx]);
  messages.forEach((m, i) => {
    if (m.role === 'system') protectedIdx.add(i);
  });

  // Walk from oldest to newest, removing droppable messages until we fit.
  let removed = 0;
  for (let i = 0; i < messages.length && total > budget; i++) {
    if (protectedIdx.has(i)) continue;
    if (!messages[i]) continue;
    total -= estimateMessageTokens(messages[i]);
    // Tombstone; filtered out below to keep indices stable during the loop.
    (messages as Array<NormMessage | null>)[i] = null;
    removed++;
  }

  if (removed === 0) return req;

  const trimmed = (messages as Array<NormMessage | null>).filter(
    (m): m is NormMessage => m !== null,
  );
  log(
    `context safeguard: trimmed ${removed} oldest message(s); ` +
      `~${total} est tokens <= ${budget} budget (limit ${limit})`,
  );
  return {...req, messages: trimmed};
}

/** Max number of trim-and-retry attempts after a context-overflow 400. */
const MAX_OVERFLOW_RETRIES = 3;

/**
 * Given a context-overflow error the upstream reported, compute a new estimator
 * budget that should bring the *next* request under the real limit. Our
 * char-based estimate can undershoot the true token count, so scale our current
 * estimate by the observed ratio (real/estimated) and subtract the overage, then
 * apply a safety margin. Falls back to a fraction of the previous budget when
 * the upstream did not include usable numbers.
 */
function nextBudgetAfterOverflow(
  err: ContextOverflowError,
  prevBudget: number,
  prevEstimate: number,
): number {
  if (err.actual && err.limit && prevEstimate > 0) {
    // How much our estimate undershot reality, so we can deflate accordingly.
    const ratio = err.actual / prevEstimate;
    const targetReal = err.limit;
    // Estimator-space budget that maps to ~90% of the real limit.
    const scaled = Math.floor((targetReal * 0.9) / Math.max(ratio, 1));
    return Math.max(1, Math.min(prevBudget - 1, scaled));
  }
  // No numbers: shrink the budget by 25% each attempt.
  return Math.max(1, Math.floor(prevBudget * 0.75));
}

/**
 * Stream a normalized chat request, trimming and retrying when the upstream
 * rejects it for exceeding the model's context window. The pre-flight
 * `fitRequestToContext` estimate can undershoot the true token count; on a
 * context-overflow 400 we re-trim using the actual counts the upstream reported
 * and retry, so a long session degrades gracefully instead of failing the turn.
 */
export async function* streamChat(
  model: ModelDef,
  req: NormRequest,
  signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
  const limit = model.maxInputTokens;
  const reserve = limit
    ? Math.min(
        limit - 1,
        (model.maxOutputTokens ?? 4096) + Math.ceil(limit * 0.05),
      )
    : 0;
  let budget = limit ? Math.max(1, limit - reserve) : undefined;

  for (let attempt = 0; ; attempt++) {
    const fitted = fitRequestToContext(model, req, budget);
    const estimate = estimateRequestTokens(fitted);
    const prepared =
      model.api === 'messages' ? pruneClaudeImages(fitted) : fitted;

    // Only the POST (which surfaces the overflow 400 before any tokens stream)
    // is retried; once parsing begins we are committed to that response.
    let res: Response;
    try {
      res =
        model.api === 'messages'
          ? await postClaude(model, prepared, signal)
          : await postGemini(model, prepared, signal);
    } catch (err) {
      if (
        err instanceof ContextOverflowError &&
        attempt < MAX_OVERFLOW_RETRIES &&
        !signal?.aborted
      ) {
        const prev = budget ?? estimate;
        budget = nextBudgetAfterOverflow(err, prev, estimate);
        log(
          `context overflow (attempt ${attempt + 1}/${MAX_OVERFLOW_RETRIES}): ` +
            `upstream reported ${err.actual ?? '?'} > ${err.limit ?? '?'} ` +
            `tokens; retrying with tighter budget ~${budget}`,
        );
        continue;
      }
      throw err;
    }

    yield* model.api === 'messages'
      ? parseClaude(res, signal)
      : parseGemini(res, signal);
    return;
  }
}

/* -------------------------------------------------------------------------- */
/* CLI helpers                                                                */
/* -------------------------------------------------------------------------- */

/** Probe each distinct model against Vertex and log the HTTP status. */
export async function runCheck(): Promise<void> {
  requireProject();
  log(
    `project=${config.project} gemini=${config.geminiLocation} ` +
      `claude=${config.claudeLocation} auth=${config.authMode}`,
  );
  const token = await getAccessToken();
  log('access token OK');

  const seen = new Set<string>();
  for (const m of getModels()) {
    const key = upstreamModelId(m);
    if (seen.has(key)) continue;
    seen.add(key);

    const isClaude = isClaudeModel(m.id);
    const upstream = key.replace(/^anthropic\//, '');
    const location = isClaude ? config.claudeLocation : config.geminiLocation;
    const url = isClaude
      ? anthropicUrl(config.project, location, upstream, false)
      : chatCompletionsUrl(config.project, location);
    const body = isClaude
      ? {
          anthropic_version: 'vertex-2023-10-16',
          messages: [{role: 'user', content: 'ping'}],
          max_tokens: 8,
        }
      : {
          model: upstream,
          messages: [{role: 'user', content: 'ping'}],
          max_tokens: 8,
        };
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-goog-user-project': config.project,
      },
      body: JSON.stringify(body),
    });
    log(`probe ${m.id} (${location}): HTTP ${r.status}`);
    if (r.status !== 200) {
      const text = await r.text();
      log(`  ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
    }
  }
}

/**
 * Populate the connector's isolated credential store (authMode === 'isolated').
 * Runs an interactive `gcloud auth login` into a private CLOUDSDK_CONFIG dir, so
 * the connector's identity is independent of the user's global gcloud/ADC.
 */
export function runLogin(): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(ISOLATED_GCLOUD_DIR, {recursive: true});
    log(`logging in to isolated credential store at ${ISOLATED_GCLOUD_DIR}`);
    const child = spawn(
      'gcloud',
      [
        'auth',
        'login',
        '--update-adc',
        '--brief',
        ...(config.authAccount ? [config.authAccount] : []),
      ],
      {
        stdio: 'inherit',
        env: {...process.env, CLOUDSDK_CONFIG: ISOLATED_GCLOUD_DIR},
      },
    );
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        log('isolated login complete; connector now uses its own credentials');
        resolve();
      } else {
        reject(new Error(`gcloud auth login failed (exit ${code})`));
      }
    });
  });
}

export function printConfig(): void {
  console.log(JSON.stringify(config, null, 2));
}
