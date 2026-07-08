import {describe, expect, it} from 'vitest';

import {
  MODELS,
  anthropicUrl,
  chatCompletionsUrl,
  displayName,
  estimateCost,
  findModel,
  isClaudeModel,
  modelGardenUrl,
  normalizeCustomModel,
  resolveModels,
  upstreamModelId,
  vertexBase,
} from '../src/catalog.ts';
import type {ModelDef} from '../src/catalog.ts';

describe('estimateCost', () => {
  const priced: ModelDef = {
    id: 'x',
    name: 'X',
    api: 'chat',
    maxInputTokens: 1,
    maxOutputTokens: 1,
    pricing: {input: 3, output: 15},
  };

  it('computes cost from per-1M pricing', () => {
    // 1,000,000 input @ $3 + 500,000 output @ $15 = 3 + 7.5 = 10.5
    expect(estimateCost(priced, 1_000_000, 500_000)).toBeCloseTo(10.5, 6);
  });

  it('returns 0 when the model has no pricing', () => {
    const unpriced: ModelDef = {...priced, pricing: undefined};
    expect(estimateCost(unpriced, 1_000_000, 1_000_000)).toBe(0);
  });

  it('returns 0 for an undefined model', () => {
    expect(estimateCost(undefined, 1_000_000, 1_000_000)).toBe(0);
  });

  it('returns 0 for zero tokens', () => {
    expect(estimateCost(priced, 0, 0)).toBe(0);
  });
});

describe('normalizeCustomModel', () => {
  it('infers messages api for Claude ids', () => {
    const m = normalizeCustomModel({id: 'claude-opus-4-8', name: 'Opus'});
    expect(m.api).toBe('messages');
  });

  it('infers chat api for non-Claude ids', () => {
    const m = normalizeCustomModel({id: 'google/gemini-3-pro', name: 'G3'});
    expect(m.api).toBe('chat');
  });

  it('applies default token limits when omitted', () => {
    const m = normalizeCustomModel({id: 'google/foo', name: 'Foo'});
    expect(m.maxInputTokens).toBe(1048576);
    expect(m.maxOutputTokens).toBe(65535);
  });

  it('preserves pricing', () => {
    const m = normalizeCustomModel({
      id: 'google/foo',
      name: 'Foo',
      pricing: {input: 1, output: 2},
    });
    expect(m.pricing).toEqual({input: 1, output: 2});
  });

  it('throws when id is missing', () => {
    expect(() => normalizeCustomModel({name: 'No id'})).toThrow(/id/);
  });

  it('throws when name is missing', () => {
    expect(() => normalizeCustomModel({id: 'google/foo'})).toThrow(/name/);
  });

  it('throws on an invalid api', () => {
    expect(() =>
      normalizeCustomModel({
        id: 'google/foo',
        name: 'Foo',
        api: 'bogus' as never,
      }),
    ).toThrow(/api/);
  });

  it('throws on a non-object', () => {
    expect(() => normalizeCustomModel(null)).toThrow();
    expect(() => normalizeCustomModel('nope')).toThrow();
  });
});

describe('resolveModels', () => {
  it('returns the built-in defaults when no custom models given', () => {
    expect(resolveModels()).toHaveLength(MODELS.length);
    expect(resolveModels([])).toHaveLength(MODELS.length);
  });

  it('appends new custom models', () => {
    const custom = normalizeCustomModel({id: 'google/new', name: 'New'});
    const models = resolveModels([custom]);
    expect(models).toHaveLength(MODELS.length + 1);
    expect(findModel('google/new', models)).toBeDefined();
  });

  it('overrides a built-in when ids match', () => {
    const override = normalizeCustomModel({
      id: 'claude-opus-4-8',
      name: 'Custom Opus',
    });
    const models = resolveModels([override]);
    expect(models).toHaveLength(MODELS.length);
    expect(findModel('claude-opus-4-8', models)?.name).toBe('Custom Opus');
  });
});

describe('findModel', () => {
  it('finds a built-in by id', () => {
    expect(findModel('claude-sonnet-4-5')?.name).toBe('Claude Sonnet 4.5');
  });

  it('returns undefined for an unknown id', () => {
    expect(findModel('nope')).toBeUndefined();
  });
});

describe('id + name helpers', () => {
  it('displayName appends the project', () => {
    const m = findModel('claude-opus-4-8')!;
    expect(displayName(m, 'my-project')).toBe('Claude Opus 4.8 (my-project)');
  });

  it('displayName warns when no project is configured', () => {
    const m = findModel('claude-opus-4-8')!;
    expect(displayName(m, '')).toBe('Claude Opus 4.8 (⚠ no project)');
  });

  it('upstreamModelId strips the #thinking tag', () => {
    expect(upstreamModelId('claude-opus-4-8#thinking')).toBe('claude-opus-4-8');
  });

  it('upstreamModelId honors an explicit upstream on a model', () => {
    const m = findModel('claude-opus-4-8#thinking')!;
    expect(upstreamModelId(m)).toBe('claude-opus-4-8');
  });

  it('isClaudeModel detects claude/anthropic ids', () => {
    expect(isClaudeModel('claude-opus-4-8')).toBe(true);
    expect(isClaudeModel('anthropic/claude')).toBe(true);
    expect(isClaudeModel('google/gemini-3.5-flash')).toBe(false);
  });
});

describe('url helpers', () => {
  it('vertexBase uses the global host for global', () => {
    expect(vertexBase('global')).toBe('https://aiplatform.googleapis.com');
  });

  it('vertexBase uses a regional host otherwise', () => {
    expect(vertexBase('us-east5')).toBe(
      'https://us-east5-aiplatform.googleapis.com',
    );
  });

  it('chatCompletionsUrl points at the openapi endpoint', () => {
    expect(chatCompletionsUrl('p', 'global')).toBe(
      'https://aiplatform.googleapis.com/v1/projects/p/locations/global' +
        '/endpoints/openapi/chat/completions',
    );
  });

  it('anthropicUrl selects rawPredict vs streamRawPredict', () => {
    expect(anthropicUrl('p', 'global', 'claude-opus-4-8', false)).toMatch(
      /:rawPredict$/,
    );
    expect(anthropicUrl('p', 'global', 'claude-opus-4-8', true)).toMatch(
      /:streamRawPredict$/,
    );
  });

  it('modelGardenUrl includes the project', () => {
    expect(modelGardenUrl('my-project')).toContain('project=my-project');
  });
});
