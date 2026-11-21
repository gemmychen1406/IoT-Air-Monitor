import { useState } from 'react';
import type { AreaView, RoomView, SpacesView } from '@iot/contracts';

type Device = SpacesView['devices'][number];
type AssignmentProps = {
  rooms: RoomView[];
  areas: Map<string, AreaView>;
  pending: boolean;
  onSave: (id: string, roomId: string | null) => void;
};

function roomLabel(room: RoomView, areas: AssignmentProps['areas']) {
  const area = areas.get(room.area_id);
  return `${area?.name ?? 'Khu vực'} / ${room.name}${room.archived_at || area?.archived_at ? ' · Đã lưu trữ' : ''}`;
}

function AssignmentRow({ device, rooms, areas, pending, onSave }: AssignmentProps & { device: Device }) {
  const [draft, setDraft] = useState<string | null>(null);
  const roomId = draft ?? '';
  const current = rooms.find((room) => room.id === device.room_id);
  const options = rooms.filter((room) =>
    room.id === device.room_id || (!device.archived_at && !room.archived_at && !areas.get(room.area_id)?.archived_at),
  );
  const selected = options.find((room) => room.id === roomId);
  return (
    <form className="ag-space-assignment" onSubmit={(e) => {
      e.preventDefault();
      const next = selected?.id ?? null;
      if (!pending && draft !== null && (roomId === '' || selected) && next !== device.room_id)
        onSave(device.id, next);
    }}>
      <div>
        <strong>{device.name}</strong>
        {device.archived_at ? <small>Thiết bị đã lưu trữ</small> : null}
        <small>Phòng hiện tại: {current ? roomLabel(current, areas) : 'Chưa gán phòng'}</small>
      </div>
      {draft === null ? <button type="button" disabled={pending} onClick={() => setDraft(device.room_id ?? '')}>
        {device.room_id ? 'Đổi phòng' : 'Gán phòng'}
      </button> : <>
        <label>Phòng mới
          <select value={roomId} onChange={(e) => setDraft(e.target.value)} disabled={pending}>
            <option value="">{device.location ? `Chưa gán · ${device.location}` : 'Chưa gán phòng'}</option>
            {roomId && !selected ? <option value={roomId} disabled>Phòng đã chọn không còn khả dụng</option> : null}
            {options.map((room) => <option key={room.id} value={room.id}>{roomLabel(room, areas)}</option>)}
          </select>
        </label>
        <div className="button-row">
          <button className="primary" disabled={pending || (!!roomId && !selected) || (selected?.id ?? null) === device.room_id}>Lưu</button>
          <button type="button" disabled={pending} onClick={() => setDraft(null)}>Hủy</button>
        </div>
      </>}
    </form>
  );
}

export function DeviceAssignments({ devices, canEdit, ...props }: AssignmentProps & {
  devices: Device[];
  canEdit: boolean;
}) {
  function group(title: string, rows: Device[], empty: string) {
    return <section className="panel feature-section ag-space-assignments">
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="muted">{empty}</p> : null}
      {rows.map((device) => {
        if (canEdit) return (
          <AssignmentRow key={`${device.id}:${device.room_id ?? ''}`} device={device} {...props} />
        );
        const room = props.rooms.find((item) => item.id === device.room_id);
        return (
          <div className="ag-space-assignment" key={device.id}>
            <strong>{device.name}{device.archived_at ? ' · Đã lưu trữ' : ''}</strong>
            <span>{room ? roomLabel(room, props.areas) : device.location || 'Chưa gán phòng'}</span>
          </div>
        );
      })}
    </section>;
  }
  return <>
    {group('Thiết bị chưa gán phòng', devices.filter((device) => !device.room_id), 'Tất cả thiết bị phù hợp đã có phòng.')}
    {group('Thiết bị đã gán phòng', devices.filter((device) => device.room_id), 'Chưa có thiết bị được gán trong phạm vi đang xem.')}
  </>;
}
