// [FORECAST - FILE MOI] Xu ly du lieu/du bao DHT11 rieng cho module Forecast.
import type { ReadingView } from '@iot/contracts';
import { apiPage } from '../../lib/api.js';
import { FORECAST_CONFIG as CFG } from './config.js';
import { normalizeReadings } from './timeseries.js';
import type { NormalizedHistory } from './types.js';

export interface HistoryResponse {
  history: NormalizedHistory;
  partial: boolean;
  fetched: number;
  historicalFallback: boolean;
}

/** Read-only paginated request; the existing API orders by descending record id. */
export async function fetchForecastHistory(
  deviceId: string, fromMs: number, toMs: number, signal?: AbortSignal,
): Promise<HistoryResponse> {
  async function pages(rangeOnly: boolean) {
    const collected: ReadingView[] = [];
    let cursor: string | null = null;
    let partial = false;
    for (let pageIndex = 0; pageIndex < CFG.historyMaxPages; pageIndex++) {
      const params = new URLSearchParams({ time_basis: 'sampled', limit: String(CFG.historyPageSize) });
      if (rangeOnly) {
        params.set('from', new Date(fromMs).toISOString());
        params.set('to', new Date(toMs).toISOString());
      }
      if (cursor) params.set('cursor', cursor);
      const page = await apiPage<ReadingView[]>(`/devices/${encodeURIComponent(deviceId)}/readings?${params.toString()}`, { signal });
      collected.push(...page.data);
      cursor = page.meta.next_cursor ?? null;
      if (!cursor) break;
      if (pageIndex === CFG.historyMaxPages - 1) partial = true;
    }
    return { collected, partial };
  }
  // The live window can be empty when a Simulator stopped hours ago. Read the
  // most recent persisted samples for *historical* replay instead of displaying
  // an entirely blank forecast screen. Never present this fallback as live data.
  const recent = await pages(true);
  const historicalFallback = recent.collected.length === 0;
  const { collected, partial } = historicalFallback ? await pages(false) : recent;

  const referenceTime = Math.min(Date.now(), toMs);
  return {
    history: normalizeReadings(collected, referenceTime),
    partial, fetched: collected.length, historicalFallback,
  };
}
