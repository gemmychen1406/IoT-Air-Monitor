import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PushPreferenceView } from '@iot/contracts';
import { LoadState } from '../../components/FeatureUI.js';
import { api } from '../../lib/api.js';

const key = ['push-privacy-preference'];
export default function PushPrivacyPreference() {
  const client = useQueryClient();
  const preference = useQuery({
    queryKey: key,
    queryFn: () => api<PushPreferenceView>('/push/preferences'),
  });
  const save = useMutation({
    mutationFn: (show_details: boolean) => api<PushPreferenceView>('/push/preferences', {
      method: 'PUT', body: JSON.stringify({ show_details }),
    }),
    onSuccess: (updated) => client.setQueryData(key, updated),
  });
  return (
    <>
      <label className="check-label">
        <input type="checkbox" checked={preference.data?.show_details === true}
          disabled={!preference.isSuccess || save.isPending}
          onChange={(event) => save.mutate(event.target.checked)} />
        Hiển thị chi tiết thông báo
      </label>
      <p className="caption">
        Mặc định ẩn tên và vị trí. Khi bật, các thông tin này có thể hiện trên màn hình khóa.
        Tùy chọn áp dụng cho các trình duyệt đã đăng ký của tài khoản. Tin đã gửi có thể đến sau khi đăng xuất.
      </p>
      <LoadState error={save.error ?? preference.error} retry={preference.isError ? () => void preference.refetch() : undefined} />
      {save.isSuccess ? <p className="caption" role="status">Đã lưu tùy chọn chi tiết.</p> : null}
    </>
  );
}
