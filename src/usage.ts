/**
 * usage.ts
 *
 * Lightweight, local-only usage + cost tracking for the connector. Inspired by
 * the cost-transparency feature in jorsm/vertex-ai-models-chat-provider, this
 * keeps a running "today" tally of token usage and an *estimated* USD cost
 * (using the per-model list prices in the catalog) so the extension can show a
 * "Today's estimated cost" readout in the status bar.
 *
 * It is best-effort and local: the running total is persisted to a small JSON
 * file under CONFIG_DIR, keyed by calendar day, and resets automatically when
 * the day rolls over. It is NOT a billing source of truth — actual charges come
 * from Google Cloud Billing.
 */

import fs from 'node:fs';
import path from 'node:path';

import {CONFIG_DIR, estimateCost} from './catalog.ts';
import type {ModelDef} from './catalog.ts';

const USAGE_PATH = path.join(CONFIG_DIR, 'usage.json');

/** A single day's running totals. */
export interface DailyUsage {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Total input (prompt) tokens seen today. */
  inputTokens: number;
  /** Total output (completion) tokens seen today. */
  outputTokens: number;
  /** Number of requests counted today. */
  requests: number;
  /** Estimated USD cost accumulated today. */
  costUsd: number;
}

/** Listeners notified whenever today's usage changes (e.g. to redraw UI). */
export const usageListeners: Array<(usage: DailyUsage) => void> = [];

function today(): string {
  // Local-day key (sortable). Avoids UTC drift so "today" matches the user.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyUsage(): DailyUsage {
  return {
    date: today(),
    inputTokens: 0,
    outputTokens: 0,
    requests: 0,
    costUsd: 0,
  };
}

let current: DailyUsage = loadUsage();

function loadUsage(): DailyUsage {
  try {
    const raw = JSON.parse(fs.readFileSync(USAGE_PATH, 'utf8')) as DailyUsage;
    if (raw && raw.date === today()) return raw;
  } catch {
    /* missing or invalid — start fresh */
  }
  return emptyUsage();
}

function persist(): void {
  try {
    fs.mkdirSync(CONFIG_DIR, {recursive: true});
    fs.writeFileSync(USAGE_PATH, JSON.stringify(current, null, 2));
  } catch {
    /* never let persistence break a chat turn */
  }
}

/** Roll over to a fresh tally if the calendar day has changed. */
function ensureToday(): void {
  if (current.date !== today()) current = emptyUsage();
}

/** Today's running usage totals (rolls over automatically at midnight). */
export function getTodayUsage(): DailyUsage {
  ensureToday();
  return current;
}

/**
 * Record one request's token usage and add its estimated cost to today's tally.
 * Safe to call with zeros (e.g. when a provider returned no usage metadata).
 */
export function recordUsage(
  model: ModelDef | undefined,
  inputTokens: number,
  outputTokens: number,
): void {
  ensureToday();
  current.inputTokens += inputTokens || 0;
  current.outputTokens += outputTokens || 0;
  current.requests += 1;
  current.costUsd += estimateCost(model, inputTokens || 0, outputTokens || 0);
  persist();
  for (const listener of usageListeners) {
    try {
      listener(current);
    } catch {
      /* never let a listener break tracking */
    }
  }
}

/** Format a USD amount for display, e.g. `$0.0123` or `$1.20`. */
export function formatUsd(amount: number): string {
  if (amount <= 0) return '$0.00';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}
