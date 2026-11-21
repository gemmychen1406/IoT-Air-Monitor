# Khu vực và sơ đồ phòng

Trang `/app/spaces` đọc tổng số phòng, thiết bị và sự cố đang mở. Trang `/app/spaces/:areaId` dùng ID trên URL cho thao tác tạo phòng và tải sơ đồ. UI, điểm thiết bị và ngưỡng màu nằm trong [monitoring-spaces web](../../../../web/src/features/monitoring-spaces).

[Routes](routes.ts) xử lý danh mục, lưu trữ và gán phòng. [Room map](room-map.ts) trả số đo và sự cố theo ID thiết bị, nhận tọa độ chuẩn hóa và phiên bản bố trí. API chính là `GET /api/v1/spaces/areas/:id/map`, `PUT /api/v1/spaces/devices/:id/room` và `PUT /api/v1/spaces/devices/:id/position`. Admin chỉnh sửa, operator và viewer xem. Khi đổi phòng, cập nhật liên kết và xóa tọa độ cũ cùng giao dịch. Giữ kiểm tra phiên bản khi hai admin lưu; sự cố còn mở vẫn có ưu tiên khi thiết bị offline. Ngưỡng màu của sơ đồ chỉ điều khiển hiển thị.

Kiểm tra bằng `npm.cmd test -- room-map.test monitoring-spaces-support map-status` với `TEST_DATABASE_URL` trỏ DB thử đã migrate. Với trình duyệt, dùng [kịch bản phòng và phân quyền](../../../../../tools/operations/check-room-workflow.mjs) cùng `TEST_ROOM_BROWSER_DATABASE_URL`.

[Quy trình ghép toàn nhánh](../../../../../README.md)
