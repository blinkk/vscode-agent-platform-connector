import {describe, expect, it} from 'vitest';

import {pruneClaudeImages} from '../src/vertex.ts';
import type {NormImage, NormMessage, NormRequest} from '../src/vertex.ts';

function img(tag: string): NormImage {
  return {mimeType: 'image/png', data: tag};
}

function imageMessage(text: string, count: number): NormMessage {
  return {
    role: 'user',
    text,
    images: Array.from({length: count}, (_, i) => img(`${text}-${i}`)),
  };
}

function countImages(req: NormRequest): number {
  return req.messages.reduce((n, m) => n + (m.images?.length ?? 0), 0);
}

describe('pruneClaudeImages', () => {
  it('returns the request unchanged at or below the threshold', () => {
    const req: NormRequest = {
      messages: [imageMessage('a', 20)],
    };
    expect(pruneClaudeImages(req)).toBe(req);
  });

  it('caps the total number of images at the threshold', () => {
    const req: NormRequest = {
      messages: [imageMessage('old', 15), imageMessage('new', 15)],
    };
    const pruned = pruneClaudeImages(req);
    expect(pruned).not.toBe(req);
    expect(countImages(pruned)).toBe(20);
  });

  it('keeps the most recent images and drops the oldest', () => {
    const req: NormRequest = {
      messages: [imageMessage('old', 15), imageMessage('new', 15)],
    };
    const pruned = pruneClaudeImages(req);
    // All 15 of the newest message survive; the oldest message is trimmed.
    expect(pruned.messages[1].images).toHaveLength(15);
    expect(pruned.messages[1].images?.[0].data).toBe('new-0');
    expect(pruned.messages[0].images).toHaveLength(5);
    // The 5 kept are the most recent within that message (tail of the array).
    expect(pruned.messages[0].images?.[0].data).toBe('old-10');
  });

  it('replaces fully dropped images with a placeholder note', () => {
    const req: NormRequest = {
      messages: [imageMessage('old', 5), imageMessage('new', 20)],
    };
    const pruned = pruneClaudeImages(req);
    expect(pruned.messages[1].images).toHaveLength(20);
    expect(pruned.messages[0].images).toBeUndefined();
    expect(pruned.messages[0].text).toContain('old');
    expect(pruned.messages[0].text).toContain(
      '5 earlier images omitted to stay within image limits',
    );
  });

  it('uses the singular placeholder for a single dropped image', () => {
    const req: NormRequest = {
      messages: [imageMessage('old', 1), imageMessage('new', 20)],
    };
    const pruned = pruneClaudeImages(req);
    expect(pruned.messages[0].images).toBeUndefined();
    expect(pruned.messages[0].text).toContain(
      '1 earlier image omitted to stay within image limits',
    );
  });

  it('does not mutate the original request', () => {
    const req: NormRequest = {
      messages: [imageMessage('old', 15), imageMessage('new', 15)],
    };
    pruneClaudeImages(req);
    expect(countImages(req)).toBe(30);
  });
});
