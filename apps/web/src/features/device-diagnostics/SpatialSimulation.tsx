import { useEffect, useRef, useState } from "react";
import type { DeviceView } from "@iot/contracts";
import {
  evolve,
  interpolate,
  type Point,
  type SimulationOptions,
} from "./simulation/engine.js";
import { date, Table } from "./shared.js";
import { DistributionMap } from "./DistributionMap.js";
const SIZE = 48;
const initialSteps = 160;
const demoSensors = [
  { name: "Cạnh cửa", x: 0.12, y: 0.18, mq2: 420, mq7: 360 },
  { name: "Cạnh bàn", x: 0.5, y: 0.24, mq2: 1480, mq7: 850 },
  { name: "Gần bếp", x: 0.82, y: 0.28, mq2: 3660, mq7: 2640 },
  { name: "Giữa phòng", x: 0.47, y: 0.58, mq2: 1920, mq7: 1360 },
  { name: "Cạnh cửa sổ", x: 0.19, y: 0.84, mq2: 660, mq7: 520 },
  { name: "Góc cuối phòng", x: 0.76, y: 0.79, mq2: 2320, mq7: 1740 },
];

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
  const [grid, setGrid] = useState<Float32Array>(() =>
    evolve(new Float32Array(SIZE * SIZE), {
      size: SIZE,
      steps: initialSteps,
      source: true,
      ventilation: 0,
      airflow: 1,
      x: 0.3,
      y: 0.55,
      strength: 85,
    }),
  );
  const [steps, setSteps] = useState(initialSteps);
  const [source, setSource] = useState(true);
  const [ventilation, setVentilation] = useState(0);
  const [airflow, setAirflow] = useState(1);
  const [sourceX, setSourceX] = useState(0.3);
  const [sourceY, setSourceY] = useState(0.55);
  const [strength, setStrength] = useState(85);
  const [metric, setMetric] = useState<"mq2" | "mq7">("mq2");
  const [kind, setKind] = useState<"physical" | "simulator" | "example">(
    "physical",
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [fallback, setFallback] = useState(false);
  const positionKey = `airguard.diagnostics.positions.v1.${userId}`;
  const [positions, setPositions] = useState(() => readPositions(positionKey));
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
    setMessage("");
    setPoints([]);
    const empty = new Float32Array(SIZE * SIZE);
    empty.fill(-1);
    setGrid(empty);
    currentGrid.current = empty;
  }
  function capture() {
    if (kind === "example") {
      const mapped = demoSensors.map((p, i) => ({
        id: String(i),
        name: p.name,
        x: p.x,
        y: p.y,
        value: (p[metric] / 4095) * 100,
      }));
      showSurface(mapped);
      setMessage("Đang dùng 6 số đo giả lập 12 bit trong cùng một phòng.");
      return;
    }
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
    showSurface(mapped);
    setMessage("Đã chụp tín hiệu. Bấm Lấy số đo mới để cập nhật bề mặt.");
  }
  function showSurface(mapped: Point[]) {
    setPoints(mapped);
    setSnapshot(new Date().toISOString());
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
          <DistributionMap
            grid={grid}
            size={SIZE}
            scenario={mode === "scenario"}
            airflow={airflow}
            sensorName={metric === "mq2" ? "MQ-2" : "MQ-7"}
            points={
              mode === "sensors"
                ? points
                : [
                    {
                      id: "source",
                      name: "Nguồn minh họa",
                      x: sourceX,
                      y: sourceY,
                      value: strength,
                    },
                  ]
            }
            caption={
              mode === "scenario"
                ? `Kịch bản minh họa · ${steps} bước tính`
                : snapshot
                  ? kind === "example"
                    ? "Bộ số đo mẫu · 6 điểm trong một phòng minh họa"
                    : `Ảnh chụp tín hiệu lúc ${date(snapshot)}`
                  : "Chọn nguồn dữ liệu để tạo bản đồ."
            }
          />
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
                <li>Bấm Bắt đầu để xem tín hiệu tiếp tục lan từ điểm Nguồn.</li>
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
                    setKind(
                      e.target.value as "physical" | "simulator" | "example",
                    );
                    setSelected([]);
                    clearSnapshot();
                  }}
                >
                  <option value="physical">Thiết bị thật</option>
                  <option value="simulator">Thiết bị mô phỏng</option>
                  <option value="example">Bộ số đo mẫu · 6 điểm</option>
                </select>
              </label>
              {kind === "example" ? (
                <p>
                  Sáu vị trí trong một phòng giả định. Các giá trị MQ-2 và MQ-7
                  được tạo để thử bản đồ.
                </p>
              ) : (
                <>
                  <p>
                    Chọn 3–8 điểm. Tọa độ chỉ phục vụ thử nghiệm trên lưới,
                    không sửa sơ đồ phòng.
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
                                      move(
                                        d.id,
                                        "x",
                                        e.target.valueAsNumber,
                                        i,
                                      );
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
                                      move(
                                        d.id,
                                        "y",
                                        e.target.valueAsNumber,
                                        i,
                                      );
                                  }}
                                />
                              </label>
                            </div>
                          ) : null}
                        </div>
                      ))
                  ) : (
                    <p>
                      Chưa có thiết bị thuộc nguồn đã chọn. Bạn có thể thử kịch
                      bản minh họa.
                    </p>
                  )}
                </>
              )}
              <button className="primary" onClick={capture}>
                {kind === "example" ? "Xem bộ số đo mẫu" : "Lấy số đo mới"}
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
