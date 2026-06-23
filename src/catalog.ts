/**
 * catalog.ts
 *
 * Single source of truth for the connector: the model catalog, config schema,
 * and shared path/URL helpers. The Vertex client and CLI import from here so
 * there is exactly one place to add a model or change a default.
 *
 * Naming: VS Code picker entries are rendered as "<Name> (<project>)", e.g.
 *   "Claude Opus 4.8 (my-project)".
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PRODUCT = 'Blinkk Agent Platform Chat Connector';
export const SERVICE_LABEL =
  'com.blinkk.vscode-google-agent-platform-connector';
export const PROVIDER_PREFIX = 'Blinkk Agent Platform Chat Connector';

/** Console deep-link to a project's Model Garden (where models are enabled). */
export function modelGardenUrl(project: string): string {
  const p = project || '<PROJECT_ID>';
  return `https://console.cloud.google.com/agent-platform/model-garden?project=${p}`;
}

export const DEFAULTS = {
  // No project default: the connector is project-agnostic, so the GCP project
  // must be supplied via VS Code settings, the config file, or the
  // GOOGLE_AGENT_PLATFORM_PROJECT env var.
  project: '',
  // Newest Gemini and Claude models are both served from the `global` catalog.
  geminiLocation: 'global',
  claudeLocation: 'global',
} as const;

/** How VS Code and the connector talk to a model. */
export type ModelApi = 'chat' | 'messages';

/** Extended-reasoning ("thinking") configuration for a model variant. */
export interface ThinkingConfig {
  /** Claude effort level: 'low' | 'medium' | 'high'. */
  effort?: 'low' | 'medium' | 'high';
}

/** Approximate USD list price per 1,000,000 tokens (for cost estimation). */
export interface ModelPricing {
  /** USD per 1M input (prompt) tokens. */
  input: number;
  /** USD per 1M output (completion) tokens. */
  output: number;
}

export interface ModelDef {
  /** Picker id; a "#thinking" suffix marks an extended-reasoning variant. */
  id: string;
  /** Upstream Vertex model id (defaults to `id` minus any "#thinking"). */
  upstream?: string;
  /** Human label WITHOUT the project suffix. */
  name: string;
  api: ModelApi;
  thinking?: ThinkingConfig;
  maxInputTokens: number;
  maxOutputTokens: number;
  vision?: boolean;
  /**
   * Approximate list price per 1M tokens, used only for the local "today's
   * estimated cost" readout. These are best-effort estimates, not billing.
   */
  pricing?: ModelPricing;
}

/** Estimate USD cost of a single request from its token usage. */
export function estimateCost(
  model: ModelDef | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = model?.pricing;
  if (!p) return 0;
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}

/**
 * How the connector obtains a Google access token.
 *   - 'adc'      Read the user's global Application Default Credentials
 *                (`gcloud auth application-default print-access-token`). Simple,
 *                but shares identity with everything else that uses ADC, so
 *                re-running `gcloud auth application-default login` changes it.
 *   - 'isolated' Read from a private gcloud config dir owned by the connector
 *                (`CLOUDSDK_CONFIG=<configDir>/gcloud`). Fully decoupled from the
 *                user's main gcloud/ADC: switching ADC elsewhere does not affect
 *                the connector. Populated once via the `--login` flow.
 */
export type AuthMode = 'adc' | 'isolated';

export interface ConnectorConfig {
  project: string;
  geminiLocation: string;
  claudeLocation: string;
  debug?: boolean;
  /** Token source. Defaults to 'adc'. */
  authMode?: AuthMode;
  /** Optional account to pin (`gcloud ... --account=`); usually unnecessary. */
  authAccount?: string;
  /**
   * Additional models to expose, beyond the built-in defaults. Lets users run
   * any model their project has enabled in Model Garden without a code change.
   * A custom entry whose `id` matches a built-in id overrides that built-in.
   */
  customModels?: ModelDef[];
}

/**
 * The model catalog.
 *
 * `api` selects how VS Code and the proxy talk to the model:
 *   - 'chat'     -> OpenAI Chat Completions (Gemini / openapi endpoint)
 *   - 'messages' -> Anthropic Messages (Claude / rawPredict endpoint). The
 *                   newest Claude models are ONLY served this way.
 *
 * `thinking` (optional) makes the proxy inject an extended-reasoning request:
 *   - for 'messages' models (Claude): `thinking:{type:'adaptive'}` plus
 *     `output_config:{effort}` (one of 'low'|'medium'|'high')
 *   - for 'chat' (Gemini) models: `reasoning_effort`
 * VS Code's BYOK UI has no thinking slider, so a "thinking" variant is exposed
 * as its own picker entry instead.
 *
 * `name` is the human label WITHOUT the project suffix; the suffix is appended
 * at config-build time so it always reflects the active GCP project.
 */
export const MODELS: readonly ModelDef[] = [
  {
    id: 'google/gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    api: 'chat',
    maxInputTokens: 1048576,
    maxOutputTokens: 65535,
    vision: true,
    pricing: {input: 0.3, output: 2.5},
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    api: 'messages',
    maxInputTokens: 1000000,
    maxOutputTokens: 64000,
    vision: true,
    pricing: {input: 15, output: 75},
  },
  {
    // Same upstream model as claude-opus-4-8, but the proxy enables extended
    // thinking. Exposed as its own picker entry because VS Code has no slider.
    id: 'claude-opus-4-8#thinking',
    upstream: 'claude-opus-4-8',
    name: 'Claude Opus 4.8 – High',
    api: 'messages',
    thinking: {effort: 'high'},
    maxInputTokens: 1000000,
    maxOutputTokens: 64000,
    vision: true,
    pricing: {input: 15, output: 75},
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    api: 'messages',
    maxInputTokens: 1000000,
    maxOutputTokens: 64000,
    vision: true,
    pricing: {input: 3, output: 15},
  },
  {
    id: 'claude-sonnet-4-5#thinking',
    upstream: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5 – High',
    api: 'messages',
    thinking: {effort: 'high'},
    maxInputTokens: 1000000,
    maxOutputTokens: 64000,
    vision: true,
    pricing: {input: 3, output: 15},
  },
];

/** The display name shown in the VS Code picker: "<Name> (<project>)". */
export function displayName(model: ModelDef, project: string): string {
  return `${model.name} (${project})`;
}

/** The upstream model id to send to Vertex (strips the "#thinking" tag). */
export function upstreamModelId(idOrModel: string | ModelDef): string {
  if (idOrModel && typeof idOrModel === 'object') {
    return idOrModel.upstream || idOrModel.id;
  }
  return String(idOrModel || '').replace(/#thinking$/, '');
}

/** Reasonable fallbacks for optional fields on a user-supplied custom model. */
const CUSTOM_MODEL_DEFAULTS = {
  maxInputTokens: 1048576,
  maxOutputTokens: 65535,
} as const;

/**
 * Validate + normalize a user-supplied custom model entry. Returns the model on
 * success, or throws with an actionable message describing the bad field.
 */
export function normalizeCustomModel(raw: unknown): ModelDef {
  if (!raw || typeof raw !== 'object') {
    throw new Error('custom model must be an object with at least {id, name}');
  }
  const m = raw as Partial<ModelDef>;
  if (!m.id || typeof m.id !== 'string') {
    throw new Error('custom model is missing a string "id"');
  }
  if (!m.name || typeof m.name !== 'string') {
    throw new Error(`custom model "${m.id}" is missing a string "name"`);
  }
  if (m.api && m.api !== 'chat' && m.api !== 'messages') {
    throw new Error(
      `custom model "${m.id}" has invalid "api" (use "chat" for Gemini/OpenAI ` +
        'models or "messages" for Claude/Anthropic models)',
    );
  }
  // Infer api from the id when omitted: Claude/Anthropic -> messages, else chat.
  const api: ModelApi = m.api || (isClaudeModel(m.id) ? 'messages' : 'chat');
  return {
    id: m.id,
    upstream: m.upstream,
    name: m.name,
    api,
    thinking: m.thinking,
    maxInputTokens: m.maxInputTokens ?? CUSTOM_MODEL_DEFAULTS.maxInputTokens,
    maxOutputTokens: m.maxOutputTokens ?? CUSTOM_MODEL_DEFAULTS.maxOutputTokens,
    vision: m.vision,
    pricing: m.pricing,
  };
}

/**
 * The effective model list = built-in defaults plus any validated custom models.
 * A custom model whose `id` matches a built-in id replaces that built-in, so the
 * defaults stay intact unless the user explicitly overrides one.
 */
export function resolveModels(customModels?: ModelDef[]): ModelDef[] {
  if (!customModels?.length) return [...MODELS];
  const byId = new Map<string, ModelDef>(MODELS.map((m) => [m.id, m]));
  for (const custom of customModels) byId.set(custom.id, custom);
  return [...byId.values()];
}

/** Look up a catalog entry by its (possibly tagged) id within a model list. */
export function findModel(
  id: string,
  models: readonly ModelDef[] = MODELS,
): ModelDef | undefined {
  return models.find((m) => m.id === id);
}

/* -------------------------------------------------------------------------- */
/* Config file                                                                */
/* -------------------------------------------------------------------------- */

export const CONFIG_DIR = path.join(
  os.homedir(),
  '.config',
  'blinkk-vscode-google-agent-platform-connector',
);
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
export const LOG_PATH = path.join(CONFIG_DIR, 'connector.log');

/**
 * Private gcloud config dir used when `authMode === 'isolated'`. Pointing
 * `CLOUDSDK_CONFIG` here gives the connector its own credential store, fully
 * separate from the user's global `~/.config/gcloud`, so switching ADC or
 * accounts elsewhere never affects the connector.
 */
export const ISOLATED_GCLOUD_DIR = path.join(CONFIG_DIR, 'gcloud');

/** Read the on-disk config file, or `{}` if missing/invalid. */
export function loadFileConfig(): Partial<ConnectorConfig> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------------- */
/* Vertex URL helpers                                                         */
/* -------------------------------------------------------------------------- */

export function isClaudeModel(model: unknown): boolean {
  return typeof model === 'string' && /(^anthropic\/|claude)/i.test(model);
}

export function vertexBase(location: string): string {
  return location === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${location}-aiplatform.googleapis.com`;
}

/** Gemini / OpenAI-compatible publisher models via the openapi endpoint. */
export function chatCompletionsUrl(project: string, location: string): string {
  return (
    `${vertexBase(location)}/v1/projects/${project}/locations/${location}` +
    '/endpoints/openapi/chat/completions'
  );
}

/** Claude via the native Anthropic Messages endpoint (rawPredict/stream). */
export function anthropicUrl(
  project: string,
  location: string,
  model: string,
  stream: boolean,
): string {
  const method = stream ? 'streamRawPredict' : 'rawPredict';
  return (
    `${vertexBase(location)}/v1/projects/${project}/locations/${location}` +
    `/publishers/anthropic/models/${model}:${method}`
  );
}
