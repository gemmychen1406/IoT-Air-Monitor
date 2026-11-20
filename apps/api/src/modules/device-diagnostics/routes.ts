import type { Router } from "express";
import { z } from "zod";
import {
  diagnosticQuerySchema,
  type DiagnosticInput,
  type Reading,
} from "@iot/contracts";
import type { FeatureContext } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { analyzeDiagnostics } from "./analysis.js";

export function registerDeviceDiagnostics(
  router: Router,
  { db, reply }: FeatureContext,
) {
  router.get("/devices/:id/diagnostics", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const query = diagnosticQuerySchema.parse(req.query);
    const from = new Date(query.from),
      to = new Date(query.to);
    if (to.getTime() > Date.now() + 60000)
      throw new ApiError(
        422,
        "FUTURE_RANGE",
        "Chọn thời gian kết thúc không vượt hiện tại.",
      );
    const result = await db.$transaction(
      async (tx) => {
        const device = await tx.device.findUnique({ where: { id } });
        if (!device)
          throw new ApiError(404, "NOT_FOUND", "Không tìm thấy thiết bị.");
        const [raw, baseline, statuses, configs, rolled] = await Promise.all([
          tx.sensorReading.findMany({
            where: { deviceId: id, receivedAt: { gte: from, lt: to } },
            orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
            take: 30001,
          }),
          tx.deviceStatusHistory.findFirst({
            where: { deviceId: id, effectiveAt: { lt: from } },
            orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
          }),
          tx.deviceStatusHistory.findMany({
            where: { deviceId: id, effectiveAt: { gte: from, lt: to } },
            orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
            take: 10001,
          }),
          tx.deviceConfig.findMany({
            where: { deviceId: id },
            orderBy: { version: "desc" },
            take: 1001,
          }),
          tx.sensorRollup.findFirst({
            where: {
              deviceId: id,
              timeBasis: "received",
              bucketStart: {
                gte: new Date(Math.floor(from.getTime() / 3600000) * 3600000),
                lt: to,
              },
            },
            select: { deviceId: true },
          }),
        ]);
        const readings = raw.slice(0, 30000).map((r) => ({
          id: String(r.id),
          received_at: r.receivedAt.toISOString(),
          payload: r.payload as unknown as Reading,
        }));
        const input: DiagnosticInput = {
          readings,
          interval_ms: device.reportingIntervalMs,
          created_at: device.createdAt.toISOString(),
          intervals: Object.fromEntries(
            configs
              .slice(0, 1000)
              .map((c) => [
                c.version,
                (c.config as { reporting_interval_ms: number })
                  .reporting_interval_ms,
              ]),
          ),
          baseline: baseline
            ? {
                effective_at: baseline.effectiveAt.toISOString(),
                status: baseline.newStatus,
              }
            : null,
          statuses: statuses.slice(0, 10000).map((s) => ({
            effective_at: s.effectiveAt.toISOString(),
            status: s.newStatus,
          })),
        };
        return {
          ...analyzeDiagnostics(input, query),
          source_kind: device.sourceKind,
          completeness: {
            truncated: raw.length > 30000,
            rolled_up: !!rolled,
            status_truncated: statuses.length > 10000,
            config_truncated:
              configs.length > 1000 ||
              readings.some(
                (r) => input.intervals[r.payload.config_version] === undefined,
              ),
            first_received_at: readings[0]?.received_at ?? null,
            last_received_at: readings.at(-1)?.received_at ?? null,
          },
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 20000 },
    );
    // An incomplete prefix cannot produce current advice or full-window connectivity totals.
    if (
      result.completeness.truncated ||
      result.completeness.rolled_up ||
      result.completeness.status_truncated ||
      result.completeness.config_truncated
    )
      result.notices = [];
    reply(res, result);
  });
}
