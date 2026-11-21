import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  digestIntervals, environmentPolicyInput,
  type DeviceView, type EnvironmentChannel, type EnvironmentPolicy, type EnvironmentSettingsView, type UserView,
} from '@iot/contracts';
import { LoadState, PageTitle } from '../../components/FeatureUI.js';
import { api } from '../../lib/api.js';
import './styles.css';

function PolicyForm({ devices, view, pending, onSave }: {
  devices: DeviceView[]; view: EnvironmentSettingsView; pending: boolean; onSave: (value: EnvironmentPolicy) => void;
}) {
  const [draft, setDraft] = useState(view.policy);
  const [error, setError] = useState('');
  const set = <K extends keyof EnvironmentPolicy>(key: K, value: EnvironmentPolicy[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const toggle = (id: string) => set('device_ids', draft.device_ids.includes(id)
    ? draft.device_ids.filter((value) => value !== id) : [...draft.device_ids, id]);
  const check = (label: string, checked: boolean, change: (value: boolean) => void) => (
    <label className="check-label"><input type="checkbox" checked={checked} onChange={(e) => change(e.target.checked)} />{label}</label>
  );
  const number = (label: string, value: number, min: number, max: number, change: (n: number) => void, step = 1) => (
    <label>{label}<input type="number" required value={Number.isNaN(value) ? '' : value} min={min} max={max} step={step}
      onChange={(e) => change(e.target.valueAsNumber)} /></label>
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = environmentPolicyInput.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Kiểm tra cấu hình.');
      return;
    }
    setError('');
    onSave(parsed.data);
  }
  return (
    <form className="panel feature-section ag-environment-form" onSubmit={submit}>
      <fieldset disabled={pending}>
        {check('Bật thông báo môi trường và kết nối', draft.enabled, (v) => set('enabled', v))}
        {check('Nhận cả dữ liệu mô phỏng', draft.include_simulators, (v) => set('include_simulators', v))}
        <details open>
          <summary>Thiết bị theo dõi ({draft.device_ids.length}/20)</summary>
          {!devices.length && !draft.device_ids.length ? <p>Chưa có thiết bị.</p> : null}
          <div className="ag-environment-devices">
            {devices.map((d) => <div key={d.id}>{check(
              `${d.name}${d.source_kind === 'simulator' ? ' · Mô phỏng' : ''}`, draft.device_ids.includes(d.id), () => toggle(d.id),
            )}</div>)}
            {draft.device_ids.filter((id) => !devices.some((d) => d.id === id)).map((id) => (
              <div key={id}>{check(`Thiết bị đã chọn (${id.slice(0, 8)})`, true, () => toggle(id))}</div>
            ))}
          </div>
        </details>
        <div className="ag-environment-grid">
          <label>Múi giờ (IANA)<input value={draft.timezone} required maxLength={80} onChange={(e) => set('timezone', e.target.value)} /></label>
          {check('Bật giờ yên lặng', !!draft.quiet, (v) => set('quiet', v ? { start: '22:00', end: '07:00' } : null))}
          {draft.quiet ? <>
            <label>Bắt đầu<input type="time" required value={draft.quiet.start}
              onChange={(e) => set('quiet', { ...draft.quiet!, start: e.target.value })} /></label>
            <label>Kết thúc<input type="time" required value={draft.quiet.end}
              onChange={(e) => set('quiet', { ...draft.quiet!, end: e.target.value })} /></label>
            {check('Áp dụng cho cả cảnh báo sự cố của kênh này', draft.quiet_incidents, (v) => set('quiet_incidents', v))}
            {draft.quiet_incidents ? check('Cảnh báo critical bỏ qua giờ yên lặng', draft.critical_bypass, (v) => set('critical_bypass', v)) : null}
          </> : null}
        </div>
        {draft.quiet && draft.quiet_incidents && draft.critical_bypass
          ? <p className="caption">Tùy chọn bỏ qua chỉ áp dụng trên AirGuard. Thiết bị vẫn có thể chặn hoặc hoãn thông báo.</p> : null}
        <h3>Bản tin định kỳ</h3>
        {check('Gửi bản tin nhiệt độ và độ ẩm', draft.digest.enabled, (v) => set('digest', { ...draft.digest, enabled: v }))}
        {draft.digest.enabled ? <div className="ag-environment-grid">
          <label>Chu kỳ gửi (phút)<select value={draft.digest.interval_minutes}
            onChange={(e) => set('digest', { ...draft.digest, interval_minutes: Number(e.target.value) })}>
            {digestIntervals.map((v) => <option key={v} value={v}>{v}</option>)}
          </select></label>
          {number('Cửa sổ lấy mẫu (phút)', draft.digest.window_minutes, 5, 1440, (v) => set('digest', { ...draft.digest, window_minutes: v }))}
        </div> : null}
        <h3>Biến động</h3>
        {check('Thông báo biến động đáng chú ý', draft.variation.enabled, (v) => set('variation', { ...draft.variation, enabled: v }))}
        {draft.variation.enabled ? <div className="ag-environment-grid">
          {number('Chênh lệch nhiệt độ (°C)', draft.variation.temperature_delta, 0.1, 30, (v) => set('variation', { ...draft.variation, temperature_delta: v }), 0.1)}
          {number('Chênh lệch độ ẩm (điểm %RH)', draft.variation.humidity_delta, 0.1, 100, (v) => set('variation', { ...draft.variation, humidity_delta: v }), 0.1)}
          {number('Duy trì (phút)', draft.variation.sustain_minutes, 3, 30, (v) => set('variation', { ...draft.variation, sustain_minutes: v }))}
          {number('Khoảng nghỉ (phút)', draft.variation.cooldown_minutes, 5, 1440, (v) => set('variation', { ...draft.variation, cooldown_minutes: v }))}
        </div> : null}
        <h3>Kết nối thiết bị</h3>
        {check('Thông báo mất và kết nối lại', draft.connectivity.enabled, (v) => set('connectivity', { ...draft.connectivity, enabled: v }))}
        {draft.connectivity.enabled ? <div className="ag-environment-grid">
          {number('Chờ sau khi mất kết nối (phút)', draft.connectivity.wait_minutes, 1, 60, (v) => set('connectivity', { ...draft.connectivity, wait_minutes: v }))}
          {number('Khoảng nghỉ giữa hai lượt báo mất (phút)', draft.connectivity.cooldown_minutes, 1, 1440, (v) => set('connectivity', { ...draft.connectivity, cooldown_minutes: v }))}
        </div> : null}
        {error ? <p role="alert" className="notice error">{error}</p> : null}
        <button className="primary" disabled={pending}>Lưu cài đặt</button>
      </fieldset>
    </form>
  );
}

export default function EnvironmentSettingsPage({ devices, user, embedded = false }: {
  devices: DeviceView[]; user: UserView; embedded?: boolean;
}) {
  const [selectedChannel, setChannel] = useState<EnvironmentChannel>('webpush');
  const channel = user.role === 'admin' ? selectedChannel : 'webpush';
  const client = useQueryClient();
  const key = ['environment-settings', user.id, channel];
  const url = `/environment/settings/${channel}`;
  const query = useQuery({ queryKey: key, queryFn: () => api<EnvironmentSettingsView>(url), refetchInterval: 30000 });
  const save = useMutation({
    mutationFn: (value: EnvironmentPolicy) => api<EnvironmentSettingsView>(url, { method: 'PUT', body: JSON.stringify(value) }),
    onSuccess: (value) => {
      client.setQueryData(key, value);
      void client.invalidateQueries({ queryKey: ['environment-history'] });
    },
  });
  const view = query.data;
  return <>
    {embedded ? <div className="button-row">
      <h2>Lịch thông báo môi trường & kết nối</h2>
      <Link to="/app/notifications?view=environment">Xem lịch sử tin môi trường</Link>
    </div> : <PageTitle title="Thông báo môi trường & kết nối">
      <Link to="/app/notifications?view=environment">Xem lịch sử tin môi trường</Link>
    </PageTitle>}
    <div className="button-row">
      <button type="button" aria-pressed={channel === 'webpush'} disabled={save.isPending} onClick={() => { setChannel('webpush'); save.reset(); }}>Web Push cá nhân</button>
      {user.role === 'admin' ? <button type="button" aria-pressed={channel === 'telegram'} disabled={save.isPending}
        onClick={() => { setChannel('telegram'); save.reset(); }}>Telegram chung</button> : null}
    </div>
    <LoadState pending={query.isPending} error={query.error ?? save.error} retry={() => void query.refetch()} />
    {save.isSuccess ? <p className="notice" role="status">Đã lưu cài đặt.</p> : null}
    {view ? <>
      <p className="caption">{channel === 'telegram'
        ? 'Áp dụng cho đích Telegram do admin cấu hình trên server.'
        : 'Áp dụng cho các trình duyệt đã đăng ký của tài khoản bạn.'}</p>
      {channel === 'telegram' && view.channel_ready ? <p className="badge success">Telegram đã có đích gửi</p> : null}
      {!view.channel_ready ? <p className="notice">
        {channel === 'telegram' ? 'Backend chưa cấu hình đích Telegram.' : 'Chưa có đăng ký Web Push hợp lệ. Bật trong Cài đặt → Thông báo.'}
      </p> : null}
      {!view.simulator_allowed_by_server ? <p className="caption">Backend Telegram chưa cho phép nhận dữ liệu mô phỏng.</p> : null}
      {view.next_digest_at ? <p>Bản tin tiếp theo theo lịch: {new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: view.policy.timezone,
      }).format(new Date(view.next_digest_at))} ({view.policy.timezone})</p> : null}
      <PolicyForm key={channel} devices={devices} view={view} pending={save.isPending} onSave={(value) => save.mutate(value)} />
    </> : null}
  </>;
}
