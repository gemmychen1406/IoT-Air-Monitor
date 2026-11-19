import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsView } from "@iot/contracts";
import { chartTickInterval } from "./report-utils.js";
import { formatTime } from "./utils.js";

export function ReportChart({ data }: { data: AnalyticsView }) {
  return (
    <div
      className="cr-report-chart-canvas"
      aria-label={`Biểu đồ ${data.metric}`}
    >
      <ResponsiveContainer width="100%" height={220}>
        <LineChart
          data={data.series}
          margin={{ top: 8, right: 20, bottom: 18, left: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="bucket_start"
            interval={chartTickInterval(data.series.length)}
            minTickGap={18}
            tickMargin={8}
            tickFormatter={(value) =>
              new Date(String(value)).toLocaleDateString("vi-VN", {
                day: "2-digit",
                month: "2-digit",
              })
            }
          />
          <YAxis width={58} unit={data.unit === "ADC" ? "" : data.unit} />
          <Tooltip labelFormatter={(value) => formatTime(String(value))} />
          <Line
            type="linear"
            dataKey="average"
            stroke="#118c75"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
