# AirGuard · Hướng dẫn tích hợp nhánh chức năng

Nhánh `feature/airguard-spaces-notifications` bổ sung sơ đồ phòng, xử lý sự cố, gửi thông báo và simulator vào monorepo AirGuard. Người ghép code có thể bắt đầu tại bảng dưới. Mỗi README nối phần web, API, dữ liệu và test của cùng một chức năng.

| Chức năng | Tài liệu tích hợp |
| --- | --- |
| Khu vực, gán phòng, vị trí và màu thiết bị | [Khu vực & phòng](apps/api/src/modules/monitoring-spaces/README.md) |
| Banner, chi tiết sự cố, danh bạ theo vị trí | [Xử lý sự cố](apps/api/src/modules/incident-response/README.md) |
| Telegram, Web Push, nhắc CRITICAL, tiếp nhận và lịch sử | [Gửi và tiếp nhận](apps/api/src/modules/alert-delivery/README.md) |
| Bản tin định kỳ, biến động và mất/kết nối lại | [Thông báo môi trường](apps/api/src/modules/environment/README.md) |
| Phát JSON/CSV qua API, demo bốn thiết bị | [Simulator](tools/device-simulator/README.md) |

## Ghép vào nhánh của nhóm

1. **Xem đúng phạm vi.** Mốc gốc đã đối chiếu với ZIP là `f89a643`. Commit chức năng là `1d95786`. Chạy `git diff --stat f89a643 1d95786` để xem phần của tác giả và `git diff --name-only f89a643..origin/main` sau `git fetch origin` để nhận diện phần nhóm đã đổi.
2. **Ghép trên nhánh tích hợp riêng từ nhánh đích.** Dùng PR hoặc merge nhánh chức năng vào nhánh tích hợp. Với mốc main từng kiểm tra (`5e2703b`), các file đã xung đột gồm `.gitignore`, `App.tsx`, `DeviceDetailPage.tsx`, `IncidentPage.tsx`, `packages/contracts/src/index.ts` và hai file simulator `main.ts`, `payload.ts`. Khi xử lý, đối chiếu cả hai phía để giữ menu, chẩn đoán thiết bị, export contract và chế độ simulator của nhóm.
3. **Kiểm tra tầng dùng chung.** Ghép các export ở [contracts](packages/contracts/src/index.ts), đối chiếu [schema Prisma](packages/database/prisma/schema.prisma) với [các migration](packages/database/prisma/migrations). Nhánh bổ sung 7 migration từ `202611180001` đến `202611200003`. Tiếp theo kiểm tra [đăng ký route](apps/api/src/app.ts), [vòng đời worker](apps/api/src/runtime.ts) và [route/realtime web](apps/web/src/App.tsx). Duy trì cookie, Origin, CSRF và quyền kiểm tra tại API.
4. **Kiểm tra trên DB thử riêng.** Sau khi cấu hình `.env` của bản tích hợp trỏ vào DB thử, chạy ở thư mục gốc:

```powershell
npm.cmd ci
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run build
```

   Các suite PostgreSQL dùng biến `TEST_…_DATABASE_URL` riêng ghi trong README từng module. Xem số test thực chạy vì Vitest có thể bỏ qua suite thiếu biến. Khi chạy test nhiều worker, dùng DB thử tách biệt để hàng đợi của suite này không lấy job của suite khác.

5. **Nghiệm thu xuyên module.** Admin tạo phòng → gán và đặt thiết bị → phát Gas và Lửa ở hai phòng → kiểm tra dấu cảnh báo, banner và đường dẫn đúng ID → tiếp nhận → phát mẫu phục hồi của cùng thiết bị → kiểm tra lịch sử vẫn còn. Thử lại bằng viewer để kiểm tra quyền và bằng màn hình hẹp để kiểm tra sơ đồ. Xác minh nhận thật tại nhóm Telegram/trình duyệt riêng với kết quả test transport giả.

[Số dòng thay đổi theo file](docs/BAN_GIAO_MODULE_GITHUB.md) · [Kết quả các lượt kiểm tra đã chạy](docs/BAO_CAO_THAY_DOI_MVP.md) · [Cấu hình, lệnh demo và sử dụng](docs/HUONG_DAN_SU_DUNG_MVP_A_Z.md) · [Đặc tả MVP](HUONG_DAN_CODEX_AIRGUARD_MVP.md)
