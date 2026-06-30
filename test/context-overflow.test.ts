import {describe, expect, it} from 'vitest';

import type {ModelDef} from '../src/catalog.ts';
import {
  estimateRequestTokens,
  fitRequestToContext,
  parseContextOverflow,
} from '../src/vertex.ts';
import type {NormMessage, NormRequest} from '../src/vertex.ts';

const model: ModelDef = {
  id: 'claude-opus-4-8',
  name: 'Claude Opus 4.8',
  api: 'messages',
  maxInputTokens: 1000,
  maxOutputTokens: 100,
};

function userMessage(text: string): NormMessage {
  return {role: 'user', text};
}

describe('parseContextOverflow', () => {
  it('extracts actual and limit from the "a > b tokens" form', () => {
    const body = JSON.stringify({
      error: {
        message:
          "The conversation is too long for this model's context window " +
          '(1010342 > 1000000 tokens).',
      },
    });
    expect(parseContextOverflow(400, body)).toEqual({
      actual: 1010342,
      limit: 1000000,
    });
  });

  it('parses comma-grouped numbers', () => {
    const body = 'prompt is too long: 1,660,182 tokens > 1,000,000 maximum';
    expect(parseContextOverflow(400, body)).toEqual({
      actual: 1660182,
      limit: 1000000,
    });
  });

  it('returns a limit-only result when there is no "a > b" pair', () => {
    const body = 'The input token count exceeds the maximum of 200000 tokens.';
    expect(parseContextOverflow(400, body)).toEqual({limit: 200000});
  });

  it('returns undefined for unrelated 400s', () => {
    expect(parseContextOverflow(400, 'some other error')).toBeUndefined();
  });

  it('returns undefined for non-400 statuses', () => {
    const body = 'context window exceeded (10 > 5 tokens)';
    expect(parseContextOverflow(500, body)).toBeUndefined();
  });
});

describe('fitRequestToContext with an explicit budget override', () => {
  it('trims more aggressively to a tighter budget', () => {
    const big = 'x'.repeat(400); // ~100 tokens each
    const req: NormRequest = {
      messages: [
        userMessage('old-1 ' + big),
        userMessage('old-2 ' + big),
        userMessage('latest ' + big),
      ],
    };
    // The default budget would keep all three (well under the 1000 limit);
    // a tight override forces older turns out.
    const fitted = fitRequestToContext(model, req, 120);
    expect(fitted).not.toBe(req);
    expect(estimateRequestTokens(fitted)).toBeLessThanOrEqual(
      estimateRequestTokens(req),
    );
    // The latest turn is always preserved.
    const last = fitted.messages[fitted.messages.length - 1];
    expect(last.text).toContain('latest');
  });
});
