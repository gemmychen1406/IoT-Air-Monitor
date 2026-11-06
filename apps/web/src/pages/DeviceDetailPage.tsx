import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConfigView, CredentialView, DeviceView, StatusView, UserView } from '@iot/contracts';
import { api, apiPage } from '../lib/api.js';
import { PageTitle, LoadState, dateText } from '../components/FeatureUI.js';
import { IssuedKey, type IssuedCredential } from '../components/IssuedKey.js';

function Metadata({ device, admin }: { device: DeviceView; admin: boolean }) {
  const client = useQueryClient();
  const edit = useMutation({
    mutationFn: (input: object) =>
      api(`/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['device', device.id] }),
        client.invalidateQueries({ queryKey: ['devices'] }),
      ]);
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    edit.mutate({
      name: data.get('name'),
      location: data.get('location'),
      description: data.get('description'),
    });
  }
  return (
    <section className="panel feature-section">
      <h2>Thông tin thiết bị</h2>
      <form
        onSubmit={submit}
        className="stack-form"
        key={`${device.id}:${device.name}:${device.location}:${device.description}`}
      >
        <label>
          Tên thiết bị
          <input name="name" required maxLength={80} defaultValue={device.name} disabled={!admin} />
        </label>
        <label>
          Vị trí
          <input
            name="location"
            maxLength={160}
            defaultValue={device.location ?? ''}
            disabled={!admin}
          />
        </label>
        <label>
          Mô tả
          <textarea
            name="description"
            maxLength={1000}
            defaultValue={device.description ?? ''}
            disabled={!admin}
          />
        </label>
        <dl className="detail-grid">
          <div>
            <dt>Device ID</dt>
            <dd>
              <code>{device.id}</code>
            </dd>
          </div>
          <div>
            <dt>Nguồn</dt>
            <dd>
              {device.source_kind === 'simulator' ? 'Simulator — dữ liệu mô phỏng' : 'Phần cứng'}
            </dd>
          </div>
          <div>
            <dt>Liên lạc cuối</dt>
            <dd>{dateText(device.last_seen_at)}</dd>
          </div>
          <div>
            <dt>Firmware gần nhất</dt>
            <dd>{device.latest?.payload.firmware_version ?? 'Chưa có telemetry'}</dd>
          </div>
        </dl>
        {admin ? (
          <div className="button-row">
            <button className="primary" disabled={edit.isPending}>
              Lưu thông tin
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={edit.isPending}
              onClick={() => edit.mutate({ archived: !device.archived_at })}
            >
              {device.archived_at ? 'Khôi phục thiết bị' : 'Lưu trữ thiết bị'}
            </button>
          </div>
        ) : null}
      </form>
      {device.archived_at ? (
        <p className="notice" role="status">
          Thiết bị đã lưu trữ
        </p>
      ) : null}
      <p className="caption">
        Lưu trữ giữ nguyên dữ liệu, sự cố và keys nhưng chặn liên lạc của thiết bị. Khôi phục cho
        phép các key chưa hết hạn/thu hồi hoạt động lại; không tắt cơ chế cảnh báo cục bộ.
      </p>
      <LoadState error={edit.error} />
      {edit.isSuccess ? (
        <p role="status" className="caption">
          Đã cập nhật thiết bị.
        </p>
      ) : null}
    </section>
  );
}

function Credentials({ device }: { device: DeviceView }) {
  const client = useQueryClient();
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const [overlap, setOverlap] = useState(60);
  const keys = useInfiniteQuery({
    queryKey: ['credentials', device.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<CredentialView[]>(
        `/devices/${device.id}/credentials?limit=30${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    refetchInterval: 10000,
  });
  const issue = useMutation({
    mutationFn: async (input: { keyId?: string; label?: string; expires_at?: string }) => {
      const path = input.keyId
        ? `/devices/${device.id}/credentials/${input.keyId}/rotate`
        : `/devices/${device.id}/credentials`;
      const body = {
        label: input.label ?? '',
        ...(input.expires_at ? { expires_at: input.expires_at } : {}),
        ...(input.keyId ? { overlap_minutes: overlap } : {}),
      };
      return {
        ...(await api<{ key: string; key_id: string }>(path, {
          method: 'POST',
          body: JSON.stringify(body),
        })),
        deviceId: device.id,
      };
    },
    onSuccess: async (value) => {
      setIssued(value);
      await client.invalidateQueries({ queryKey: ['credentials', device.id] });
    },
  });
  const revoke = useMutation({
    mutationFn: (keyId: string) =>
      api(`/devices/${device.id}/credentials/${keyId}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['credentials', device.id] }),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const expiry = String(data.get('expires_at'));
    issue.mutate({
      label: String(data.get('label')),
      ...(expiry ? { expires_at: new Date(expiry).toISOString() } : {}),
    });
  }
  return (
    <section className="panel feature-section">
      <h2>Quản lý key</h2>
      <p className="caption">
        Key mới chỉ hiển thị một lần. Rotation tạo key mới và rút hạn key cũ về cửa sổ chuyển tiếp;
        không tự gửi secret xuống thiết bị. Thu hồi có hiệu lực ngay.
      </p>
      {issued ? <IssuedKey issued={issued} close={() => setIssued(null)} /> : null}
      <form className="inline-form" onSubmit={submit}>
        <label>
          Nhãn key
          <input name="label" maxLength={80} placeholder="Ví dụ: ESP32 phòng 301" />
        </label>
        <label>
          Hạn key mới (không bắt buộc)
          <input name="expires_at" type="datetime-local" />
        </label>
        <button className="primary" disabled={issue.isPending || !!issued || !!device.archived_at}>
          Cấp key mới
        </button>
      </form>
      <label className="compact-field">
        Thời gian chuyển key (phút)
        <input
          type="number"
          min={1}
          max={1440}
          value={overlap}
          onChange={(e) => setOverlap(Number(e.target.value))}
        />
      </label>
      <LoadState
        pending={keys.isPending}
        error={keys.error ?? issue.error ?? revoke.error}
        retry={() => void keys.refetch()}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Key ID / nhãn</th>
              <th>Trạng thái</th>
              <th>Tạo / hết hạn</th>
              <th>Dùng lần cuối</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {keys.data?.pages
              .flatMap((p) => p.data)
              .map((k) => (
                <tr key={k.key_id}>
                  <td>
                    <code>{k.key_id}</code>
                    <small className="device-id">
                      {k.label || 'Không có nhãn'}
                      {k.replaces_key_id ? ` · Thay ${k.replaces_key_id}` : ''}
                    </small>
                  </td>
                  <td>{k.status}</td>
                  <td>
                    {dateText(k.created_at)}
                    <small className="device-id">
                      Hết hạn: {k.expires_at ? dateText(k.expires_at) : 'Chưa đặt'}
                    </small>
                  </td>
                  <td>{dateText(k.last_used_at)}</td>
                  <td>
                    <div className="button-row">
                      {k.status === 'active' ? (
                        <button
                          disabled={
                            issue.isPending ||
                            !!issued ||
                            !!device.archived_at ||
                            !Number.isInteger(overlap) ||
                            overlap < 1 ||
                            overlap > 1440
                          }
                          onClick={() => issue.mutate({ keyId: k.key_id, label: k.label })}
                        >
                          Đổi key
                        </button>
                      ) : null}
                      {k.status !== 'revoked' ? (
                        <button
                          className="danger-button"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(k.key_id)}
                        >
                          Thu hồi
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {keys.hasNextPage ? (
        <button
          className="load-more"
          disabled={keys.isFetchingNextPage}
          onClick={() => void keys.fetchNextPage()}
        >
          Tải thêm keys
        </button>
      ) : null}
    </section>
  );
}

function Configuration({ device, admin }: { device: DeviceView; admin: boolean }) {
  const client = useQueryClient();
  const config = useQuery({
    queryKey: ['config', device.id],
    queryFn: () => api<ConfigView>(`/devices/${device.id}/config`),
    refetchInterval: 10000,
  });
  const update = useMutation({
    mutationFn: (interval: number) =>
      api(`/devices/${device.id}/config`, {
        method: 'PUT',
        body: JSON.stringify({
          expected_version: config.data!.desired.version,
          config: { reporting_interval_ms: interval * 1000 },
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['config', device.id] }),
        client.invalidateQueries({ queryKey: ['device', device.id] }),
      ]);
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    update.mutate(Number(new FormData(e.currentTarget).get('interval')));
  }
  const data = config.data;
  return (
    <section className="panel feature-section">
      <h2>Cấu hình thiết bị</h2>
      <LoadState
        pending={config.isPending}
        error={config.error ?? update.error}
        retry={() => void config.refetch()}
      />
      {data ? (
        <>
          <div className="button-row">
            <span className="badge">Mong muốn: v{data.desired.version}</span>
            <span className="badge">
              Đã áp dụng:{' '}
              {data.applied_version === null ? 'chưa xác nhận' : `v${data.applied_version}`}
            </span>
          </div>
          {data.applied_version !== data.desired.version ? (
            <p className="notice">
              Đang chờ thiết bị tải và xác nhận cấu hình. Lưu trên web không có nghĩa firmware đã áp
              dụng.
            </p>
          ) : null}
          <form onSubmit={submit} className="inline-form" key={data.desired.version}>
            <label>
              Chu kỳ gửi (giây)
              <input
                name="interval"
                type="number"
                min={1}
                max={60}
                step="0.001"
                required
                defaultValue={data.desired.config.reporting_interval_ms / 1000}
                disabled={!admin || !!device.archived_at}
              />
            </label>
            {admin ? (
              <button className="primary" disabled={update.isPending || !!device.archived_at}>
                Lưu cấu hình
              </button>
            ) : null}
          </form>
          <p className="caption">
            Chỉ cấu hình chu kỳ truyền 1–60 giây. Không cung cấp lệnh tắt còi, đổi heater hoặc tự
            đặt ngưỡng nguy hiểm gas/CO. Mỗi lần lưu tạo version bất biến; thay đổi đồng thời bị
            phát hiện bằng expected_version.
          </p>
          <h3>Lịch sử phiên bản</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Chu kỳ (ms)</th>
                  <th>Tạo lúc</th>
                  <th>Người tạo</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((c) => (
                  <tr key={c.version}>
                    <td>v{c.version}</td>
                    <td>{c.config.reporting_interval_ms}</td>
                    <td>{dateText(c.created_at)}</td>
                    <td>{c.author ?? 'Khởi tạo hệ thống'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Xác nhận từ thiết bị</h3>
          {data.acknowledgements.length ? (
            <ul className="timeline">
              {data.acknowledgements.map((ack) => (
                <li key={`${ack.version}:${ack.status}`}>
                  <strong>
                    v{ack.version} · {ack.status}
                  </strong>
                  <p>{ack.reason || 'Không có ghi chú'}</p>
                  <small>{dateText(ack.received_at)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Chưa có ACK từ thiết bị.</p>
          )}
        </>
      ) : null}
    </section>
  );
}

export default function DeviceDetailPage({ user }: { user: UserView }) {
  const { id } = useParams();
  const device = useQuery({
    queryKey: ['device', id],
    queryFn: () => api<DeviceView>(`/devices/${id}`),
    refetchInterval: 10000,
  });
  const statuses = useInfiniteQuery({
    queryKey: ['status-history', id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiPage<StatusView[]>(
        `/devices/${id}/status-history?limit=30${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
  });
  return (
    <>
      <Link to="/app/devices">← Danh sách thiết bị</Link>
      <LoadState
        pending={device.isPending}
        error={device.error}
        retry={() => void device.refetch()}
      />
      {device.data ? (
        <>
          <PageTitle eyebrow="DEVICE DETAIL" title={device.data.name}>
            <p>Metadata, credentials, cấu hình và kết nối.</p>
          </PageTitle>
          <Metadata device={device.data} admin={user.role === 'admin'} />
          {user.role === 'admin' ? <Credentials device={device.data} /> : null}
          <Configuration device={device.data} admin={user.role === 'admin'} />
          <section className="panel feature-section">
            <h2>Lịch sử kết nối</h2>
            <LoadState
              pending={statuses.isPending}
              error={statuses.error}
              retry={() => void statuses.refetch()}
            />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Chuyển trạng thái</th>
                    <th>Hiệu lực</th>
                    <th>Server phát hiện</th>
                    <th>Lý do</th>
                  </tr>
                </thead>
                <tbody>
                  {statuses.data?.pages
                    .flatMap((p) => p.data)
                    .map((s) => (
                      <tr key={s.id}>
                        <td>
                          {s.previous_status} → {s.new_status}
                        </td>
                        <td>{dateText(s.effective_at)}</td>
                        <td>{dateText(s.detected_at)}</td>
                        <td>{s.reason}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {statuses.hasNextPage ? (
              <button
                onClick={() => void statuses.fetchNextPage()}
                disabled={statuses.isFetchingNextPage}
              >
                Tải thêm lịch sử kết nối
              </button>
            ) : null}
          </section>
        </>
      ) : null}
    </>
  );
}
