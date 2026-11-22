import { type ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, Clock3, Cpu, MapPin, ShieldCheck } from "lucide-react";
import type { IncidentDetail, UserView } from "@iot/contracts";
import { dateText } from "../../components/FeatureUI.js";
import { IncidentSupportContent } from "./IncidentSupport.js";
import {
  incidentLocationText,
  useIncidentSupport,
} from "./incident-support.js";
import {
  IncidentReceiptAction,
  IncidentReceiptTeam,
  useIncidentReceipt,
} from "./IncidentReceipt.js";
import { IncidentDeliveryHistory } from "../notification-center/DeliveryHistoryPage.js";
import "./incident-detail.css";

const titles = {
  gas: "Cảnh báo khí ga",
  co: "Cảnh báo khí CO",
  flame: "Phát hiện lửa",
};

export function IncidentDetails({
  incident,
  user,
  acknowledgement,
}: {
  incident: IncidentDetail;
  user: UserView;
  acknowledgement: ReactNode;
}) {
  const receipt = useIncidentReceipt(incident.id, user.id);
  const support = useIncidentSupport(incident.id);
  const location = support.isSuccess ? support.data.location : undefined;
  const active = incident.status === "active";
  return (
    <>
      <section
        className="panel ag-incident-hero"
        data-severity={incident.severity}
      >
        <div className="ag-incident-heading">
          <span className="ag-incident-symbol">
            <AlertTriangle aria-hidden="true" size={28} />
          </span>
          <div>
            <h1>{titles[incident.condition]}</h1>
            <div className="ag-incident-badges">
              <span className="ag-incident-tag ag-incident-level">
                {incident.severity === "critical" ? "Nghiêm trọng" : "Cảnh báo"}
              </span>
              <span
                className="ag-incident-tag ag-incident-state"
                data-active={active}
              >
                {active ? "Chưa kết thúc" : "Đã kết thúc"}
              </span>
              {incident.source_kind === "simulator" ? (
                <span className="ag-incident-tag">Dữ liệu mô phỏng</span>
              ) : null}
            </div>
          </div>
        </div>
        <dl className="ag-incident-context">
          <div>
            <dt>
              <MapPin size={17} aria-hidden="true" /> Vị trí hiện tại
            </dt>
            <dd>
              {location
                ? incidentLocationText(location)
                : support.isPending
                  ? "Đang tải…"
                  : "Chưa xác minh được vị trí"}
            </dd>
          </div>
          <div>
            <dt>
              <Cpu size={17} aria-hidden="true" /> Thiết bị
            </dt>
            <dd>
              <Link to={`/app/devices/${incident.device_id}`}>
                {incident.device_name}
              </Link>
            </dd>
          </div>
        </dl>
      </section>
      <div className="ag-incident-columns">
        <div className="ag-incident-actions">
          <section className="panel ag-incident-card ag-incident-handling">
            <h2>
              <ShieldCheck size={22} aria-hidden="true" /> Xử lý sự cố
            </h2>
            <div className="ag-incident-step">
              <h3>Tiếp nhận của bạn</h3>
              <IncidentReceiptAction {...receipt} />
            </div>
            <div className="ag-incident-step">
              <h3>Xác nhận nghiệp vụ</h3>
              {acknowledgement}
            </div>
            <p className="caption">
              Xác nhận đã xem chỉ ghi lại thao tác, trạng thái phục hồi và còi
              thiết bị vẫn theo dữ liệu thiết bị.
            </p>
            <IncidentReceiptTeam receipts={receipt.receipts} />
          </section>
          <IncidentSupportContent support={support} />
        </div>
        <div className="ag-incident-history">
          <IncidentTimeline incident={incident} />
          <IncidentDeliveryHistory incidentId={incident.id} user={user} />
        </div>
      </div>
    </>
  );
}

function IncidentTimeline({ incident }: { incident: IncidentDetail }) {
  const events = incident.events ?? [];
  const start =
    incident.started_at ??
    events.find((event) => event.transition === "started")?.occurred_at;
  const recovery = events.find((event) => event.transition === "ended");
  const end = incident.ended_at ?? recovery?.occurred_at;
  const seconds =
    start && end
      ? Math.round((Date.parse(end) - Date.parse(start)) / 1000)
      : NaN;

  return (
    <section className="panel ag-incident-card">
      <h2>
        <Clock3 size={22} aria-hidden="true" /> Diễn biến sự cố
      </h2>
      <ol className="ag-incident-timeline">
        <li>
          <strong>Bắt đầu</strong>
          {start ? (
            <p>
              <span>Giờ thiết bị</span>{" "}
              <time dateTime={start}>{dateText(start)}</time>
            </p>
          ) : (
            <p className="caption">Chưa có thời điểm bắt đầu từ thiết bị.</p>
          )}
          <p>
            <span>Máy chủ quan sát lần đầu</span>{" "}
            <time dateTime={incident.first_observed_at}>
              {dateText(incident.first_observed_at)}
            </time>
          </p>
        </li>
        <li>
          <strong>Phục hồi</strong>
          {end ? (
            <p>
              <span>Giờ thiết bị</span>{" "}
              <time dateTime={end}>{dateText(end)}</time>
            </p>
          ) : (
            <p className="caption">Chưa ghi nhận thời điểm phục hồi</p>
          )}
          {recovery ? (
            <p>
              <span>Máy chủ nhận</span>{" "}
              <time dateTime={recovery.received_at}>
                {dateText(recovery.received_at)}
              </time>
            </p>
          ) : null}
          {seconds >= 0 ? (
            <p>
              <span>Thời lượng</span> {Math.floor(seconds / 60)} phút{" "}
              {seconds % 60} giây
            </p>
          ) : null}
        </li>
      </ol>
      <details className="ag-incident-disclosure">
        <summary>Chi tiết kỹ thuật</summary>
        <p>ID sự cố · {incident.id}</p>
        <p>Nguồn · {incident.origin}</p>
        {events.map((event) => (
          <p key={event.id}>
            {event.transition === "started" ? "Bắt đầu" : "Phục hồi"} · Máy chủ
            nhận {dateText(event.received_at)} · seq {event.seq}
          </p>
        ))}
      </details>
    </section>
  );
}
