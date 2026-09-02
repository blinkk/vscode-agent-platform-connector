import {afterEach, describe, expect, it} from 'vitest';

import {
  MODELS,
  displayName,
  findModel,
  geminiApiUrl,
  isGeminiApiModel,
  normalizeCustomModel,
} from '../src/catalog.ts';
import type {ModelDef} from '../src/catalog.ts';
import {
  config,
  explainGeminiApiError,
  geminiApiKeySource,
  setGeminiApiKey,
} from '../src/vertex.ts';

// Every built-in model is Vertex-backed; the gemini-api backend is reachable
// only via `customModels`, so backend-specific cases use a synthetic model.
const geminiApiModel: ModelDef = {
  id: 'gemini-3.1-pro-preview',
  name: 'Gemini 3.1 Pro Preview (Gemini API)',
  api: 'chat',
  backend: 'gemini-api',
  maxInputTokens: 1048576,
  maxOutputTokens: 65536,
};

describe('Gemini API backend catalog', () => {
  it('ships no built-in gemini-api models', () => {
    expect(MODELS.filter(isGeminiApiModel)).toEqual([]);
  });

  it('serves the built-in Gemini models from Vertex', () => {
    const flash = findModel('google/gemini-3.8-flash', MODELS);
    const pro = findModel('google/gemini-3.1-pro-preview', MODELS);
    expect(flash?.backend).toBeUndefined(); // defaults to vertex
    expect(pro?.backend).toBeUndefined();
    // They use the OpenAI (chat) shape, not Anthropic messages.
    expect(flash?.api).toBe('chat');
    expect(pro?.api).toBe('chat');
  });

  it('isGeminiApiModel reflects the backend field', () => {
    const vertex = findModel('google/gemini-3.8-flash', MODELS) as ModelDef;
    expect(isGeminiApiModel(geminiApiModel)).toBe(true);
    expect(isGeminiApiModel(vertex)).toBe(false);
  });
});

describe('displayName is backend-aware', () => {
  const vertex = findModel('google/gemini-3.8-flash', MODELS) as ModelDef;

  it('appends the project for Vertex models', () => {
    expect(displayName(vertex, 'my-project')).toBe(
      'Gemini 3.8 Flash (my-project)',
    );
  });

  it('does not append the project for Gemini API models', () => {
    // Billed to the API key, not the project — so no misleading project suffix.
    const name = displayName(geminiApiModel, 'my-project');
    expect(name).toBe('Gemini 3.1 Pro Preview (Gemini API)');
    expect(name).not.toContain('my-project');
  });
});

describe('geminiApiUrl', () => {
  it('points at the AI Studio OpenAI-compatible endpoint', () => {
    expect(geminiApiUrl()).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    );
  });
});

describe('normalizeCustomModel backend handling', () => {
  it('accepts a valid gemini-api backend', () => {
    const m = normalizeCustomModel({
      id: 'gemini-3.0-flash',
      name: 'Gemini 3.0 Flash',
      backend: 'gemini-api',
    });
    expect(m.backend).toBe('gemini-api');
    expect(m.api).toBe('chat'); // inferred
  });

  it('rejects an unknown backend', () => {
    expect(() =>
      normalizeCustomModel({id: 'x', name: 'X', backend: 'antigravity'}),
    ).toThrow(/invalid "backend"/);
  });

  it('rejects gemini-api combined with the messages api', () => {
    expect(() =>
      normalizeCustomModel({
        id: 'x',
        name: 'X',
        api: 'messages',
        backend: 'gemini-api',
      }),
    ).toThrow(/only supports the "chat" api/);
  });

  it('defaults backend to undefined (vertex) when omitted', () => {
    const m = normalizeCustomModel({id: 'google/foo', name: 'Foo'});
    expect(m.backend).toBeUndefined();
  });
});

describe('setGeminiApiKey / geminiApiKeySource', () => {
  // These mutate the shared config singleton; restore the (env/file) fallback
  // afterwards so other suites see a clean slate.
  afterEach(() => setGeminiApiKey(undefined));

  it('a stored secret becomes the effective key and reports source "secret"', () => {
    setGeminiApiKey('AIza-stored-secret');
    expect(config.geminiApiKey).toBe('AIza-stored-secret');
    expect(geminiApiKeySource()).toBe('secret');
  });

  it('trims whitespace around a pasted key', () => {
    setGeminiApiKey('  AIza-padded  ');
    expect(config.geminiApiKey).toBe('AIza-padded');
  });

  it('clearing reverts to the env/file fallback (none in this test env)', () => {
    setGeminiApiKey('AIza-stored-secret');
    setGeminiApiKey('');
    // No GEMINI_API_KEY env or config-file key under test, so it falls to none.
    expect(config.geminiApiKey).toBe('');
    expect(geminiApiKeySource()).toBe('none');
  });
});

describe('explainGeminiApiError', () => {
  it('maps 401/403 to a key-auth hint, not a Vertex/project hint', () => {
    const msg = explainGeminiApiError(403, 'Forbidden', 'bad key');
    expect(msg).toMatch(/GEMINI_API_KEY/);
    expect(msg).toMatch(/aistudio\.google\.com\/apikey/);
    expect(msg).not.toMatch(/Model Garden|Vertex AI User/);
  });

  it('gives a context-overflow message for a too-long prompt', () => {
    const body = JSON.stringify({
      error: {message: 'prompt is too long: 2000000 tokens > 1048576 maximum'},
    });
    const msg = explainGeminiApiError(400, 'Bad Request', body);
    expect(msg).toMatch(/too long for this model's context window/);
    expect(msg).toContain('2000000 > 1048576 tokens');
  });

  it('maps 429 to a quota hint', () => {
    const msg = explainGeminiApiError(429, 'Too Many Requests', '');
    expect(msg).toMatch(/quota/i);
  });
});
