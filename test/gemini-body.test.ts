import { describe, expect, it } from 'vitest';

import type { ModelDef } from '../src/catalog.ts';
import { buildGeminiBody } from '../src/vertex.ts';
import type { NormRequest } from '../src/vertex.ts';

const model: ModelDef = {
  id: 'google/gemini-3.5-flash',
  name: 'Gemini 3.5 Flash',
  api: 'chat',
  maxInputTokens: 1000,
  maxOutputTokens: 1000,
};

function geminiMessages(req: NormRequest): Array<Record<string, any>> {
  return (
    buildGeminiBody(model, req) as { messages: Array<Record<string, any>> }
  ).messages;
}

describe('buildGeminiBody thought signatures', () => {
  it('attaches the skip sentinel when a rebuilt tool call has no signature', () => {
    const messages = geminiMessages({
      messages: [
        { role: 'user', text: 'hi' },
        {
          role: 'assistant',
          toolCalls: [{ id: 'call_1', name: 'do_thing', input: { a: 1 } }],
        },
        { role: 'user', toolResults: [{ callId: 'call_1', content: 'ok' }] },
      ],
    });

    const assistant = messages.find((m) => Array.isArray(m.tool_calls));
    expect(assistant).toBeDefined();
    const sig =
      assistant!.tool_calls[0].extra_content?.google?.thought_signature;
    expect(sig).toBe('skip_thought_signature_validator');
  });

  it('echoes a real signature back when present', () => {
    const messages = geminiMessages({
      messages: [
        {
          role: 'assistant',
          toolCalls: [
            { id: 'call_1', name: 'do_thing', input: {}, signature: 'SIG_A' },
          ],
        },
      ],
    });

    const assistant = messages.find((m) => Array.isArray(m.tool_calls));
    expect(
      assistant!.tool_calls[0].extra_content.google.thought_signature,
    ).toBe('SIG_A');
  });

  it('serializes tool-call arguments and ids', () => {
    const messages = geminiMessages({
      messages: [
        {
          role: 'assistant',
          toolCalls: [{ id: 'call_x', name: 'fn', input: { q: 'v' } }],
        },
      ],
    });
    const tc = messages.find((m) => Array.isArray(m.tool_calls))!.tool_calls[0];
    expect(tc.id).toBe('call_x');
    expect(tc.function.name).toBe('fn');
    expect(tc.function.arguments).toBe('{"q":"v"}');
  });
});
