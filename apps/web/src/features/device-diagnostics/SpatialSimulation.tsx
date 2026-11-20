import { useEffect, useRef, useState } from "react";
import type { DeviceView } from "@iot/contracts";
import {
  evolve,
  interpolate,
  type Point,
  type SimulationOptions,
} from "./simulation/engine.js";
import { date, Table } from "./shared.js";
const SIZE = 48;
type Position = { x: number; y: number };
function readPositions(key: string): Record<string, Position> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, p]) =>
          p &&
          typeof p.x === "number" &&
          typeof p.y === "number" &&
          p.x >= 0 &&
          p.x <= 1 &&
          p.y >= 0 &&
          p.y <= 1,
      ),
    );
  } catch {
    return {};
  }
}
export default function SpatialSimulation({
  devices,
  userId,
}: {
  devices: DeviceView[];
  userId: string;
}) {
  const [mode, setMode] = useState<"scenario" | "sensors">("scenario");
  const [running, setRunning] = useState(false);
  const [grid, setGrid] = useState<Float32Array>(
    () => new Float32Array(SIZE * SIZE),
  );
  const [steps, setSteps] = useState(0);
  const [source, setSource] = useState(true);
  const [ventilation, setVentilation] = useState(0);
  const [airflow, setAirflow] = useState(0);
  const [sourceX, setSourceX] = useState(0.3);
  const [sourceY, setSourceY] = useState(0.55);
  const [strength, setStrength] = useState(50);
  const [metric, setMetric] = useState<"mq2" | "mq7">("mq2");
  const [kind, setKind] = useState<"physical" | "simulator">("physical");
  const [selected, setSelected] = useState<string[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [fallback, setFallback] = useState(false);
  const positionKey = `airguard.diagnostics.positions.v1.${userId}`;
  const [positions, setPositions] = useState(() => readPositions(positionKey));
  const canvas = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const currentGrid = useRef(grid);
  const busy = useRef(false);
  const activeSteps = useRef(0);
  useEffect(() => {
    try {
      const instance = new Worker(
        new URL("./simulation/worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = instance;
      instance.onmessage = (
        event: MessageEvent<{ id: number; grid: Float32Array }>,
      ) => {
        if (event.data.id !== requestId.current) return;
        currentGrid.current = event.data.grid;
        setGrid(event.data.grid);
        busy.current = false;
        if (activeSteps.current) setSteps((s) => s + activeSteps.current);
      };
      instance.onerror = () => {
        instance.terminate();
        worker.current = null;
        busy.current = false;
        setFallback(true);
      };
      return () => {
        instance.terminate();
        worker.current = null;
      };
    } catch {
      worker.current = null;
    }
  }, []);
  useEffect(() => {
    if (!running || mode !== "scenario") return;
    const timer = window.setInterval(() => {
      if (busy.current) return;
      const options: SimulationOptions = {
        size: SIZE,
        steps: 4,
        source,
        ventilation,
        airflow,
        x: sourceX,
        y: sourceY,
        strength,
      };
      activeSteps.current = 4;
      if (worker.current) {
        busy.current = true;
        worker.current.postMessage({
          id: ++requestId.current,
          mode,
          grid: currentGrid.current,
          options,
        });
      } else {
        const next = evolve(currentGrid.current, options);
        currentGrid.current = next;
        setGrid(next);
        setSteps((s) => s + 4);
      }
    }, 160);
    return () => clearInterval(timer);
  }, [running, mode, source, ventilation, airflow, sourceX, sourceY, strength]);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const scale = 10;
    context.clearRect(0, 0, 480, 480);
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const v = grid[y * SIZE + x]!;
        context.fillStyle =
          v < 0
            ? "#39465b"
            : v < 50
              ? `rgb(${Math.round(22 + v * 1.2)},${Math.round(48 + v * 2.6)},${Math.round(85 + v * 0.8)})`
              : `rgb(${Math.round(82 + (v - 50) * 3.4)},${Math.round(178 - (v - 50) * 1.2)},${Math.round(125 - (v - 50) * 1.8)})`;
        context.fillRect(x * scale, y * scale, scale, scale);
      }
    context.strokeStyle = "rgba(255,255,255,.2)";
    context.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      context.beginPath();
      context.moveTo(i * 120, 0);
      context.lineTo(i * 120, 480);
      context.stroke();
      context.beginPath();
      context.moveTo(0, i * 120);
      context.lineTo(480, i * 120);
      context.stroke();
    }
    const markers =
      mode === "sensors"
        ? points
        : [
            {
              id: "source",
              name: source ? "Nguồn đang bật" : "Nguồn đã tắt",
              x: sourceX,
              y: sourceY,
              value: strength,
            },
          ];
    for (const [i, p] of markers.entries()) {
      const x = Math.max(16, Math.min(464, p.x * 480)),
        y = Math.max(16, Math.min(464, p.y * 480));
      context.beginPath();
      context.arc(x, y, 13, 0, Math.PI * 2);
      context.fillStyle = "#ffffff";
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = "#0b101a";
      context.stroke();
      context.font = "bold 13px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "#0b101a";
      context.fillText(mode === "sensors" ? String(i + 1) : "N", x, y);
    }
  }, [grid, mode, points, sourceX, sourceY, source, strength]);
  function reset() {
    setRunning(false);
    requestId.current++;
    busy.current = false;
    activeSteps.current = 0;
    const empty = new Float32Array(SIZE * SIZE);
    currentGrid.current = empty;
    setGrid(empty);
    setSteps(0);
    setPoints([]);
    setSnapshot(null);
    setMessage("Đã đặt lại mô phỏng.");
  }
  function position(id: string, index: number): Position {
    return (
      positions[id] ?? {
        x: [0.2, 0.8, 0.5, 0.2, 0.8, 0.5, 0.35, 0.65][index % 8]!,
        y: [0.2, 0.2, 0.8, 0.8, 0.8, 0.5, 0.45, 0.6][index % 8]!,
      }
    );
  }
  function move(id: string, axis: "x" | "y", value: number, index: number) {
    const next = {
      ...positions,
      [id]: {
        ...position(id, index),
        [axis]: Math.max(0, Math.min(1, value / 100)),
      },
    };
    setPositions(next);
    clearSnapshot();
    try {
      localStorage.setItem(positionKey, JSON.stringify(next));
    } catch {
      setMessage(
        "Vị trí chỉ giữ cho lần xem này vì trình duyệt không cho phép lưu.",
      );
    }
  }
  function clearSnapshot() {
    requestId.current++;
    busy.current = false;
    setSnapshot(null);
    setPoints([]);
    const empty = new Float32Array(SIZE * SIZE);
    empty.fill(-1);
    setGrid(empty);
    currentGrid.current = empty;
  }
  function capture() {
    const candidates = devices.filter(
      (d) => selected.includes(d.id) && d.source_kind === kind,
    );
    if (candidates.length < 3 || candidates.length > 8) {
      setMessage(
        "Chọn từ 3 đến 8 thiết bị cùng loại nguồn để tạo bề mặt minh họa.",
      );
      return;
    }
    const profiles = new Set<number>();
    const mapped: Point[] = [];
    const now = Date.now();
    for (const device of candidates) {
      const latest = device.latest,
        sensor = latest?.payload.sensors[metric];
      // age_ms is part of freshness; a fresh packet may carry an old sensor value.
      if (
        !latest ||
        !sensor ||
        device.status !== "online" ||
        !["valid", "uncalibrated"].includes(sensor.quality) ||
        sensor.adc_raw === null ||
        now - Date.parse(latest.received_at) + sensor.age_ms >
          Math.max(30000, (device.reporting_interval_ms ?? 5000) * 3)
      ) {
        setMessage(
          `${device.name} chưa có tín hiệu mới, sẵn sàng để dùng. Bỏ chọn thiết bị này hoặc chờ số đo mới.`,
        );
        return;
      }
      profiles.add(sensor.adc_bits);
      const index = devices
        .filter((d) => d.source_kind === kind)
        .findIndex((d) => d.id === device.id);
      mapped.push({
        id: device.id,
        name: device.name,
        ...position(device.id, index),
        value: (sensor.adc_raw / (2 ** sensor.adc_bits - 1)) * 100,
      });
    }
    if (profiles.size !== 1) {
      setMessage(
        "Các thiết bị có độ phân giải ADC khác nhau. Chọn thiết bị cùng độ phân giải.",
      );
      return;
    }
    let area = 0;
    for (const a of mapped)
      for (const b of mapped)
        for (const c of mapped)
          area = Math.max(
            area,
            Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)),
          );
    if (area < 0.02) {
      setMessage(
        "Các điểm quá gần nhau hoặc gần thẳng hàng. Hãy phân bố điểm rộng hơn trên lưới để minh họa.",
      );
      return;
    }
    setPoints(mapped);
    setSnapshot(new Date().toISOString());
    setMessage("Đã chụp tín hiệu. Bấm Lấy số đo mới để cập nhật bề mặt.");
    activeSteps.current = 0;
    if (worker.current)
      worker.current.postMessage({
        id: ++requestId.current,
        mode: "sensors",
        points: mapped,
        size: SIZE,
      });
    else {
      const next = interpolate(mapped, SIZE);
      currentGrid.current = next;
      setGrid(next);
    }
  }
  const values = Array.from(grid).filter((v) => v >= 0);
  const mean = values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
  return (
    <section className="panel dd-section">
      <h2>Mô phỏng phân bố trong không gian</h2>
      <p>
        Khám phá cách tín hiệu có thể lan rộng trên một vùng minh họa. Đây là
        công cụ học và quan sát giả định, không dùng để quyết định khu vực an
        toàn.
      </p>
      <div className="dd-mode" aria-label="Chế độ phân bố">
        <button
          aria-pressed={mode === "scenario"}
          onClick={() => {
            reset();
            setMode("scenario");
          }}
        >
          Thử kịch bản
        </button>
        <button
          aria-pressed={mode === "sensors"}
          onClick={() => {
            reset();
            setMode("sensors");
            clearSnapshot();
          }}
        >
          Từ tín hiệu cảm biến
        </button>
      </div>
      <div className="dd-spatial-layout">
        <div>
          <figure className="dd-figure">
            <canvas
              ref={canvas}
              width={480}
              height={480}
              role="img"
              aria-label={
                mode === "scenario"
                  ? `Mô phỏng ${steps} bước; tín hiệu trung bình ${mean?.toFixed(1) ?? "chưa có"} trên thang 0–100. Điểm N là nguồn minh họa. Chi tiết ở phần thông số và bảng bên dưới.`
                  : "Bề mặt nội suy tín hiệu cảm biến; các điểm có số tương ứng bảng số đo bên dưới, vùng xám chưa đủ điểm gần."
              }
            />
            <figcaption>
              {mode === "scenario"
                ? `Kịch bản minh họa · ${steps} bước tính · N: nguồn`
                : snapshot
                  ? `Ảnh chụp tín hiệu lúc ${date(snapshot)}`
                  : "Chọn thiết bị và lấy số đo để tạo bề mặt."}
            </figcaption>
          </figure>
          <div className="dd-legend">
            <span>0 · Thấp</span>
            <span>50</span>
            <span>100 · Cao</span>
          </div>
          <p className="dd-muted">
            Thang tương đối 0–100
            {mode === "sensors"
              ? "% toàn thang ADC; xám: chưa đủ điểm gần."
              : "; không có đơn vị nồng độ hoặc thời gian thực."}
          </p>
          <p aria-live="polite">
            {running
              ? "Đang chạy mô phỏng."
              : mode === "scenario"
                ? "Mô phỏng đang dừng."
                : snapshot
                  ? "Đang xem ảnh chụp; không tự cập nhật."
                  : "Chưa có ảnh chụp."}
          </p>
        </div>
        <div className="dd-simulation-controls">
          {mode === "scenario" ? (
            <>
              <h3>Thử từng bước</h3>
              <ol>
                <li>Bấm Bắt đầu để quan sát nguồn tạo tín hiệu.</li>
                <li>Tắt nguồn, rồi tăng thông gió để xem tín hiệu giảm.</li>
                <li>Đổi hướng luồng khí và so sánh vùng tín hiệu.</li>
              </ol>
              <div className="dd-actions">
                <button
                  className="primary"
                  onClick={() => setRunning((r) => !r)}
                >
                  {running ? "Tạm dừng" : "Bắt đầu"}
                </button>
                <button onClick={reset}>Đặt lại</button>
              </div>
              <label className="dd-checkbox">
                <input
                  type="checkbox"
                  checked={source}
                  onChange={(e) => setSource(e.target.checked)}
                />{" "}
                Bật nguồn minh họa
              </label>
              <label>
                Mức nguồn: {strength}
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={strength}
                  onChange={(e) => setStrength(Number(e.target.value))}
                />
              </label>
              <label>
                Thông gió: {["Tắt", "Nhẹ", "Vừa", "Mạnh"][ventilation]}
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={1}
                  value={ventilation}
                  onChange={(e) => setVentilation(Number(e.target.value))}
                />
              </label>
              <label>
                Luồng khí
                <select
                  aria-label="Luồng khí"
                  value={airflow}
                  onChange={(e) => setAirflow(Number(e.target.value))}
                >
                  <option value={-1}>Sang trái</option>
                  <option value={0}>Không có</option>
                  <option value={1}>Sang phải</option>
                </select>
              </label>
              <details>
                <summary>Vị trí nguồn trên lưới</summary>
                <label>
                  Ngang: {Math.round(sourceX * 100)}%
                  <input
                    type="range"
                    min={5}
                    max={95}
                    value={sourceX * 100}
                    onChange={(e) => setSourceX(Number(e.target.value) / 100)}
                  />
                </label>
                <label>
                  Dọc: {Math.round(sourceY * 100)}%
                  <input
                    type="range"
                    min={5}
                    max={95}
                    value={sourceY * 100}
                    onChange={(e) => setSourceY(Number(e.target.value) / 100)}
                  />
                </label>
              </details>
            </>
          ) : (
            <>
              <h3>Chọn tín hiệu đầu vào</h3>
              <label>
                Cảm biến
                <select
                  aria-label="Cảm biến"
                  value={metric}
                  onChange={(e) => {
                    setMetric(e.target.value as "mq2" | "mq7");
                    clearSnapshot();
                  }}
                >
                  <option value="mq2">Khí MQ-2</option>
                  <option value="mq7">CO MQ-7</option>
                </select>
              </label>
              <label>
                Nguồn dữ liệu
                <select
                  aria-label="Nguồn dữ liệu"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as "physical" | "simulator");
                    setSelected([]);
                    clearSnapshot();
                  }}
                >
                  <option value="physical">Thiết bị thật</option>
                  <option value="simulator">Thiết bị mô phỏng</option>
                </select>
              </label>
              <p>
                Chọn 3–8 điểm. Tọa độ chỉ phục vụ thử nghiệm trên lưới, không
                sửa sơ đồ phòng.
              </p>
              {devices.filter((d) => d.source_kind === kind).length ? (
                devices
                  .filter((d) => d.source_kind === kind)
                  .map((d, i) => (
                    <div className="dd-point-editor" key={d.id}>
                      <label className="dd-checkbox">
                        <input
                          type="checkbox"
                          checked={selected.includes(d.id)}
                          onChange={(e) => {
                            setSelected((ids) =>
                              e.target.checked
                                ? [...ids, d.id]
                                : ids.filter((id) => id !== d.id),
                            );
                            clearSnapshot();
                          }}
                        />
                        {d.name}
                      </label>
                      {selected.includes(d.id) ? (
                        <div className="dd-coordinate">
                          <label>
                            Ngang (%)
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={Math.round(position(d.id, i).x * 100)}
                              onChange={(e) => {
                                if (Number.isFinite(e.target.valueAsNumber))
                                  move(d.id, "x", e.target.valueAsNumber, i);
                              }}
                            />
                          </label>
                          <label>
                            Dọc (%)
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={Math.round(position(d.id, i).y * 100)}
                              onChange={(e) => {
                                if (Number.isFinite(e.target.valueAsNumber))
                                  move(d.id, "y", e.target.valueAsNumber, i);
                              }}
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>
                  ))
              ) : (
                <p>
                  Chưa có thiết bị thuộc nguồn đã chọn. Bạn có thể thử kịch bản
                  minh họa.
                </p>
              )}
              <button className="primary" onClick={capture}>
                Lấy số đo mới
              </button>
            </>
          )}
        </div>
      </div>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      {fallback ? (
        <p>
          Trình duyệt không khởi chạy được luồng nền. Đang dùng lưới nhỏ tính
          trực tiếp.
        </p>
      ) : null}
      {mode === "sensors" && points.length ? (
        <Table
          caption="Số đo dùng tạo bề mặt minh họa"
          headers={[
            "Điểm",
            "Thiết bị",
            "Tọa độ ngang / dọc",
            "Tín hiệu (% toàn thang ADC)",
          ]}
        >
          {points.map((p, i) => (
            <tr key={p.id}>
              <td>{i + 1}</td>
              <th scope="row">{p.name}</th>
              <td>
                {Math.round(p.x * 100)}% / {Math.round(p.y * 100)}%
              </td>
              <td>{p.value.toFixed(1)}</td>
            </tr>
          ))}
        </Table>
      ) : null}
      {mode === "scenario" ? (
        <Table
          caption="Tóm tắt trạng thái mô phỏng"
          headers={[
            "Bước tính",
            "Nguồn",
            "Trung bình lưới",
            "Cao nhất trên lưới",
          ]}
        >
          <tr>
            <td>{steps}</td>
            <td>{source ? "Đang bật" : "Đã tắt"}</td>
            <td>{mean?.toFixed(1) ?? "—"}</td>
            <td>{values.length ? Math.max(...values).toFixed(1) : "—"}</td>
          </tr>
        </Table>
      ) : null}
      <details>
        <summary>Phương pháp và giới hạn mô phỏng</summary>
        <p>
          Kịch bản: mô hình khuếch tán và vận chuyển theo luồng khí trên lưới 48
          × 48, dùng bước sai phân hữu hạn, nguồn và hệ số giảm tín hiệu minh
          họa. Biên kín; thông gió được mô hình hóa bằng giảm tín hiệu toàn
          vùng. Các hệ số chưa được hiệu chuẩn, không quy đổi thành m/s, phút
          hay ppm; chưa mô hình hóa tường, cửa, độ cao hoặc phản ứng hóa học.
        </p>
        <p>
          Từ cảm biến: nội suy IDW bậc 2 trên ảnh chụp tín hiệu mới, cùng loại
          cảm biến/nguồn/độ phân giải. Từ chối mẫu cũ hoặc chưa sẵn sàng. Vùng
          cách điểm gần nhất hơn 55% chiều rộng lưới được để xám. Khoảng cách
          gần điểm đo không chứng minh độ chính xác; các cảm biến cùng ADC cũng
          có thể khác độ nhạy.
        </p>
        <p>
          Tính toán bằng Web Worker, hiển thị Canvas 2D. Bảng kèm theo cung cấp
          thông tin bằng chữ. Không ghi kết quả vào dữ liệu đo hay phát cảnh báo
          phần cứng.
        </p>
      </details>
    </section>
  );
}
