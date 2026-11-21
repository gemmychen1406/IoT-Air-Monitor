# Gửi cảnh báo, tiếp nhận và lịch sử

[Routes](routes.ts) phục vụ `/api/v1/alerts/delivery-history`, `/api/v1/alerts/incidents/:id/receipts` và tùy chọn chi tiết Push. [Receipt](receipt.ts) kiểm tra phiên, đích nhận và giữ thời điểm tiếp nhận đầu tiên theo cặp sự cố–người dùng. Viewer xem xác nhận của mình. [Reminders](reminders.ts) lên lượt nhắc riêng khi CRITICAL còn mở và chưa ai tiếp nhận.

Điểm ghép là worker [Telegram](../notifications.ts), [Web Push](../web-push.ts), [đăng ký trình duyệt](../push-subscriptions.ts), [trang lịch sử/cài đặt](../../../../web/src/features/notification-center) và [service worker](../../../../web/public/push-sw.js). Duy trì một lượt ban đầu cho mỗi đích; retry do lỗi thuộc cùng lượt. Kiểm tra hạn, lease và token trước khi gửi. Giữ vị trí snapshot, lịch sử sau đăng xuất, tùy chọn riêng tư và link nội bộ đúng ID. Phân biệt dịch vụ chấp nhận, người dùng tiếp nhận và thiết bị phục hồi. Với đăng ký trình duyệt lâu dài, hết phiên vẫn có thể nhận; đăng xuất chủ động ngắt trình duyệt đó.

Kiểm tra `npm.cmd test -- alert-delivery-history delivery-send-guard push-service-worker incident-push`. Đặt `TEST_ALERT_DELIVERY_DATABASE_URL` cho suite lịch sử. Kiểm tra hai trình duyệt và một Telegram với `multi-device-demo` và `TEST_MULTI_DEVICE_DATABASE_URL`. Kết quả transport giả dùng để xác minh định tuyến; xác minh tin thật trên thiết bị nhận theo hướng dẫn demo.

[Quy trình ghép toàn nhánh](../../../../../README.md)
