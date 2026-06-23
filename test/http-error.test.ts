import {describe, expect, it} from 'vitest';

import {explainHttpError} from '../src/vertex.ts';

describe('explainHttpError context-window overflow', () => {
  const body = JSON.stringify({
    type: 'error',
    error: {
      type: 'invalid_request_error',
      message: 'prompt is too long: 1660182 tokens > 1000000 maximum',
    },
  });

  it('gives a dedicated, actionable message for a too-long prompt', () => {
    const msg = explainHttpError(400, 'Bad Request', body);
    expect(msg).toMatch(/too long for this model's context window/);
    expect(msg).toContain('1660182 > 1000000 tokens');
    expect(msg).toMatch(/Start a new chat/);
    // It must NOT fall back to the misleading generic project/location hint.
    expect(msg).not.toMatch(/Check your project, location, and model settings/);
  });

  it('handles the message without explicit "a > b" counts', () => {
    const other = JSON.stringify({
      error: {message: 'The input token count exceeds the maximum allowed.'},
    });
    const msg = explainHttpError(400, 'Bad Request', other);
    expect(msg).toMatch(/too long for this model's context window/);
  });

  it('still uses the generic hint for unrelated 400s', () => {
    const msg = explainHttpError(
      400,
      'Bad Request',
      'some other validation error',
    );
    expect(msg).toMatch(/Check your project, location, and model settings/);
  });
});

describe('explainHttpError known status codes', () => {
  it('explains 403 with Model Garden guidance', () => {
    const msg = explainHttpError(403, 'Forbidden', 'permission denied');
    expect(msg).toMatch(/Permission denied/);
    expect(msg).toMatch(/Vertex AI User/);
  });

  it('explains 429 as quota/rate limiting', () => {
    const msg = explainHttpError(429, 'Too Many Requests', '');
    expect(msg).toMatch(/Rate limited|quota/i);
  });

  it('treats 5xx as transient', () => {
    const msg = explainHttpError(503, 'Service Unavailable', '');
    expect(msg).toMatch(/server error/i);
    expect(msg).toMatch(/try again/i);
  });
});
