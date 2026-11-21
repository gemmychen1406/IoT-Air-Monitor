# Bản tin môi trường và kết nối

[Routes](routes.ts) đọc/ghi chính sách kênh và phục vụ `GET /api/v1/environment/history`. Admin quản lý Telegram chung; người dùng cấu hình Push cá nhân. [Trang cài đặt và lịch sử](../../../../web/src/features/notification-center) dùng các chính sách này cho giờ yên lặng, lịch nhận, bộ lọc thiết bị và mô phỏng.

[Scheduler](scheduler.ts) nhận diện kỳ bản tin, cửa sổ biến động và sự kiện kết nối. [Delivery](delivery.ts) dùng transport hiện có; tin thường có ID riêng và lịch sử riêng. Khi ghép [runtime](../../runtime.ts), giữ một vòng scheduler cho mỗi runtime cùng cơ chế chống trùng trong database. Giữ khoảng chờ cho mẫu đến trễ, giờ yên lặng qua nửa đêm, kiểm tra lại đồng hồ sau ghi lượt thử và loại tin kết nối lại đã bị sự kiện mới thay thế.

Kiểm tra `npm.cmd test -- environment-notifications delivery-send-guard` với `TEST_ENVIRONMENT_DATABASE_URL` trỏ DB thử. Kiểm tra cả resume sau yên lặng và chống trùng khi khởi động lại.

[Quy trình ghép toàn nhánh](../../../../../README.md)
