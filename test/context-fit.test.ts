import {describe, expect, it} from 'vitest';

import type {ModelDef} from '../src/catalog.ts';
import {estimateRequestTokens, fitRequestToContext} from '../src/vertex.ts';
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

describe('fitRequestToContext', () => {
  it('returns the request unchanged when it already fits', () => {
    const req: NormRequest = {
      messages: [userMessage('short')],
    };
    expect(fitRequestToContext(model, req)).toBe(req);
  });

  it('drops the oldest non-system messages until the request fits', () => {
    // Each message is large enough that several together exceed the budget.
    const big = 'x'.repeat(4000); // ~1000 tokens each
    const req: NormRequest = {
      messages: [
        {role: 'system', text: 'system prompt'},
        userMessage('old-1 ' + big),
        userMessage('old-2 ' + big),
        userMessage('latest ' + big),
      ],
    };

    const fitted = fitRequestToContext(model, req);
    expect(fitted).not.toBe(req);
    // System message is always kept.
    expect(fitted.messages.some((m) => m.role === 'system')).toBe(true);
    // The final (latest) message is always kept.
    const last = fitted.messages[fitted.messages.length - 1];
    expect(last.text).toContain('latest');
    // At least one of the older messages was dropped.
    expect(fitted.messages.length).toBeLessThan(req.messages.length);
  });

  it('never drops the final message even if it alone overflows', () => {
    const huge = 'x'.repeat(40000); // far over the budget on its own
    const req: NormRequest = {
      messages: [userMessage('only ' + huge)],
    };
    const fitted = fitRequestToContext(model, req);
    expect(fitted.messages).toHaveLength(1);
    expect(fitted.messages[0].text).toContain('only');
  });

  it('estimateRequestTokens grows with content size', () => {
    const small = estimateRequestTokens({messages: [userMessage('hi')]});
    const large = estimateRequestTokens({
      messages: [userMessage('x'.repeat(4000))],
    });
    expect(large).toBeGreaterThan(small);
  });

  it('drops a tool_use/tool_result pair together, never splitting them', () => {
    // Each old turn (assistant tool_use + user tool_result) is large enough
    // that dropping just one of the two wouldn't be enough to hit budget,
    // forcing the trimmer to consider the pair as a unit.
    const big = 'x'.repeat(4000);
    const req: NormRequest = {
      messages: [
        {role: 'system', text: 'system prompt'},
        {
          role: 'assistant',
          toolCalls: [{id: 'call_1', name: 'do_thing', input: {a: big}}],
        },
        {role: 'user', toolResults: [{callId: 'call_1', content: big}]},
        userMessage('latest ' + big),
      ],
    };

    const fitted = fitRequestToContext(model, req);
    expect(fitted).not.toBe(req);

    const hasOrphanToolUse = fitted.messages.some(
      (m, i) =>
        m.role === 'assistant' &&
        m.toolCalls?.length &&
        !fitted.messages[i + 1]?.toolResults?.length,
    );
    const hasOrphanToolResult = fitted.messages.some((m, i) => {
      if (!m.toolResults?.length) return false;
      const prev = fitted.messages[i - 1];
      const ids = new Set((prev?.toolCalls ?? []).map((t) => t.id));
      return m.toolResults.some((r) => !ids.has(r.callId));
    });
    expect(hasOrphanToolUse).toBe(false);
    expect(hasOrphanToolResult).toBe(false);
  });
});
