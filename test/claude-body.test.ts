import {describe, expect, it} from 'vitest';

import type {ModelDef} from '../src/catalog.ts';
import {buildClaudeBody} from '../src/vertex.ts';
import type {NormRequest} from '../src/vertex.ts';

const model: ModelDef = {
  id: 'anthropic/claude-opus-4-5',
  name: 'Claude Opus 4.5',
  api: 'messages',
  maxInputTokens: 1000,
  maxOutputTokens: 1000,
};

function claudeMessages(req: NormRequest): Array<Record<string, any>> {
  return (buildClaudeBody(model, req) as {messages: Array<Record<string, any>>})
    .messages;
}

describe('buildClaudeBody tool_use / tool_result pairing', () => {
  it('keeps a properly paired tool_use -> tool_result sequence', () => {
    const messages = claudeMessages({
      messages: [
        {role: 'user', text: 'hi'},
        {
          role: 'assistant',
          toolCalls: [{id: 'call_1', name: 'do_thing', input: {a: 1}}],
        },
        {role: 'user', toolResults: [{callId: 'call_1', content: 'ok'}]},
      ],
    });

    const result = messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .find((c) => c.type === 'tool_result');
    expect(result).toBeDefined();
    expect(result.tool_use_id).toBe('call_1');
  });

  it('drops a leading orphaned tool_result (no preceding assistant turn)', () => {
    const messages = claudeMessages({
      messages: [
        {role: 'user', toolResults: [{callId: 'orphan_1', content: 'ok'}]},
        {role: 'user', text: 'continue'},
      ],
    });

    const hasToolResult = messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .some((c) => c.type === 'tool_result');
    expect(hasToolResult).toBe(false);
    // The following real user turn survives.
    expect(messages.some((m) => m.role === 'user')).toBe(true);
  });

  it('drops only unpaired tool_result blocks and keeps matched ones', () => {
    const messages = claudeMessages({
      messages: [
        {
          role: 'assistant',
          toolCalls: [{id: 'call_1', name: 'do_thing', input: {}}],
        },
        {
          role: 'user',
          toolResults: [
            {callId: 'call_1', content: 'ok'},
            {callId: 'call_missing', content: 'stale'},
          ],
        },
      ],
    });

    const results = messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((c) => c.type === 'tool_result');
    expect(results).toHaveLength(1);
    expect(results[0].tool_use_id).toBe('call_1');
  });

  it('drops the entire tool_result turn when none of its ids pair', () => {
    const messages = claudeMessages({
      messages: [
        {
          role: 'assistant',
          toolCalls: [{id: 'call_1', name: 'do_thing', input: {}}],
        },
        {role: 'user', text: 'unrelated turn'},
        {role: 'user', toolResults: [{callId: 'call_1', content: 'ok'}]},
      ],
    });

    // The tool_result now follows a plain user turn, not the assistant
    // tool_use, so its id is no longer in scope and it must be dropped.
    const hasToolResult = messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .some((c) => c.type === 'tool_result');
    expect(hasToolResult).toBe(false);
  });
});
