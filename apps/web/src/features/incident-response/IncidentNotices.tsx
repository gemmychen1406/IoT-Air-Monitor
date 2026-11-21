import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { IncidentView } from '@iot/contracts';
import { apiPage } from '../../lib/api.js';
import { incidentLocationText, useIncidentSupport } from './incident-support.js';
import './styles.css';

const labels = { gas: 'Phát hiện khí gas', co: 'CO', flame: 'Phát hiện lửa' };
const listPath = '/alerts/incidents';

export function useIncidentNotices(sessionKey?: string, path = '') {
  const refresh = useRef<(() => void) | null>(null);
  const [feed, setFeed] = useState<{
    sessionKey: string;
    notices: IncidentView[];
  }>();

  useEffect(() => {
    if (!sessionKey) return;
    const key = sessionKey;
    const controller = new AbortController();
    const { signal } = controller;
    const seen = new Set<string>();
    let since = Number.NaN;
    let fetching = false;
    let queued = false;

    async function poll() {
      queued = true;
      if (fetching || signal.aborted) return;
      fetching = true;
      try {
        while (queued && !signal.aborted) {
          queued = false;
          if (!Number.isFinite(since)) {
            const baseline = await apiPage<IncidentView[]>(
              `${listPath}?limit=1`,
              { signal },
            );
            // Compare the server's observation time, including for delayed device samples.
            since = Date.parse(baseline.meta.server_time ?? '');
            continue;
          }
          const incoming: IncidentView[] = [];
          let cursor: string | null | undefined;
          do {
            const { data, meta } = await apiPage<IncidentView[]>(
              `${listPath}?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
              { signal },
            );
            const recent = data.filter(
              (row) => Date.parse(row.first_observed_at) > since,
            );
            incoming.push(...recent.filter((row) => !seen.has(row.id)));
            cursor =
              recent.length === data.length ? meta.next_cursor : undefined;
          } while (cursor && !signal.aborted);
          if (!signal.aborted && incoming.length) {
            for (const incident of incoming) seen.add(incident.id);
            setFeed((current) => ({
              sessionKey: key,
              notices: [
                ...incoming,
                ...(current?.sessionKey === key ? current.notices : []),
              ],
            }));
          }
        }
      } catch {
        // A reconnect or the next Socket.IO alert will retry via the authenticated API.
      } finally {
        fetching = false;
      }
    }

    refresh.current = () => void poll();
    refresh.current();
    return () => {
      controller.abort();
      refresh.current = null;
    };
  }, [sessionKey]);

  const notices = feed?.sessionKey === sessionKey ? (feed?.notices ?? []) : [];
  return {
    refresh,
    banner: notices.filter(row => path.replace(/\/$/, '') !== `/app/alerts/${row.id}`).map((incident) => (
      <IncidentNotice
        key={incident.id}
        incident={incident}
        dismiss={() =>
          setFeed(
            (current) =>
              current && {
                ...current,
                notices: current.notices.filter(
                  (row) => row.id !== incident.id,
                ),
              },
          )
        }
      />
    )),
  };
}

function IncidentNotice({
  incident,
  dismiss,
}: {
  incident: IncidentView;
  dismiss: () => void;
}) {
  const support = useIncidentSupport(incident.id, false);
  const position = support.isSuccess ? support.data.location : undefined;
  const location =
    position?.source === 'assignment' ? incidentLocationText(position) : '';
  return (
    <div className="notice ag-incident-notice" data-severity={incident.severity} role="status">
      <Link className="ag-incident-notice-summary" to={`/app/alerts/${incident.id}`}>
        <strong>{labels[incident.condition]} · {incident.severity === 'critical' ? 'Nghiêm trọng' : 'Cảnh báo'}</strong>
        <span>{[incident.device_name, location, incident.source_kind === 'simulator' && 'Mô phỏng',
          incident.status === 'ended' && 'Đã kết thúc'].filter(Boolean).join(' · ')}</span>
      </Link>
      <button type="button" onClick={dismiss} aria-label="Đóng thông báo">
        Đóng
      </button>
    </div>
  );
}
