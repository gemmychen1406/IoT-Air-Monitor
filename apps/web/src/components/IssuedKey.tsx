import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { LoadState } from './FeatureUI.js';

export type IssuedCredential = { key: string; key_id: string; deviceId: string };
export function IssuedKey({ issued, close }: { issued: IssuedCredential; close: () => void }) {
  const client = useQueryClient();
  const revoke = useMutation({
    mutationFn: () =>
      api(`/devices/${issued.deviceId}/credentials/${issued.key_id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['credentials', issued.deviceId] });
      close();
    },
  });
  return (
    <section className="panel key-panel" aria-label="Credential mới">
      <h2>Key chỉ hiển thị một lần</h2>
      <p>
        Lưu vào cấu hình local của thiết bị hoặc simulator. Không đưa vào Git hay gửi ảnh công khai.
      </p>
      <code>{issued.key}</code>
      <p>
        Device ID: <code>{issued.deviceId}</code>
      </p>
      <div className="button-row">
        <button onClick={close}>Đã lưu, đóng</button>
        <button
          className="danger-button"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate()}
        >
          Thu hồi key này
        </button>
      </div>
      <LoadState error={revoke.error} />
    </section>
  );
}
