import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { IncidentReceiptsView, ReceiptView } from "@iot/contracts";
import { dateText, LoadState } from "../../components/FeatureUI.js";
import { api, apiPage } from "../../lib/api.js";

const receiptText = (receipt: ReceiptView) =>
  `${dateText(receipt.received_at)}${receipt.late ? " · Tiếp nhận muộn (sau khi sự cố kết thúc)" : ""}`;

export function useIncidentReceipt(incidentId: string, userId: string) {
  const client = useQueryClient();
  const url = `/alerts/incidents/${incidentId}/receipts`;
  const key = ["incident-receipts", incidentId, userId];
  const receipts = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      apiPage<IncidentReceiptsView>(
        pageParam ? `${url}?after=${pageParam}` : url,
      ),
    initialPageParam: "",
    getNextPageParam: (page) => page.meta.next_cursor ?? undefined,
    refetchInterval: 10000,
  });
  const record = useMutation({
    mutationFn: () => api<ReceiptView>(url, { method: "POST", body: "{}" }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({ queryKey: ["delivery-history"] }),
      ]),
  });
  return { receipts, record };
}

type IncidentReceipt = ReturnType<typeof useIncidentReceipt>;

export function IncidentReceiptAction({ receipts, record }: IncidentReceipt) {
  const first = receipts.data?.pages[0]?.data;
  const mine = record.data ?? first?.mine;
  return (
    <div className="ag-receipt-action" aria-label="Tiếp nhận cảnh báo">
      <LoadState
        pending={receipts.isPending}
        error={receipts.error}
        retry={() => void receipts.refetch()}
      />
      <LoadState error={record.error} />
      {mine ? (
        <p role="status">Bạn đã xác nhận tiếp nhận · {receiptText(mine)}</p>
      ) : first && !receipts.isError ? (
        first.eligible ? (
          <>
            <span>Bạn chưa tiếp nhận </span>
            <button
              className="primary"
              disabled={record.isPending}
              onClick={() => record.mutate()}
            >
              Tôi đã nhận cảnh báo
            </button>
            <p className="caption">
              Thao tác này chỉ ghi nhận việc tiếp nhận của bạn.
            </p>
          </>
        ) : (
          <p className="muted">
            Chưa có cảnh báo được xếp gửi cho tài khoản hoặc workspace của bạn.
          </p>
        )
      ) : null}
    </div>
  );
}

export function IncidentReceiptTeam({
  receipts,
}: Pick<IncidentReceipt, "receipts">) {
  const pages = receipts.data?.pages;
  if (!pages?.[0]?.data.team || receipts.isError) return null;
  const team = pages.flatMap((page) => page.data.team ?? []);
  if (!team.length) return <p className="muted">Chưa có người tiếp nhận.</p>;
  return (
    <section className="ag-incident-team">
      <h3>Người đã tiếp nhận</h3>
      <ul>
        {team.map((row) => (
          <li key={row.user_id}>
            <strong>{row.email}</strong>
            <span className="caption">{receiptText(row.receipt)}</span>
          </li>
        ))}
      </ul>
      {receipts.hasNextPage ? (
        <button
          disabled={receipts.isFetchingNextPage}
          onClick={() => void receipts.fetchNextPage()}
        >
          Xem thêm
        </button>
      ) : null}
    </section>
  );
}
