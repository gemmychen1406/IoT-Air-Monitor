import { Link, useNavigate, useParams } from 'react-router';
import { Building2 } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AreaView, RoomView, RoomMapView, SpacesView, UserView } from '@iot/contracts';
import { LoadState, PageTitle } from '../../components/FeatureUI.js';
import { api } from '../../lib/api.js';
import { DeviceAssignments } from './DeviceAssignments.js';
import { SpaceEditor, type SpaceEdit } from './SpaceEditor.js';
import RoomMap from './RoomMap.js';
import './styles.css';

type Change = { path: string; method: 'POST' | 'PUT' | 'PATCH'; body: object; success: string };

export default function MonitoringSpacesPage({ user }: { user: UserView }) {
  const { areaId = '' } = useParams();
  return <SpaceCatalog key={areaId} areaId={areaId} user={user} />;
}

function SpaceCatalog({ user, areaId }: { user: UserView; areaId: string }) {
  const canEdit = user.role === 'admin';
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const setAreaId = (id: string) => navigate('/app/spaces/' + id);
  const summary = useQuery({
    queryKey: ['area-summary'],
    enabled: !areaId,
    refetchInterval: 5000,
    queryFn: () =>
      api<(AreaView & { rooms: number; devices: number; incidents: number })[]>('/spaces/areas'),
  });
  const [status, setStatus] = useState('active');
  const [edit, setEdit] = useState<SpaceEdit>();
  const spaces = useQuery({
    queryKey: ['monitoring-spaces'],
    enabled: !!areaId,
    queryFn: () => api<SpacesView>('/spaces'),
  });
  const change = useMutation({
    mutationFn: async (input: Change) => {
      const options = { method: input.method, body: JSON.stringify(input.body) };
      if (input.method === 'POST' && input.path === '/spaces/rooms') return api<RoomView>(input.path, options);
      await api(input.path, options);
      return null;
    },
    onSuccess: (result) => {
      if (result) {
        const key = ['space-map', result.area_id];
        client.setQueryData<RoomMapView>(key, current => {
          if (!current || current.rooms.some(room => room.id === result.id)) return current;
          return { ...current, rooms: [...current.rooms, { ...result, devices: [], layout_version: 0 }] };
        });
        setEdit(undefined);
      }
      return Promise.all([
        client.invalidateQueries({ queryKey: ['monitoring-spaces'] }),
        client.invalidateQueries({ queryKey: ['incident-support'] }),
        client.invalidateQueries({ queryKey: ['space-map'] }),
        client.invalidateQueries({ queryKey: ['area-summary'] }),
      ]);
    },
  });
  const { areas, rooms, devices } = spaces.data ?? { areas: [], rooms: [], devices: [] };
  const areasById = new Map(areas.map((area) => [area.id, area]));
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const mapArea = areasById.get(areaId);
  const query = search.trim().normalize('NFC').toLowerCase();
  const matches = (name: string, desc: string) =>
    `${name} ${desc}`.normalize('NFC').toLowerCase().includes(query);
  const statusMatches = (row: AreaView) =>
    status === 'all' || !!row.archived_at === (status === 'archived');
  const shownAreas = areas.filter(
    (area) =>
      (!areaId || areaId === area.id) &&
      statusMatches(area) &&
      matches(area.name, area.description),
  );
  const shownRooms = rooms.filter(
    (room) =>
      (!areaId || areaId === room.area_id) &&
      statusMatches(room) &&
      matches(`${room.name} ${areasById.get(room.area_id)?.name ?? ''}`, room.description),
  );

  function openEditor(value: SpaceEdit) {
    change.reset();
    setEdit(value);
  }
  function archive(kind: SpaceEdit['kind'], row: AreaView) {
    change.mutate({
      path: `/spaces/${kind}/${row.id}/archive`,
      method: 'PATCH',
      body: { archived: !row.archived_at },
      success: row.archived_at ? 'Đã khôi phục.' : 'Đã lưu trữ.',
    });
  }
  function save(body: object) {
    if (!edit) return;
    change.mutate(
      {
        path: `/spaces/${edit.kind}${edit.row ? `/${edit.row.id}` : ''}`,
        method: edit.row ? 'PUT' : 'POST',
        body: edit.kind === 'rooms' && !edit.row ? { ...body, area_id: areaId } : body,
        success: edit.kind === 'rooms' && !edit.row ? `Đã tạo phòng trong ${mapArea?.name}.` : 'Đã lưu thay đổi.',
      },
      { onSuccess: () => setEdit(undefined) },
    );
  }
  function renderRows(rows: AreaView[] | RoomView[], kind: SpaceEdit['kind']) {
    return rows.length ? (
      <ul className="ag-space-list">
        {rows.map((row) => (
          <li key={row.id}>
            <div>
              <strong>{row.name}</strong>
              {'area_id' in row ? (
                <small>{areasById.get((row as RoomView).area_id)?.name}</small>
              ) : null}
              {row.description ? <p>{row.description}</p> : null}
              <small className="badge">{row.archived_at ? 'Đã lưu trữ' : 'Đang hoạt động'}</small>
            </div>
            {canEdit ? (
              <div className="button-row">
                <button
                  disabled={change.isPending}
                  onClick={() =>
                    openEditor(kind === 'rooms' ? { kind, row: row as RoomView } : { kind, row })
                  }
                >
                  Sửa
                </button>
                <button disabled={change.isPending} onClick={() => archive(kind, row)}>
                  {row.archived_at ? 'Khôi phục' : 'Lưu trữ'}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    ) : (
      <p className="muted">Không có kết quả phù hợp.</p>
    );
  }

  const visibleAreas = summary.data?.filter(a => statusMatches(a) && matches(a.name,a.description));
  if (!areaId)
    return (
      <main className="ag-spaces">
        <PageTitle title="Khu vực & phòng" />
        {canEdit && <button onClick={() => openEditor({ kind: 'areas' })}>Thêm khu vực</button>}
        <LoadState
          pending={summary.isPending}
          error={summary.error ?? change.error}
          retry={() => void summary.refetch()}
        />
        {edit && canEdit && (
          <SpaceEditor
            edit={edit}
            areas={[]}
            initialArea=""
            pending={change.isPending}
            onSave={save}
            onCancel={() => setEdit(undefined)}
          />
        )}
        <div className="ag-space-filters">
          <label>
            Tìm khu vực
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label>
            Trạng thái
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Đang hoạt động</option>
              <option value="archived">Đã lưu trữ</option>
              <option value="all">Tất cả</option>
            </select>
          </label>
        </div>
        <ul className="panel ag-space-list ag-area-list">
          {visibleAreas?.map((a) => (
              <li key={a.id}>
                <Link to={`/app/spaces/${a.id}`}>
                  <Building2 size={18} /> <strong>{a.name}</strong>{' '}
                  {a.archived_at && '· Đã lưu trữ'}
                  <small>
                    {a.rooms} phòng · {a.devices} thiết bị ·{' '}
                    <span className={a.incidents ? 'badge danger' : ''}>
                      {a.incidents} sự cố đang mở
                    </span>
                  </small>
                </Link>
              </li>
            ))}
        </ul>
        {visibleAreas?.length === 0 && <p>{summary.data?.length ? 'Không có khu vực phù hợp với bộ lọc.' : 'Chưa có khu vực.'}</p>}
      </main>
    );
  return (
    <div className="ag-spaces">
      <Link to="/app/spaces">← Danh sách khu vực</Link>
      <PageTitle title={mapArea?.name ?? 'Chi tiết khu vực'} />
      <LoadState
        pending={spaces.isPending}
        error={spaces.error}
        retry={() => void spaces.refetch()}
      />
      <LoadState error={change.error} />
      {change.isSuccess ? (
        <p className="notice" role="status">
          {change.variables.success}
        </p>
      ) : null}
      {spaces.data && !mapArea && <p>Không tìm thấy khu vực.</p>}
      {spaces.data && mapArea ? (
        <>
          {canEdit && !mapArea.archived_at && (
            <button onClick={() => openEditor({ kind: 'rooms' })}>Thêm phòng</button>
          )}
          {canEdit && edit ? (
            <SpaceEditor
              key={`${edit.kind}:${edit.row?.id ?? 'new'}`}
              edit={edit}
              areas={areas}
              initialArea={areasById.get(areaId)?.archived_at ? '' : areaId}
              pending={change.isPending}
              onSave={save}
              onCancel={() => {
                change.reset();
                setEdit(undefined);
              }}
            />
          ) : null}
          <RoomMap
            unassigned={devices.filter((d) => !d.room_id && !d.archived_at)}
            onAssign={(id, roomId) =>
              change.mutateAsync({
                path: `/spaces/devices/${id}/room`,
                method: 'PUT',
                body: { room_id: roomId, only_unassigned: true },
                success: 'Đã gán phòng.',
              })
            }
            key={mapArea?.id}
            areas={areas}
            area={mapArea}
            canEdit={canEdit}
            onAreaChange={setAreaId}
          />
          <details className="panel ag-space-management"><summary>Danh sách phòng và phân bổ thiết bị</summary>
          <div className="ag-space-filters">
            <label>
              Tìm kiếm
              <input value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <label>
              Trạng thái
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Đang hoạt động</option>
                <option value="archived">Đã lưu trữ</option>
                <option value="all">Tất cả</option>
              </select>
            </label>
          </div>
          <div className="ag-space-catalog">
            <section className="panel feature-section">
              <header>
                <h2>Quản lý khu vực</h2>
              </header>
              {renderRows(shownAreas, 'areas')}
            </section>
            <section className="panel feature-section">
              <header>
                <h2>Quản lý phòng</h2>
              </header>
              {renderRows(shownRooms, 'rooms')}
            </section>
          </div>
          <DeviceAssignments
            devices={devices.filter(
              (device) =>
                (!areaId || !device.room_id || roomsById.get(device.room_id)?.area_id === areaId) &&
                matches(device.name, device.location),
            )}
            rooms={rooms}
            areas={areasById}
            canEdit={canEdit}
            pending={change.isPending}
            onSave={(id, roomId) =>
              change.mutate({
                path: `/spaces/devices/${id}/room`,
                method: 'PUT',
                body: { room_id: roomId },
                success: roomId ? 'Đã gán phòng.' : 'Đã bỏ gán phòng.',
              })
            }
          />
          </details>
        </>
      ) : null}
    </div>
  );
}
