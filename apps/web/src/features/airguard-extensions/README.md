# AirGuard Extensions (add-only)

Thư mục này chứa 5 module frontend độc lập: báo cáo PDF, so sánh thiết bị, sức khỏe thiết bị, sơ đồ cảm biến và hướng dẫn ứng phó.

## Trạng thái tích hợp

**CHƯA TÍCH HỢP vào website hiện tại.** `apps/web/src/App.tsx` đăng ký route và sidebar bằng danh sách tĩnh; Vite chỉ bundle file đi từ cây import của `main.tsx`. Vì ràng buộc không cho sửa file cũ, việc chỉ thêm thư mục này không thể làm route tự xuất hiện.

Mã nguồn hoàn chỉnh ở mức module và dùng các endpoint hiện có:

- `GET /devices`
- `GET /devices/:id/analytics`
- `GET /devices/:id/status-history`
- `GET /alerts/incidents`
- `GET /alerts/states`

Không có backend, schema, contract hay dependency mới. Sơ đồ chỉ lưu tọa độ vào `localStorage` với khóa `airguard.sensor-map.v1`. PDF được tạo bằng hộp thoại in chuẩn của trình duyệt (chọn “Save as PDF”/“Lưu dưới dạng PDF”).

## Cách tích hợp sau khi được phép sửa file cũ

Xem `integration-proposal.patch` trong thư mục này. Patch đề xuất chỉ thêm một lazy import, một mục sidebar và route `/app/extensions` vào `App.tsx`. Không áp dụng patch nếu vẫn phải tuân thủ add-only tuyệt đối.

