# Xử lý sự cố và liên hệ hỗ trợ

[Web](../../../../web/src/features/incident-response) cung cấp banner theo ID, chi tiết, diễn biến, tiếp nhận và danh bạ. [IncidentPage](../../../../web/src/pages/IncidentPage.tsx) giữ truy vấn sự cố và xác nhận nghiệp vụ có ghi chú. Giữ route `/app/alerts/:id` vì banner, sơ đồ, Push và Telegram đều dẫn tới đây.

[Routes](routes.ts) cho admin quản lý danh bạ; người dùng đã đăng nhập đọc `GET /api/v1/alerts/incidents/:id/support`. Danh bạ này lấy **vị trí hiện tại**, trong khi lịch sử gửi giữ vị trí lúc tạo thông báo. Nếu tải lại danh bạ lỗi, ẩn vị trí và hành động từ cache. Nút gọi mở ứng dụng điện thoại qua `tel:`. Xác nhận tiếp nhận dùng [module gửi cảnh báo](../alert-delivery/README.md); sự cố kết thúc khi có dữ liệu phục hồi.

Kiểm tra `npm.cmd test -- IncidentNotices IncidentSupport monitoring-spaces-support` với `TEST_DATABASE_URL` cho phần PostgreSQL. Kiểm tra thêm banner không bật lại sự cố cũ khi reconnect và nút Đóng chỉ ẩn thẻ.

[Quy trình ghép toàn nhánh](../../../../../README.md)
