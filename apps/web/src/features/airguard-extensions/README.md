# AirGuard Extensions (add-only)

Hub hiện có ba tab: sức khỏe thiết bị, sơ đồ cảm biến và hướng dẫn ứng phó. So sánh và báo cáo có trang riêng tại `/app/comparison-reporting`.

## Trạng thái tích hợp

Đã nối vào sidebar **Tiện ích mở rộng** và route `/app/extensions` trong `apps/web/src/App.tsx`. Mô tả add-only và patch bên dưới ghi lại cách đề xuất tích hợp ban đầu.

Mã nguồn hoàn chỉnh ở mức module và dùng các endpoint hiện có:

- `GET /devices`
- `GET /devices/:id/analytics`
- `GET /devices/:id/status-history`
- `GET /alerts/incidents`
- `GET /alerts/states`

Không có backend, schema, contract hay dependency mới. Sơ đồ chỉ lưu tọa độ vào `localStorage` với khóa `airguard.sensor-map.v1`. PDF được tạo bằng hộp thoại in chuẩn của trình duyệt (chọn “Save as PDF”/“Lưu dưới dạng PDF”).

## Đề xuất tích hợp ban đầu

Xem `integration-proposal.patch` trong thư mục này để tham khảo điểm nối ban đầu. Các điểm nối đã có trong bản tích hợp hiện tại.

