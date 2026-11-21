import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContactView, SpacesView, UserView } from '@iot/contracts';
import { LoadState, PageTitle } from '../../components/FeatureUI.js';
import { api } from '../../lib/api.js';
import './styles.css';

type Change = { id?: string; archived?: boolean; input?: object };

function scopeValue(scope: ContactView['scope']) {
  return scope.kind === 'global' ? 'global' : `${scope.kind}:${scope.id}`;
}

export default function SupportContactsPage({ user }: { user: UserView }) {
  const admin = user.role === 'admin';
  const client = useQueryClient();
  const [editor, setEditor] = useState<ContactView | 'new' | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const contacts = useQuery({
    queryKey: ['support-contacts'], enabled: admin,
    queryFn: () => api<ContactView[]>('/support/contacts'),
  });
  const spaces = useQuery({
    queryKey: ['monitoring-spaces'], enabled: admin,
    queryFn: () => api<SpacesView>('/spaces'),
  });
  const change = useMutation({
    mutationFn: ({ id, archived, input }: Change) =>
      api(`/support/contacts${id ? `/${id}` : ''}${archived !== undefined ? '/archive' : ''}`, {
        method: archived !== undefined ? 'PATCH' : id ? 'PUT' : 'POST',
        body: JSON.stringify(archived !== undefined ? { archived } : input),
      }),
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: ['support-contacts'] }),
      client.invalidateQueries({ queryKey: ['incident-support'] }),
    ]),
  });
  if (!admin) return <p role="alert">Chỉ quản trị viên được quản lý danh bạ.</p>;

  const current = editor && editor !== 'new' ? editor : null;
  const areas = spaces.data?.areas ?? [];
  const rooms = spaces.data?.rooms ?? [];
  const areasById = new Map(areas.map((area) => [area.id, area]));
  const areaOptions = areas.filter((area) => !area.archived_at || (current?.scope.kind === 'area' && current.scope.id === area.id));
  const roomOptions = rooms.filter((room) => (!room.archived_at && !areasById.get(room.area_id)?.archived_at) ||
    (current?.scope.kind === 'room' && current.scope.id === room.id));
  const rows = contacts.data?.filter((row) => includeArchived || !row.archived_at) ?? [];

  function scopeLabel(scope: ContactView['scope']) {
    if (scope.kind === 'global') return 'Chung';
    if (scope.kind === 'area') {
      const area = areasById.get(scope.id);
      return `Khu vực: ${area?.name ?? '—'}${area?.archived_at ? ' · Đã lưu trữ' : ''}`;
    }
    const room = rooms.find((item) => item.id === scope.id);
    const area = room && areasById.get(room.area_id);
    return `Phòng: ${area?.name ?? '—'} / ${room?.name ?? '—'}${room?.archived_at || area?.archived_at ? ' · Đã lưu trữ' : ''}`;
  }

  function openEditor(value: typeof editor) {
    change.reset();
    setEditor(value);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const [kind, id] = String(data.get('scope')).split(':');
    change.mutate({
      id: current?.id,
      input: {
        name: data.get('name'), role: data.get('role'), phone: data.get('phone'),
        description: data.get('description'), priority: Number(data.get('priority')),
        scope: kind === 'global' ? { kind } : { kind, id },
      },
    }, { onSuccess: () => setEditor(null) });
  }

  return (
    <div className="ag-contact-admin">
      <PageTitle title="Danh bạ hỗ trợ" />
      <LoadState pending={contacts.isPending} error={contacts.error} retry={() => void contacts.refetch()} />
      <LoadState pending={spaces.isPending} error={spaces.error} retry={() => void spaces.refetch()} />
      <LoadState error={change.error} />
      {change.isSuccess ? <p className="notice" role="status">
        {change.variables.archived === undefined ? 'Đã lưu liên hệ.' : change.variables.archived ? 'Đã lưu trữ liên hệ.' : 'Đã khôi phục liên hệ.'}
      </p> : null}
      {contacts.data && spaces.data ? <>
        <div className="button-row">
          <button className="primary" disabled={change.isPending} onClick={() => openEditor('new')}>Thêm liên hệ</button>
          <label className="check-label">
            <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
            Hiện liên hệ đã lưu trữ
          </label>
        </div>
        {editor ? (
          <form key={current?.id ?? 'new'} className="panel feature-section stack-form" onSubmit={submit}>
            <h2>{current ? 'Sửa liên hệ' : 'Thêm liên hệ'}</h2>
            <div className="ag-contact-fields">
              <label>Tên liên hệ<input name="name" required maxLength={80} defaultValue={current?.name} /></label>
              <label>Vai trò hoặc đơn vị<input name="role" required maxLength={80} defaultValue={current?.role} /></label>
              <label>
                Số điện thoại
                <input name="phone" type="tel" required maxLength={40} defaultValue={current?.phone}
                  aria-describedby="ag-contact-phone-format" />
                <small id="ag-contact-phone-format">Số Việt Nam 10 chữ số hoặc số quốc tế bắt đầu bằng +.</small>
              </label>
              <label>Ưu tiên (1 cao nhất)<input name="priority" type="number" required min={1} max={999} defaultValue={current?.priority ?? 100} /></label>
              <label>Phạm vi<select name="scope" defaultValue={current ? scopeValue(current.scope) : 'global'}>
                <option value="global">Chung</option>
                <optgroup label="Khu vực">
                  {areaOptions.map((area) => <option key={area.id} value={`area:${area.id}`}>{scopeLabel({ kind: 'area', id: area.id })}</option>)}
                </optgroup>
                <optgroup label="Phòng">
                  {roomOptions.map((room) => <option key={room.id} value={`room:${room.id}`}>{scopeLabel({ kind: 'room', id: room.id })}</option>)}
                </optgroup>
              </select></label>
            </div>
            <label>Mô tả<textarea name="description" maxLength={1000} defaultValue={current?.description} /></label>
            <div className="button-row">
              <button className="primary" disabled={change.isPending}>Lưu liên hệ</button>
              <button type="button" disabled={change.isPending} onClick={() => openEditor(null)}>Hủy</button>
            </div>
          </form>
        ) : null}
        {rows.length ? (
          <ul className="ag-contact-list panel feature-section">
            {rows.map((row) => <li key={row.id}>
              <div>
                <strong>{row.name}</strong>
                <p>{row.role} · {row.phone}</p>
                <p>{scopeLabel(row.scope)} · Ưu tiên {row.priority}</p>
                {row.description ? <p>{row.description}</p> : null}
                <small className="badge">{row.archived_at ? 'Đã lưu trữ' : 'Đang hoạt động'}</small>
              </div>
              <div className="button-row">
                <button disabled={change.isPending} onClick={() => openEditor(row)}>Sửa</button>
                <button disabled={change.isPending} onClick={() => change.mutate({ id: row.id, archived: !row.archived_at })}>
                  {row.archived_at ? 'Khôi phục' : 'Lưu trữ'}
                </button>
              </div>
            </li>)}
          </ul>
        ) : <p className="panel feature-section muted">Chưa có liên hệ phù hợp.</p>}
      </> : null}
    </div>
  );
}
