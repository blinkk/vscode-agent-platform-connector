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

    // The real tool_result follows a plain user turn, not the assistant
    // tool_use, so its id is out of scope and must be dropped. The assistant
    // tool_use is then unanswered, so a synthetic error result is inserted
    // immediately after it instead.
    const results = messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((c) => c.type === 'tool_result');
    expect(results).toHaveLength(1);
    expect(results[0].tool_use_id).toBe('call_1');
    expect(results[0].is_error).toBe(true);
    expectToolPairingValid(messages);
  });
});

/**
 * Assert the invariant Vertex enforces: every assistant tool_use id has a
 * matching tool_result in the immediately-following message, and every
 * tool_result pairs with a tool_use in the immediately-preceding message.
 */
function expectToolPairingValid(messages: Array<Record<string, any>>): void {
  for (let i = 0; i < messages.length; i++) {
    const blocks = Array.isArray(messages[i].content)
      ? messages[i].content
      : [];
    const useIds = blocks
      .filter((c: any) => c.type === 'tool_use')
      .map((c: any) => c.id);
    if (!useIds.length) continue;
    const nextBlocks = Array.isArray(messages[i + 1]?.content)
      ? messages[i + 1].content
      : [];
    const resultIds = new Set(
      nextBlocks
        .filter((c: any) => c.type === 'tool_result')
        .map((c: any) => c.tool_use_id),
    );
    for (const id of useIds) expect(resultIds.has(id)).toBe(true);
  }
}

describe('buildClaudeBody unanswered tool_use repair', () => {
  it('inserts a synthetic result when a plain user turn follows a tool_use', () => {
    // A prior turn died mid-tool-call, then the user sent a new prompt.
    const messages = claudeMessages({
      messages: [
        {role: 'user', text: 'hi'},
        {
          role: 'assistant',
          toolCalls: [{id: 'call_dead', name: 'do_thing', input: {}}],
        },
        {role: 'user', text: 'try again please'},
      ],
    });

    expectToolPairingValid(messages);
    const synthetic = messages[2].content.find(
      (c: any) => c.type === 'tool_result',
    );
    expect(synthetic.tool_use_id).toBe('call_dead');
    expect(synthetic.is_error).toBe(true);
    // The user's real prompt still follows, untouched.
    expect(messages[3].content).toEqual([
      {type: 'text', text: 'try again please'},
    ]);
  });

  it('completes a partial tool_result turn missing some ids', () => {
    const messages = claudeMessages({
      messages: [
        {
          role: 'assistant',
          toolCalls: [
            {id: 'call_a', name: 'do_thing', input: {}},
            {id: 'call_b', name: 'do_other', input: {}},
          ],
        },
        {role: 'user', toolResults: [{callId: 'call_a', content: 'ok'}]},
      ],
    });

    expectToolPairingValid(messages);
    const results = messages[1].content.filter(
      (c: any) => c.type === 'tool_result',
    );
    expect(results.map((r: any) => r.tool_use_id).sort()).toEqual([
      'call_a',
      'call_b',
    ]);
    expect(results.find((r: any) => r.tool_use_id === 'call_a').is_error).toBe(
      undefined,
    );
    expect(results.find((r: any) => r.tool_use_id === 'call_b').is_error).toBe(
      true,
    );
  });

  it('appends a synthetic result turn after a trailing tool_use', () => {
    const messages = claudeMessages({
      messages: [
        {role: 'user', text: 'hi'},
        {
          role: 'assistant',
          toolCalls: [{id: 'call_tail', name: 'do_thing', input: {}}],
        },
      ],
    });

    expectToolPairingValid(messages);
    expect(messages[messages.length - 1].role).toBe('user');
  });

  it('repairs consecutive failed tool-call turns independently', () => {
    // Two turns in a row died mid-tool-call — the "wedged conversation" case
    // where every retry re-fails and appends another dangling tool_use.
    const messages = claudeMessages({
      messages: [
        {role: 'user', text: 'hi'},
        {
          role: 'assistant',
          toolCalls: [{id: 'call_1', name: 'do_thing', input: {}}],
        },
        {
          role: 'assistant',
          toolCalls: [{id: 'call_2', name: 'do_thing', input: {}}],
        },
        {role: 'user', text: 'still broken?'},
      ],
    });

    expectToolPairingValid(messages);
  });

  it('leaves properly paired sequences untouched', () => {
    const messages = claudeMessages({
      messages: [
        {role: 'user', text: 'hi'},
        {
          role: 'assistant',
          toolCalls: [{id: 'call_1', name: 'do_thing', input: {}}],
        },
        {role: 'user', toolResults: [{callId: 'call_1', content: 'ok'}]},
        {role: 'assistant', text: 'done'},
      ],
    });

    expectToolPairingValid(messages);
    const results = messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((c) => c.type === 'tool_result');
    expect(results).toHaveLength(1);
    expect(results[0].is_error).toBe(undefined);
  });
});
