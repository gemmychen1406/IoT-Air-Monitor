# AirGuard · Bản tích hợp để review

Bản tích hợp toàn hệ thống dùng nhánh `integration/airguard-full-system` trên nền `d47bb85`. Xem [hướng dẫn chạy, kết quả nghiệm thu và cấu hình triển khai](docs/BAN_GIAO_HE_THONG.md). Các README dưới đây mô tả từng module.

| Chức năng | Tài liệu tích hợp |
| --- | --- |
| Khu vực, gán phòng, vị trí và màu thiết bị | [Khu vực & phòng](apps/api/src/modules/monitoring-spaces/README.md) |
| Banner, chi tiết sự cố, danh bạ theo vị trí | [Xử lý sự cố](apps/api/src/modules/incident-response/README.md) |
| Telegram, Web Push, nhắc CRITICAL, tiếp nhận và lịch sử | [Gửi và tiếp nhận](apps/api/src/modules/alert-delivery/README.md) |
| Bản tin định kỳ, biến động và mất/kết nối lại | [Thông báo môi trường](apps/api/src/modules/environment/README.md) |
| Phát JSON/CSV qua API, demo bốn thiết bị | [Simulator](tools/device-simulator/README.md) |

## Chạy thử bản bàn giao

1. **Phạm vi.** Ba commit nguồn là `1d95786` (code), `6447b79` (README module) và `b979d53` (server chung và nhóm Telegram). Tại lúc tích hợp, commit cuối chỉ có trên nhánh nguồn local.
2. **Phần đã ghép.** Menu Kiểm tra thiết bị và các route từ main cùng tồn tại với sơ đồ, lịch sử, tiếp nhận và danh bạ. Simulator giữ các kịch bản, duration/amplitude/seed/repeat của main và thêm replay JSON/CSV. Contract giữ cả gas-level, device-diagnostics và các kiểu AirGuard. Các trang mới dùng API PageTitle hiện hành của main.
3. **Kiểm tra tầng dùng chung.** Ghép các export ở [contracts](packages/contracts/src/index.ts), đối chiếu [schema Prisma](packages/database/prisma/schema.prisma) với [các migration](packages/database/prisma/migrations). Nhánh bổ sung 7 migration từ `202611180001` đến `202611200003`. Tiếp theo kiểm tra [đăng ký route](apps/api/src/app.ts), [vòng đời worker](apps/api/src/runtime.ts) và [route/realtime web](apps/web/src/App.tsx). Duy trì cookie, Origin, CSRF và quyền kiểm tra tại API.
4. **Kiểm tra trên DB thử riêng.** Sau khi cấu hình `.env` của bản tích hợp trỏ vào DB thử, chạy ở thư mục gốc:

```powershell
npm.cmd ci
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run build
npm.cmd run dev
```

   Các suite PostgreSQL dùng biến `TEST_…_DATABASE_URL` riêng ghi trong README từng module. Xem số test thực chạy vì Vitest có thể bỏ qua suite thiếu biến. Khi chạy test nhiều worker, dùng DB thử tách biệt để hàng đợi của suite này không lấy job của suite khác.

5. **Nghiệm thu xuyên module.** Admin tạo phòng → gán và đặt thiết bị → phát Gas và Lửa ở hai phòng → kiểm tra dấu cảnh báo, banner và đường dẫn đúng ID → tiếp nhận → phát mẫu phục hồi của cùng thiết bị → kiểm tra lịch sử vẫn còn. Thử lại bằng viewer để kiểm tra quyền và bằng màn hình hẹp để kiểm tra sơ đồ. Xác minh nhận thật tại nhóm Telegram/trình duyệt riêng với kết quả test transport giả.

[Số dòng thay đổi theo file](docs/BAN_GIAO_MODULE_GITHUB.md) · [Kết quả các lượt kiểm tra đã chạy](docs/BAO_CAO_THAY_DOI_MVP.md) · [Cấu hình, lệnh demo và sử dụng](docs/HUONG_DAN_SU_DUNG_MVP_A_Z.md) · [Đặc tả MVP](HUONG_DAN_CODEX_AIRGUARD_MVP.md)
