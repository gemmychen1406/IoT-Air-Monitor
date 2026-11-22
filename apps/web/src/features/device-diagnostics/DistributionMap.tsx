import { useEffect, useRef, useState } from "react";
import { interpolate, type Point } from "./simulation/engine.js";
import type { Measurement } from "./room-distribution.js";
import { Layers, MapPin } from "lucide-react";
import { RoomSymbol } from "./RoomSymbol.js";

const size = 64;
const stops = [
  [242, 247, 229],
  [177, 222, 188],
  [88, 184, 169],
  [41, 130, 145],
  [30, 75, 110],
];
function paint(canvas: HTMLCanvasElement, grid: Float32Array) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.createImageData(size, size);
  grid.forEach((value, i) => {
    if (value < 0) return;
    const t = Math.min(4, Math.max(0, value / 25)),
      lo = Math.min(3, Math.floor(t));
    for (let k = 0; k < 3; k++)
      image.data[i * 4 + k] =
        stops[lo]![k]! + (stops[lo + 1]![k]! - stops[lo]![k]!) * (t - lo);
    image.data[i * 4 + 3] = 255;
  });
  ctx.putImageData(image, 0, 0);
}

export function DistributionMap({
  points,
  anchors,
  surface,
  roomName,
  onInspect,
}: {
  points: Measurement[];
  anchors: Point[];
  surface: boolean;
  roomName: string;
  onInspect: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [id, select] = useState("");
  const [showField, setShowField] = useState(true);
  const estimated = surface && showField;
  const highest = points.reduce<Measurement | undefined>(
    (peak, p) => (!peak || p.value > peak.value ? p : peak),
    undefined,
  );
  const point = points.find((p) => p.id === id);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    el.getContext("2d")?.clearRect(0, 0, size, size);
    if (!estimated) return;
    let worker: Worker | undefined;
    const fallback = () => paint(el, interpolate(anchors, size));
    try {
      worker = new Worker(new URL("./simulation/worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (e) => paint(el, e.data.grid);
      worker.onerror = fallback;
      worker.postMessage({ id: 1, mode: "sensors", points: anchors, size });
    } catch {
      fallback();
    }
    return () => {
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      }
    };
  }, [anchors, estimated]);
  return (
    <figure className="dd-room-field">
      <header className="dd-plan-head">
        <div>
          <small>Sơ đồ vị trí trạm</small>
          <h3 className="dd-room-meta">
            <RoomSymbol name={roomName} />
            {roomName}
          </h3>
        </div>
        <div className="dd-plan-switch" role="group" aria-label="Lớp bản đồ">
          <button aria-pressed={!estimated} onClick={() => setShowField(false)}>
            <MapPin size={16} aria-hidden="true" /> Điểm đo
          </button>
          <button
            disabled={!surface}
            aria-pressed={estimated}
            onClick={() => setShowField(true)}
          >
            <Layers size={16} aria-hidden="true" /> Vùng ước tính
          </button>
        </div>
      </header>
      {highest && points.length > 1 && (
        <p className="dd-field-reading">
          {points.every((p) => p.value === highest.value)
            ? "Các vị trí có cùng mức tín hiệu"
            : "Điểm đo cao nhất · " + highest.name}{" "}
          ·{" "}
          <strong>
            {highest.value.toLocaleString("vi-VN", {
              maximumFractionDigits: 1,
            })}
            % ADC
          </strong>
        </p>
      )}
      <div className="dd-plan-sheet">
        <div className="dd-floor" data-estimated={estimated}>
          <canvas aria-hidden="true" width={size} height={size} ref={canvas} />
          {points.map((p, i) => (
            <button
              className="dd-pin"
              key={p.id}
              style={{ left: p.x * 100 + "%", top: p.y * 100 + "%" }}
              aria-label={p.name + " · " + p.value.toFixed(1) + "% ADC"}
              aria-pressed={p.id === id}
              onClick={() => select(p.id)}
            >
              {i + 1}
              <span
                className="dd-pin-label"
                data-left={p.x > 0.58}
                data-up={p.y > 0.5}
              >
                {p.name}
              </span>
            </button>
          ))}
        </div>
      </div>
      <figcaption>
        {estimated ? (
          <>
            0% <span className="dd-ramp" /> 100% ADC{" "}
            <span className="dd-hatch-key" /> Thiếu độ phủ
          </>
        ) : (
          "Các chấm là vị trí trạm trên sơ đồ phòng."
        )}
      </figcaption>
      {points.length > 0 && (
        <div className="dd-point-list">
          {points.map((p, i) => (
            <button
              key={p.id}
              aria-pressed={id === p.id}
              onClick={() => select(p.id)}
            >
              {i + 1}. {p.name} · {p.value.toFixed(1)}%
            </button>
          ))}
        </div>
      )}
      {point && (
        <article className="dd-point-detail">
          <strong>{point.name}</strong>
          <span>
            {point.value.toFixed(1)}% ADC · Đo lúc{" "}
            {new Date(point.sampledAt).toLocaleTimeString("vi-VN")}
          </span>
          <button onClick={() => onInspect(point.id)}>Xem chẩn đoán</button>
        </article>
      )}
    </figure>
  );
}
