# Kiểm tra thiết bị — nhánh Ha/device-diagnostics

Module hỗ trợ hộ gia đình hiểu dữ liệu cảm biến và biết khi nào nên kiểm tra thiết bị. Tất cả chức năng nằm tại `/app/device-diagnostics`. Kết quả phân tích và lời nhắc không thay đổi số đo, cấu hình phần cứng hoặc trạng thái sự cố.

## Chạy local để xem trước

Yêu cầu: Node.js >= 22.12, npm, Internet trong lần cài đầu. Bản này đã kiểm tra trên Windows x64 với Node 24. Không cần Docker, PostgreSQL cài sẵn, ESP32 hoặc tài khoản dịch vụ ngoài.

Mở PowerShell trong `D:\IoT-Air-Monitor`:

```powershell
npm ci
npm run diagnostics:local
```

Hoặc dùng script tự cài dependencies nếu chưa có:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\diagnostics-local\start.ps1
```

Giữ terminal đang chạy, mở **http://127.0.0.1:5173/app/device-diagnostics**. Đăng nhập bằng email `ha@airguard.local` và mật khẩu local được in trong terminal. Mật khẩu sinh ngẫu nhiên một lần, được giữ trong `.local/diagnostics-preview/credentials.json` để dùng lại. Không dùng mật khẩu này trên dịch vụ khác.

Script tạo PostgreSQL chỉ lắng nghe loopback, ưu tiên cổng 55432 và tự chọn cổng trống nếu cổng đó bận. Database `airguard_diagnostics_preview_utf8` được khởi tạo trong vùng dữ liệu mới cho mỗi lần chạy, áp dụng migration hiện có, tạo tài khoản và sáu thiết bị **mô phỏng**. Script không đọc `.env` hoặc `DATABASE_URL` bên ngoài; Telegram và Web Push không được bật. Database và thông tin đăng nhập nằm trong `.local/`, đã được Git bỏ qua. Package `embedded-postgres` chỉ là dev dependency cho công cụ local, không phải dependency giao diện hoặc API production.

API ở cổng 4000, web ở 5173. Nếu một trong hai cổng này đã dùng, script dừng và báo rõ; không tự tắt ứng dụng khác. Dùng cùng hostname `127.0.0.1` khi truy cập để cookie và kiểm tra Origin khớp nhau. Ctrl+C dừng web/API và dùng `pg_ctl` để dừng PostgreSQL theo cách chuẩn. Mỗi lần khởi chạy có database demo mới: các thao tác sửa tài khoản/thiết bị trong bản preview trước không được mang sang lần chạy sau; tùy chỉnh kiểm tra và tọa độ lưu trong trình duyệt vẫn còn. Không xóa hoặc ghi đè database cũ hay database ngoài. Dữ liệu demo tạo trực tiếp để kiểm tra các tình huống, không phải số đo vật lý. Các thư mục database tạm được giữ trong `.local/` để tránh tự xóa dữ liệu.

### Hành trình xem thử

1. Mở **Thiết bị cần chú ý**. Chọn một dòng để xem bằng chứng và bước kiểm tra. Mở **Tất cả thiết bị** để xem cả trạm đã hồi phục hoặc đang gửi bình thường.
2. Chọn nhóm gửi dữ liệu, số đo hoặc giờ máy. Chọn khoảng thời gian để xem lịch sử và điều chỉnh ngưỡng trong phần mở rộng.
3. Mở **Bản đồ phân bố trong phòng**, chọn phòng đã đăng ký và chỉ số. Đặt trạm và tọa độ tại **Khu vực & phòng**. Nút **?** giải thích ký hiệu và cách đọc.

## Dữ liệu chẩn đoán

Danh sách dùng `GET /api/v1/diagnostics/summary` mỗi 30 giây, nhận các ngưỡng kiểm tra giống báo cáo từng trạm. Phân tích dùng lịch sử gần nhất với giới hạn số mẫu cho từng trạm. Ngưỡng lỗi đọc và sai giờ xét các mẫu gần nhất. Mất kết nối xét lần liên lạc cuối và chu kỳ gửi. Dữ liệu bị cắt, đã tổng hợp hoặc thiếu cấu hình có trạng thái riêng.

Chi tiết vẫn dùng `GET /api/v1/devices/:id/diagnostics` với khoảng thời gian tối đa 14 ngày. Cửa sổ lịch sử độc lập với danh sách hiện tại. Tùy chỉnh ngưỡng và phòng vừa chọn được lưu theo tài khoản trên trình duyệt.

## Phân bố tín hiệu

Bản đồ dùng phòng đang hoạt động, thiết bị được gán và tọa độ từ sơ đồ phòng. Các điểm mới, có tọa độ và cùng độ phân giải ADC được so sánh trong từng nguồn thật hoặc mô phỏng. Với ba vị trí đủ tách biệt, Web Worker tính nội suy IDW bậc hai, giữ vân chéo ngoài vùng hỗ trợ. Một hoặc hai điểm vẫn có thể xem giá trị đo. Bấm vào điểm để xem giờ đo và chuyển đến chẩn đoán. Một phòng trống hiển thị liên kết tới sơ đồ.

## Kiểm tra

```powershell
npm run typecheck
npx eslint apps/web/src/features/device-diagnostics apps/api/src/modules/device-diagnostics packages/contracts/src/device-diagnostics.ts tools/diagnostics-local apps/api/tests/device-diagnostics.test.ts
npm run build
npm run diagnostics:test
```

`diagnostics:test` tạo cluster/database test mới trong `.local/diagnostics-tests/` với cổng tự chọn, chạy migration rồi Vitest, dừng PostgreSQL khi xong. Không reset hoặc drop database đã có. Bộ chạy loại trừ `apps/api/tests/backup.test.ts` vì test cũ này bắt buộc Docker `postgres:17-alpine`; kiểm thử backup không được coi là đã xác nhận trong môi trường không Docker. Các unit test backup còn lại vẫn chạy.

Kiểm thử trình duyệt, khi bản preview đang chạy:

```powershell
npx playwright install chromium
node tools/diagnostics-local/browser-check.mjs
```

Kiểm tra đăng nhập, danh sách ưu tiên, ba nhóm bằng chứng, tra cứu phòng, bản đồ khi có tọa độ, trợ giúp bằng bàn phím, theme sáng và màn hình 390px. Ảnh chụp lưu trong `.local/screenshots/`. Đây là kiểm tra chức năng và bố cục, chưa phải nghiên cứu người dùng thực tế.

## Cơ sở thiết kế và công nghệ

- [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/): đưa kết quả và thao tác phổ biến lên trước; ngưỡng/mã kỹ thuật trong phần mở rộng.
- [W3C: Complex Images](https://www.w3.org/WAI/tutorials/images/complex/): biểu đồ/bản đồ có mô tả và dữ liệu bằng chữ đi kèm.
- [W3C: Use of Color](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html): màu luôn kèm tên trạng thái, số lượng hoặc lời giải thích.
- [MDN: Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers): tính toán nền bằng Worker và trao đổi message; không thao tác DOM trong Worker.
- [Esri: How IDW works](https://doc.esri.com/en/arcgis-pro/latest/tool-reference/spatial-analyst/how-idw-works.html): IDW là trung bình trọng số theo khoảng cách, không phải mô hình vật lý của khí. Dùng làm lớp minh họa có ghi rõ giả định.
- [Embedded PostgreSQL](https://github.com/leinelissen/embedded-postgres): chạy PostgreSQL riêng cho preview/test, không yêu cầu người dùng cài một dịch vụ database.
