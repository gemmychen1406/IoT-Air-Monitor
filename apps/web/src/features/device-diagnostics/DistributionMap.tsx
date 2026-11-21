import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Point } from "./simulation/engine.js";

// Shared stops for the raster and its scale. Keep the range fixed across snapshots.
const stops = [
  "#fff9ef",
  "#ffefd8",
  "#ffdfae",
  "#ffcb86",
  "#fab460",
  "#ee9941",
  "#dc7c2d",
  "#c36021",
  "#a64a1b",
  "#833519",
  "#612518",
];
const ticks = [0, 25, 50, 75, 100];
const resolution = 320;
const unknownStripe = [126, 136, 149],
  unknownBackground = [73, 83, 98];
const palette = Array.from({ length: 101 }, (_, n) => {
  const band = Math.min(9, Math.floor(n / 10));
  const mix = (n - band * 10) / 10;
  return [1, 3, 5].map((i) => {
    const low = parseInt(stops[band]!.slice(i, i + 2), 16);
    const high = parseInt(stops[band + 1]!.slice(i, i + 2), 16);
    return Math.round(low + (high - low) * mix);
  });
});

// Interpolate only supported nodes. This same lookup drives the map and the point reader.
function at(grid: Float32Array, size: number, x: number, y: number) {
  const gx = x * (size - 1),
    gy = y * (size - 1);
  const col = Math.floor(gx),
    row = Math.floor(gy);
  const dx = gx - col,
    dy = gy - row;
  const i = row * size + col;
  const right = Math.min(col + 1, size - 1);
  const below = Math.min(row + 1, size - 1) * size;
  const a = grid[i]!,
    b = grid[row * size + right]!;
  const c = grid[below + col]!,
    d = grid[below + right]!;
  if (a < 0 || (dx > 0 && b < 0) || (dy > 0 && c < 0) || (dx * dy > 0 && d < 0))
    return -1;
  return (a * (1 - dx) + b * dx) * (1 - dy) + (c * (1 - dx) + d * dx) * dy;
}

export function DistributionMap({
  grid,
  size,
  points,
  scenario,
  caption,
  airflow,
  sensorName,
}: {
  grid: Float32Array;
  size: number;
  points: Point[];
  scenario: boolean;
  caption: string;
  airflow: number;
  sensorName: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [probe, setProbe] = useState({ x: 50, y: 50 });
  const [contours, setContours] = useState(true);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const frame = ctx.createImageData(resolution, resolution);
    const previousRow = new Int8Array(resolution).fill(-1);
    for (let y = 0; y < resolution; y++) {
      let previousBand = -1;
      for (let x = 0; x < resolution; x++) {
        const value = at(
          grid,
          size,
          x / (resolution - 1),
          y / (resolution - 1),
        );
        const band = value < 0 ? -1 : Math.min(3, Math.floor(value / 25));
        const above = previousRow[x]!;
        const edge =
          band >= 0 &&
          ((previousBand >= 0 && previousBand !== band) ||
            (above >= 0 && above !== band));
        previousBand = previousRow[x] = band;
        const color =
          value < 0
            ? (x + y) % 12 < 2
              ? unknownStripe
              : unknownBackground
            : palette[Math.round(value)]!;
        const i = (y * resolution + x) * 4;
        frame.data[i] = contours && edge ? 250 : color[0]!;
        frame.data[i + 1] = contours && edge ? 250 : color[1]!;
        frame.data[i + 2] = contours && edge ? 250 : color[2]!;
        frame.data[i + 3] = 255;
      }
    }
    ctx.putImageData(frame, 0, 0);
  }, [grid, size, contours]);
  function navigate(e: KeyboardEvent<HTMLButtonElement>) {
    const step = e.shiftKey ? 10 : 1;
    const offsets: Record<string, number[]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = offsets[e.key];
    if (!delta) return;
    e.preventDefault();
    setProbe((p) => ({
      x: Math.max(0, Math.min(100, p.x + delta[0]!)),
      y: Math.max(0, Math.min(100, p.y + delta[1]!)),
    }));
  }
  const value = at(grid, size, probe.x / 100, probe.y / 100);
  let reading: string;
  if (scenario) {
    const peak = grid.indexOf(Math.max(...grid));
    const x = (peak % size) / (size - 1);
    const y = Math.floor(peak / size) / (size - 1);
    const column = x < 1 / 3 ? "bên trái" : x > 2 / 3 ? "bên phải" : "ở giữa";
    const row =
      y < 1 / 3 ? "phía trên" : y > 2 / 3 ? "phía dưới" : "ngang giữa";
    reading =
      grid[peak]! < 0.05
        ? "Hiện khắp phòng gần như chưa có tín hiệu. Bật nguồn và bấm Bắt đầu để xem màu lan ra."
        : x >= 1 / 3 && x <= 2 / 3 && y >= 1 / 3 && y <= 2 / 3
          ? "Hiện tín hiệu mô phỏng mạnh nhất ở giữa phòng."
          : `Hiện tín hiệu mô phỏng mạnh nhất ở ${y >= 1 / 3 && y <= 2 / 3 ? "vùng " + column : row + (column === "ở giữa" ? ", gần trục giữa" : " " + column)} của phòng.`;
  } else if (points.length) {
    const highest = Math.max(...points.map((p) => p.value));
    const leaders = points.filter((p) => p.value === highest);
    reading =
      leaders.length === points.length
        ? `Cả ${points.length} điểm đều có cùng mức tín hiệu ${sensorName}.`
        : `Trong các điểm đã chọn, ${leaders.map((p) => p.name).join(", ")} có tín hiệu ${sensorName} cao nhất.`;
  } else {
    reading =
      "Chưa có số đo trên bản đồ. Chọn Bộ số đo mẫu để xem thử, hoặc lấy số đo từ thiết bị của bạn.";
  }
  return (
    <figure className="dd-figure dd-distribution">
      <header>
        <strong>
          {scenario
            ? "Khí từ nguồn lan tới đâu trong phòng?"
            : `Ở đâu cảm biến ${sensorName} ghi nhận tín hiệu cao hơn?`}
        </strong>
        {scenario && (
          <span>
            {airflow === 0
              ? "Gió ngang tắt"
              : airflow > 0
                ? "Gió sang phải →"
                : "← Gió sang trái"}
          </span>
        )}
      </header>
      <p className="dd-map-intro">
        {scenario
          ? "Hãy hình dung bạn đang nhìn căn phòng từ trên xuống. Điểm Nguồn là nơi khí giả lập phát ra. Màu càng đậm, tín hiệu mô phỏng tại đó càng mạnh."
          : "Mỗi chấm có số là một vị trí cảm biến. Màu càng đậm, tín hiệu càng cao. Màu giữa các chấm được ước tính từ các điểm đo xung quanh."}
      </p>
      <p className="dd-map-reading">{reading}</p>
      <div className="dd-axis-title">X · Chiều ngang (%)</div>
      <div className="dd-map-frame">
        <div className="dd-x-axis">
          {ticks.map((v) => (
            <span key={v} style={{ left: v + "%" }}>
              {v}
            </span>
          ))}
        </div>
        <div className="dd-y-axis">
          {ticks.map((v) => (
            <span key={v} style={{ top: v + "%" }}>
              {v}
            </span>
          ))}
        </div>
        <button
          className="dd-map-surface"
          aria-label="Chọn điểm trên bản đồ. Dùng các phím mũi tên để đọc tín hiệu."
          onKeyDown={navigate}
          onClick={(e) => {
            if (!e.detail) return;
            const r = e.currentTarget.getBoundingClientRect();
            const percent = (v: number) =>
              Math.max(0, Math.min(100, Math.round(v * 100)));
            setProbe({
              x: percent((e.clientX - r.left) / r.width),
              y: percent((e.clientY - r.top) / r.height),
            });
          }}
        >
          <canvas ref={canvas} width={resolution} height={resolution} />
          <span className="dd-map-grid" />
          {points.map((p, i) => (
            <span
              key={p.id}
              className={
                scenario ? "dd-map-marker dd-source-label" : "dd-map-marker"
              }
              title={p.name}
              style={{ left: p.x * 100 + "%", top: p.y * 100 + "%" }}
            >
              {scenario ? "Nguồn" : i + 1}
            </span>
          ))}
          <span
            className="dd-map-probe"
            style={{ left: probe.x + "%", top: probe.y + "%" }}
          />
        </button>
      </div>
      <div className="dd-axis-note">Y · Chiều dọc (%) tăng từ trên xuống</div>
      <div className="dd-scale-title">
        {scenario ? "Mức tín hiệu giả lập" : "Tín hiệu (% toàn thang ADC)"}
      </div>
      <div
        className="dd-color-scale"
        style={{ background: "linear-gradient(90deg," + stops.join(",") + ")" }}
      />
      <div className="dd-scale-ticks">
        {ticks.map((v) => (
          <span key={v}>
            {v === 0 ? "0 · Thấp" : v === 100 ? "100 · Cao" : v}
          </span>
        ))}
      </div>
      {!scenario && <small>▧ Vùng gạch chéo chưa đủ dữ liệu</small>}
      <label className="dd-checkbox">
        <input
          type="checkbox"
          checked={contours}
          onChange={(e) => setContours(e.target.checked)}
        />
        Viền các vùng đạt mức 25, 50 và 75
      </label>
      <div className="dd-probe-readout">
        <b>Điểm đang xem</b> X {probe.x}% · Y {probe.y}%{" "}
        <strong>
          {value < 0
            ? "Chưa đủ dữ liệu"
            : value.toLocaleString("vi-VN", { maximumFractionDigits: 1 }) +
              (scenario ? " / 100" : "% ADC")}
        </strong>
      </div>
      <small>Chạm vào bản đồ hoặc dùng phím mũi tên để đọc từng điểm.</small>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
