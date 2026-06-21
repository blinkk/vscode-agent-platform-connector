import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterAll, describe, expect, it} from 'vitest';

// Redirect HOME to a throwaway dir BEFORE importing usage.ts, since the module
// computes CONFIG_DIR from os.homedir() at import time. This keeps the test from
// reading or writing the developer's real ~/.config usage file.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bapcc-usage-'));
const realHome = process.env.HOME;
const realProfile = process.env.USERPROFILE;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const usage = await import('../src/usage.ts');
const {formatUsd, getTodayUsage, recordUsage, usageListeners} = usage;
import type {ModelDef} from '../src/catalog.ts';

afterAll(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  if (realProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realProfile;
  fs.rmSync(tmpHome, {recursive: true, force: true});
});

describe('formatUsd', () => {
  it('renders zero and negatives as $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(-1)).toBe('$0.00');
  });

  it('uses 4 decimals for tiny amounts under a cent', () => {
    expect(formatUsd(0.0042)).toBe('$0.0042');
  });

  it('uses 2 decimals for amounts of a cent or more', () => {
    expect(formatUsd(1.2)).toBe('$1.20');
    expect(formatUsd(10.5)).toBe('$10.50');
  });
});

describe('recordUsage / getTodayUsage', () => {
  const priced: ModelDef = {
    id: 'x',
    name: 'X',
    api: 'chat',
    maxInputTokens: 1,
    maxOutputTokens: 1,
    pricing: {input: 3, output: 15},
  };

  it('accumulates tokens, requests, and estimated cost', () => {
    const before = getTodayUsage();
    const startReqs = before.requests;
    const startCost = before.costUsd;

    recordUsage(priced, 1_000_000, 1_000_000);

    const after = getTodayUsage();
    expect(after.requests).toBe(startReqs + 1);
    expect(after.inputTokens).toBeGreaterThanOrEqual(1_000_000);
    // 1M in @ $3 + 1M out @ $15 = $18
    expect(after.costUsd - startCost).toBeCloseTo(18, 6);
  });

  it('counts requests even with no pricing or zero tokens', () => {
    const startReqs = getTodayUsage().requests;
    recordUsage(undefined, 0, 0);
    expect(getTodayUsage().requests).toBe(startReqs + 1);
  });

  it('notifies registered listeners', () => {
    let calls = 0;
    const listener = () => {
      calls += 1;
    };
    usageListeners.push(listener);
    try {
      recordUsage(priced, 10, 10);
      expect(calls).toBe(1);
    } finally {
      const i = usageListeners.indexOf(listener);
      if (i >= 0) usageListeners.splice(i, 1);
    }
  });
});
