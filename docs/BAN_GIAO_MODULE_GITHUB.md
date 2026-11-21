# Bàn giao module AirGuard

Mốc so sánh là nội dung của `IoT-Air-Monitor-main.zip`, bỏ qua khác biệt CRLF/LF trong tệp văn bản. Sau khi đối chiếu lịch sử GitHub, 136 tệp trong ZIP khớp commit `f89a643`. Thống kê bên dưới mô tả commit chức năng `1d95786`. Xem [README tích hợp](../README.md) để ghép vào nhánh mới hơn và mở README của từng chức năng. Trước khi sắp xếp có 70 tệp mới và 34 tệp gốc thay đổi. Bản bàn giao thêm IncidentDetails.tsx, .gitignore và tài liệu này. Trong 136 tệp gốc có 102 tệp giữ nguyên và 34 tệp sửa. Không có tệp bị xóa. Package manifest, lockfile và migration gốc giữ nguyên.

## Đọc theo chức năng

| Module | Backend trong apps/api/src/modules | Web trong apps/web/src/features | Điểm tích hợp cần review |
| --- | --- | --- | --- |
| Khu vực, phòng và sơ đồ | monitoring-spaces/ | monitoring-spaces/ | Gán phòng, vị trí, trạng thái realtime, phân quyền và khóa bố trí |
| Danh bạ và chi tiết sự cố | incident-response/ | incident-response/ | IncidentPage tải dữ liệu và giữ xác nhận nghiệp vụ. IncidentDetails ghép timeline, tiếp nhận, lịch sử và liên hệ |
| Gửi và tiếp nhận cảnh báo | alert-delivery/ | notification-center/ và incident-response/ | Queue Telegram/Push, retry, nhắc CRITICAL, phiên và bộ lọc thiết bị, service worker |
| Bản tin định kỳ và kết nối | environment/ | notification-center/ | Scheduler dùng chung runtime và transport; chính sách kênh/giờ yên lặng |
| Simulator JSON/CSV và bốn thiết bị | tools/device-simulator/src/ và scenarios/ | Dùng chung sơ đồ và trang sự cố | CLI dùng payload và endpoint telemetry cũ; script vận hành tại tools/operations/ |

Các kiểu API dùng chung nằm trong packages/contracts/src/. Bảy migration mới nằm trong packages/database/prisma/migrations/ theo thứ tự timestamp. Khi merge, review đồng thời schema và migration, nhất là nếu nhánh nhóm đã có migration mới. Với queue, kiểm tra chỉ có một đường gửi cho mỗi đích. Giữ các route cũ và đường dẫn /push-sw.js khi ghép frontend. Chỉ lấy các thư mục mới sẽ thiếu phần tích hợp ở các tệp cũ.

## Lấy phần bàn giao

Nhánh cá nhân là `feature/airguard-spaces-notifications`. Khi đã có nhánh này, ưu tiên dùng Git để review và ghép cả code lẫn tài liệu. File patch xuất riêng trước đó chỉ chứa commit chức năng. Các README bổ sung sau đó nằm trên nhánh. [Hướng dẫn cho người tích hợp](../README.md).

## Diff của từng tệp gốc

Số dòng thêm/bớt tính theo đoạn thay đổi văn bản sau khi chuẩn hóa xuống dòng. Các test nằm ngay trong bảng để phân biệt thay đổi runtime với thay đổi test.

| Tệp gốc | Thêm | Bớt |
| --- | ---: | ---: |
| `apps/api/src/app.ts` | 27 | 3 |
| `apps/api/src/config.ts` | 2 | 0 |
| `apps/api/src/modules/auth.ts` | 4 | 3 |
| `apps/api/src/modules/maintenance.ts` | 1 | 1 |
| `apps/api/src/modules/notifications.ts` | 80 | 32 |
| `apps/api/src/modules/push-subscriptions.ts` | 15 | 6 |
| `apps/api/src/modules/telegram-client.ts` | 17 | 1 |
| `apps/api/src/modules/telemetry.ts` | 4 | 2 |
| `apps/api/src/modules/web-push-client.ts` | 5 | 4 |
| `apps/api/src/modules/web-push.ts` | 122 | 39 |
| `apps/api/src/runtime.ts` | 35 | 6 |
| `apps/api/src/server.ts` | 1 | 0 |
| `apps/api/tests/telegram-client.test.ts` | 13 | 0 |
| `apps/api/tests/telegram.test.ts` | 2 | 2 |
| `apps/api/tests/web-push-client.test.ts` | 19 | 0 |
| `apps/api/tests/web-push.test.ts` | 30 | 1 |
| `apps/web/index.html` | 2 | 0 |
| `apps/web/public/push-sw.js` | 56 | 16 |
| `apps/web/src/App.tsx` | 56 | 45 |
| `apps/web/src/components/PushSettings.tsx` | 22 | 11 |
| `apps/web/src/lib/api.ts` | 3 | 1 |
| `apps/web/src/lib/push-service-worker.test.ts` | 53 | 4 |
| `apps/web/src/lib/web-push.ts` | 2 | 1 |
| `apps/web/src/pages/AlertsPage.tsx` | 54 | 15 |
| `apps/web/src/pages/DeviceDetailPage.tsx` | 4 | 1 |
| `apps/web/src/pages/DevicesPage.tsx` | 1 | 0 |
| `apps/web/src/pages/IncidentPage.tsx` | 7 | 56 |
| `apps/web/src/pages/SettingsPage.tsx` | 7 | 2 |
| `apps/web/src/styles.css` | 14 | 0 |
| `packages/contracts/src/index.ts` | 4 | 0 |
| `packages/contracts/src/push.ts` | 5 | 2 |
| `packages/database/prisma/schema.prisma` | 196 | 2 |
| `tools/device-simulator/src/main.ts` | 195 | 79 |
| `tools/device-simulator/src/payload.ts` | 10 | 7 |
