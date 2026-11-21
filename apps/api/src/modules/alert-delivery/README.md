# Gửi cảnh báo, tiếp nhận và lịch sử

[Routes](routes.ts) phục vụ `/api/v1/alerts/delivery-history`, `/api/v1/alerts/incidents/:id/receipts` và tùy chọn chi tiết Push. [Receipt](receipt.ts) kiểm tra phiên, đích nhận và giữ thời điểm tiếp nhận đầu tiên theo cặp sự cố–người dùng. Viewer xem xác nhận của mình. [Reminders](reminders.ts) lên lượt nhắc riêng khi CRITICAL còn mở và chưa ai tiếp nhận.

Điểm ghép là worker [Telegram](../notifications.ts), [Web Push](../web-push.ts), [đăng ký trình duyệt](../push-subscriptions.ts), [trang lịch sử/cài đặt](../../../../web/src/features/notification-center) và [service worker](../../../../web/public/push-sw.js). Duy trì một lượt ban đầu cho mỗi đích; retry do lỗi thuộc cùng lượt. Kiểm tra hạn, lease và token trước khi gửi. Giữ vị trí snapshot, lịch sử sau đăng xuất, tùy chọn riêng tư và link nội bộ đúng ID. Phân biệt dịch vụ chấp nhận, người dùng tiếp nhận và thiết bị phục hồi. Với đăng ký trình duyệt lâu dài, hết phiên vẫn có thể nhận; đăng xuất chủ động ngắt trình duyệt đó.

Kiểm tra `npm.cmd test -- alert-delivery-history delivery-send-guard push-service-worker incident-push`. Đặt `TEST_ALERT_DELIVERY_DATABASE_URL` cho suite lịch sử. Kiểm tra hai trình duyệt và một Telegram với `multi-device-demo` và `TEST_MULTI_DEVICE_DATABASE_URL`. Kết quả transport giả dùng để xác minh định tuyến; xác minh tin thật trên thiết bị nhận theo hướng dẫn demo.

## Dùng chung server và nhóm Telegram

**Nhóm nhận cảnh báo của đội là Air Guard Demo.** Để tham gia đúng nhóm, nhắn riêng cho người phụ trách demo AirGuard để được thêm thành viên hoặc nhận link mời. Người đang quản lý nhóm mở Telegram → Air Guard Demo → thông tin nhóm → Thêm thành viên hoặc Mời bằng liên kết, rồi gửi riêng cho nhóm trưởng. Tên nhóm dùng để đối chiếu khi mở lời mời. Thành viên chỉ cần vào nhóm để đọc tin; bật thông báo cho cuộc trò chuyện nếu muốn điện thoại hiện banner. Bot đã dùng cho demo cần có quyền gửi trong chính nhóm này.

| Thành phần | Thiết lập một lần cho môi trường chung |
| --- | --- |
| Web | Dùng một URL HTTPS ổn định. [vercel.json](../../../../../vercel.json) chuyển tiếp `/api/` và `/socket.io/` tới API Railway. Kiểm tra cả hai đích khi đổi hostname. Đặt `WEB_ORIGIN` ở backend đúng bằng origin của web, không có dấu gạch chéo cuối. |
| API và database | Dùng một dịch vụ API chạy liên tục và một PostgreSQL chung cho demo. Đặt `DATABASE_URL` của database đó trên backend, `NODE_ENV=production`. Cài dependency cần cho Prisma và tsx, chạy `npm run cloud:api:build`, áp migration với `npm run cloud:api:migrate` rồi khởi động bằng `npm run cloud:api:start`. Giữ API thức để gửi tin theo lịch khi mọi người đã đóng tab. Kiểm tra `/health/ready` trên hostname API. |
| Telegram | Người quản lý server đặt `TELEGRAM_ENABLED=true`, `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID` trỏ đúng nhóm Air Guard Demo trong phần biến môi trường của API. Để demo bằng simulator, bật `TELEGRAM_INCLUDE_SIMULATORS=true`. Thống nhất dùng server demo để phát vào nhóm; các bản chạy cá nhân có thể tắt Telegram hoặc chọn nhóm thử riêng. |
| Web Push | Tạo cặp khóa riêng cho môi trường chung bằng `npm run webpush:keys` một lần. Lưu `WEB_PUSH_ENABLED=true`, `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` và `WEB_PUSH_VAPID_SUBJECT` (ví dụ `mailto:...` với địa chỉ liên hệ thật) trên backend. Giữ nguyên khóa và DB qua các lần triển khai. Sau khi cập nhật cấu hình, khởi động lại API. |

**Mỗi thành viên:** đăng nhập cùng URL HTTPS bằng tài khoản AirGuard của mình → Cài đặt → Thông báo → bật Web Push và cho phép trình duyệt hiện thông báo. Khi demo, chọn nhận cảnh báo mô phỏng và thiết bị tương ứng. Đăng ký trên localhost thuộc môi trường local. Đăng ký mới một lần trên từng trình duyệt muốn nhận từ web chung.

**Kiểm tra từ đầu tới cuối:** đăng ký một thiết bị mô phỏng trên server chung, gán phòng và gửi kịch bản Gas vào đúng API chung bằng ID/DeviceKey do server này cấp. Mở Lịch sử gửi của sự cố và đối chiếu với một tin trong Air Guard Demo cùng thông báo trên hai trình duyệt đã đăng ký. Cả ba phải mở cùng ID trên URL HTTPS của đội. Ghi riêng kết quả dịch vụ chấp nhận và kết quả từng người thực sự nhìn thấy.

Repo công khai chỉ ghi cách xin quyền vào nhóm và tên biến cấu hình. Link mời, token, DeviceKey và khóa riêng được bàn giao qua kênh riêng.

[Quy trình ghép toàn nhánh](../../../../../README.md)
