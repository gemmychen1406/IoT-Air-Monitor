import type { FormEvent } from 'react';
import type { AreaView, RoomView } from '@iot/contracts';

export type SpaceEdit =
  | { kind: 'areas'; row?: AreaView }
  | { kind: 'rooms'; row?: RoomView };

export function SpaceEditor({ edit, areas, initialArea, pending, onSave, onCancel }: {
  edit: SpaceEdit;
  areas: AreaView[];
  initialArea: string;
  pending: boolean;
  onSave: (input: object) => void;
  onCancel: () => void;
}) {
  const currentArea = edit.kind === 'rooms' ? edit.row?.area_id : undefined;
  const availableAreas = areas.filter((area) => !area.archived_at || area.id === currentArea);
  const label = edit.kind === 'areas' ? 'khu vực' : 'phòng';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSave(Object.fromEntries(data));
  }

  return (
    <form className="panel ag-spaces-editor stack-form" onSubmit={submit}>
      <h2>{edit.row ? 'Sửa' : 'Thêm'} {label}{!edit.row && edit.kind === 'rooms' && ` vào ${areas.find(area => area.id === initialArea)?.name}`}</h2>
      {edit.kind === 'rooms' && edit.row ? (
        <label>
          Khu vực của phòng
          <select name="area_id" required defaultValue={currentArea ?? initialArea}>
            <option value="">Chọn khu vực</option>
            {availableAreas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}{area.archived_at ? ' · Đã lưu trữ' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Tên {label}
        <input autoFocus name="name" required maxLength={80} defaultValue={edit.row?.name} />
      </label>
      <label>
        Mô tả
        <textarea name="description" maxLength={1000} defaultValue={edit.row?.description} />
      </label>
      <div className="button-row">
        <button className="primary" disabled={pending}>Lưu {label}</button>
        <button type="button" disabled={pending} onClick={onCancel}>Hủy</button>
      </div>
    </form>
  );
}
