import { ShieldCheck } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PushPreferenceView } from "@iot/contracts";
import { LoadState } from "../../components/FeatureUI.js";
import { api } from "../../lib/api.js";

const key = ["push-privacy-preference"];
export default function PushPrivacyPreference() {
  const client = useQueryClient();
  const preference = useQuery({
    queryKey: key,
    queryFn: () => api<PushPreferenceView>("/push/preferences"),
  });
  const save = useMutation({
    mutationFn: (show_details: boolean) =>
      api<PushPreferenceView>("/push/preferences", {
        method: "PUT",
        body: JSON.stringify({ show_details }),
      }),
    onSuccess: (updated) => client.setQueryData(key, updated),
  });
  return (
    <section className="panel ag-notification-card" aria-label="Quyền riêng tư">
      <div className="ag-notification-card-heading">
        <span className="ag-notification-icon">
          <ShieldCheck size={22} aria-hidden="true" />
        </span>
        <h2>Quyền riêng tư</h2>
      </div>
      <label className="ag-privacy-option">
        <span>
          <strong id="ag-push-privacy-label">Hiển thị tên và vị trí</strong>
          <span className="caption" id="ag-push-privacy-help">
            Có thể xuất hiện trên màn hình khóa
          </span>
          <span className="caption">Áp dụng cho tài khoản · Tự lưu</span>
        </span>
        <input
          className="ag-privacy-switch"
          type="checkbox"
          role="switch"
          aria-labelledby="ag-push-privacy-label"
          aria-describedby="ag-push-privacy-help"
          checked={preference.data?.show_details === true}
          disabled={!preference.isSuccess || save.isPending}
          onChange={(event) => save.mutate(event.target.checked)}
        />
      </label>
      <LoadState
        error={save.error ?? preference.error}
        retry={preference.isError ? () => void preference.refetch() : undefined}
      />
      {save.isPending ? (
        <p className="caption" role="status">
          Đang lưu tùy chọn…
        </p>
      ) : null}
      {save.isSuccess ? (
        <p className="caption" role="status">
          Đã lưu tùy chọn chi tiết.
        </p>
      ) : null}
    </section>
  );
}
