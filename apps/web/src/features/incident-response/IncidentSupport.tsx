import { useRef, useState } from "react";
import { ContactRound } from "lucide-react";
import { canonicalPhone, type ContactView } from "@iot/contracts";
import { LoadState } from "../../components/FeatureUI.js";
import {
  incidentLocationText,
  useIncidentSupport,
} from "./incident-support.js";
import "./styles.css";

const scopeLabel = { room: "Phòng", area: "Khu vực", global: "Chung" };

function ContactActions({ contact }: { contact: ContactView }) {
  const number = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState("");
  const [copying, setCopying] = useState(false);
  if (!canonicalPhone.test(contact.phone)) return null;

  async function copyPhone() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(contact.phone);
      setFeedback("Đã sao chép số.");
    } catch {
      number.current?.focus();
      number.current?.select();
      setFeedback(
        "Số đã được chọn. Nhấn Ctrl+C hoặc dùng lệnh Sao chép của thiết bị.",
      );
    } finally {
      setCopying(false);
    }
  }
  return (
    <div className="ag-support-actions">
      <input
        ref={number}
        readOnly
        value={contact.phone}
        aria-label={`Số điện thoại của ${contact.name}`}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="button-row">
        <a href={`tel:${contact.phone}`}>Gọi</a>
        <button disabled={copying} onClick={() => void copyPhone()}>
          Sao chép số
        </button>
      </div>
      {feedback ? <small role="status">{feedback}</small> : null}
    </div>
  );
}

export default function IncidentSupport({
  incidentId,
}: {
  incidentId: string;
}) {
  const support = useIncidentSupport(incidentId);
  return <IncidentSupportContent support={support} />;
}

export function IncidentSupportContent({
  support,
}: {
  support: ReturnType<typeof useIncidentSupport>;
}) {
  const data = support.isSuccess ? support.data : undefined;
  const location = data?.location;
  return (
    <section
      className="panel feature-section ag-incident-support"
      aria-label="Liên hệ hỗ trợ"
    >
      <h2>
        <ContactRound size={22} aria-hidden="true" /> Liên hệ hỗ trợ
      </h2>
      <LoadState
        pending={support.isPending}
        error={support.error}
        retry={() => void support.refetch()}
      />
      {data && location && data.contacts.length ? (
        <>
          <p>
            <strong>Vị trí hiện tại của thiết bị </strong>
            {incidentLocationText(location)}
          </p>
          {location.source === "assignment" && location.description ? (
            <p>{location.description}</p>
          ) : null}
          <ul className="ag-contact-list">
            {data.contacts.map((contact) => (
              <li key={contact.id}>
                <div>
                  <strong>{contact.name}</strong>
                  <p>
                    {contact.role} · {scopeLabel[contact.scope.kind]}
                  </p>
                  {contact.description ? <p>{contact.description}</p> : null}
                </div>
                <ContactActions key={contact.phone} contact={contact} />
              </li>
            ))}
          </ul>
        </>
      ) : data ? (
        <p className="muted">Chưa có liên hệ hỗ trợ cho vị trí này.</p>
      ) : null}
    </section>
  );
}
