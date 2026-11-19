import type { ReactNode } from 'react';

export const dateText = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('vi-VN') : 'Chưa xác định';
export const conditionText = { gas: 'Gas', co: 'CO', flame: 'Flame' };
export function PageTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}
export function LoadState({
  pending,
  error,
  retry,
}: {
  pending?: boolean;
  error?: Error | null;
  retry?: () => void;
}) {
  if (pending) return <div className="skeleton" role="status" aria-label="Đang tải dữ liệu" />;
  if (error)
    return (
      <div className="notice error" role="alert">
        {error.message}
        {retry ? <button onClick={retry}>Thử lại</button> : null}
      </div>
    );
  return null;
}
