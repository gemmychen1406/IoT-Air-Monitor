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

| Chọn thiết bị          | Có thể xem gì                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Cảm biến phòng khách   | Chất lượng bình thường, một đoạn nhiệt độ/độ ẩm ít thay đổi trong lịch sử.                                |
| Cảm biến phòng bếp     | Lời nhắc lỗi đọc nhiệt độ/độ ẩm, khoảng thiếu mẫu, đoạn nhiệt độ thay đổi nhanh, lịch sử mất/kết nối lại. |
| Cảm biến phòng ngủ     | Chưa đồng bộ giờ, bốn phiên khởi động, một lần đổi firmware, một dấu hiệu giờ đo đi lùi trong lịch sử.    |
| Cảm biến ban công      | Không còn mẫu mới và đã mất kết nối.                                                                      |
| Thiết bị chưa kết nối  | Trạng thái chưa có số đo, không tạo số liệu giả.                                                          |
| Cảm biến đang chuẩn bị | MQ-2 khởi động, MQ-7 gia nhiệt, giải thích vì sao chưa dùng để đánh giá.                                  |

Thiết bị online có mẫu demo mới mỗi 5 giây. Kết quả kiểm tra là ảnh chụp theo khoảng đã chọn; bấm **Cập nhật** để phân tích lại. Nhãn thời gian cho biết kết quả được tạo khi nào. Mặc định 24 giờ, có 1 giờ, 7 ngày và khoảng tự chọn tối đa 14 ngày.

## 1. Chất lượng dữ liệu

**Ý nghĩa:** phân biệt mẫu đọc lỗi, mẫu đang chuẩn bị và tín hiệu chưa hiệu chuẩn. Không đánh đồng `uncalibrated` với `invalid`.

**Cách dùng:** chọn thiết bị và thời gian, mở **Chất lượng dữ liệu**. Mỗi cảm biến có thanh tỷ lệ và số lượng bằng chữ. Đọc phần **Hiểu các trạng thái** khi cần. Các mẫu có `age_ms > 30.000` được đếm thêm là số đo cũ trong gói gửi.

**Luồng:** mẫu gốc PostgreSQL → đếm `quality` riêng cho DHT11, MQ-2, MQ-7, lửa → trả tổng và từng nhóm → frontend biểu diễn. DHT11 có chất lượng chung cho nhiệt độ và độ ẩm. Tỷ lệ tính trên số mẫu nhận, không phải thời gian hoạt động hoặc sai số đo. Các trạng thái không áp dụng cho một cảm biến có số lượng 0.

## 2. Gián đoạn & bất thường

**Ý nghĩa:** chỉ ra khoảng dữ liệu đáng xem lại, kèm bằng chứng; không tự kết luận thiết bị hỏng.

**Cách dùng:** mở **Gián đoạn & bất thường**, xem loại dấu hiệu, cảm biến, khoảng nhận trên server và giải thích. **Tùy chỉnh kiểm tra** cho phép đổi ngưỡng rồi áp dụng hoặc khôi phục mặc định.

**Luồng:** đọc mẫu → sắp theo `boot_counter`, `seq` → so thời gian hoạt động trong cùng `boot_id` → kiểm tra giá trị các mẫu sẵn sàng. Kiểm tra thêm khoảng im lặng giữa các lần server nhận và các biên phù hợp. Thời gian trước khi đăng ký thiết bị không được coi là khoảng thiếu mẫu.

Quy tắc mặc định:

- Thiếu mẫu: quá 3 lần chu kỳ tham chiếu. Chu kỳ lấy từ phiên bản cấu hình ghi trên mẫu; nếu thiếu lịch sử cấu hình, báo phân tích chưa đầy đủ và tắt lời nhắc.
- Ít thay đổi: tối thiểu 15 phút liên tục; sai khác so với mốc đầu đoạn không quá 0,05 °C, 0,2 điểm %RH hoặc 0,05% toàn thang ADC. Không để sai lệch nhỏ tích lũy thành một chuỗi “đứng” giả.
- Thay đổi nhanh: hai mẫu liên tục cách nhau tối đa 2 phút, tăng/giảm ít nhất 5 °C, 15 điểm %RH hoặc 25% toàn thang ADC.
- Bỏ qua mẫu lỗi, khởi động, gia nhiệt, tuổi cảm biến quá 30 giây; không nối đoạn đứng hoặc nhảy qua reboot, khoảng trống hay thay đổi độ phân giải ADC.

Mẫu gửi bù có thể được nhận cùng lúc dù thời gian đo cách xa nhau. Bảng ghi rõ thời gian nhận và giải thích khoảng cách theo uptime. Tối đa 200 dấu hiệu gần nhất, có tổng số dấu hiệu.

## 3. Kết nối

**Ý nghĩa:** tách mất kết nối khỏi không có số đo mới, giúp người dùng biết cần kiểm tra mạng/nguồn hay phần cảm biến.

**Cách dùng:** mở **Kết nối** để xem số lần chuyển offline, thời gian offline/chưa xác định, trung vị khoảng cách mẫu và trung vị/P95 thời gian đo–nhận.

**Luồng:** lịch sử trạng thái ngay trước khoảng chọn làm mốc → các chuyển trạng thái trong khoảng → cắt từng đoạn theo hai biên → cộng thời gian. Phần chưa có mốc tính **chưa xác định**, không tự coi là online hoặc offline. Một khoảng offline đã bắt đầu trước cửa sổ đóng góp thời gian nhưng không bị tính là một lần chuyển offline mới trong cửa sổ.

Khoảng cách mẫu dùng uptime trong cùng phiên; không đo trực tiếp khoảng cách gói mạng. Độ trễ chỉ dùng mẫu đồng bộ giờ, có chênh lệch không âm. Nó có thể gồm thời gian chờ gửi, mạng và lệch đồng hồ. Khi lịch sử bị cắt hoặc đã tổng hợp, không hiển thị tổng thời gian kết nối như kết quả đầy đủ.

## 4. Mô phỏng phân bố

**Ý nghĩa:** công cụ minh họa để trình diễn mô hình phân bố và quan sát giả định. Không xác định khu vực an toàn, không quy đổi ADC thành nồng độ khí.

Bản đồ dùng tọa độ tương đối với gốc (0%, 0%) ở góc trên trái, X tăng sang phải và Y tăng xuống dưới. Bấm hoặc chạm để đọc giá trị tại một vị trí. Khi bản đồ có tiêu điểm, phím mũi tên dịch 1%, giữ Shift để dịch 10%. Màu kem nhạt đến nâu đậm dùng cùng thang 0–100 trên mọi ảnh. Đường viền đánh dấu các mức 25, 50 và 75. Vùng gạch chéo thiếu dữ liệu. Các vị trí giữa nút lưới được lấy mẫu song tuyến tính khi vẽ và khi đọc điểm.

Để thử ngay, chọn **Từ tín hiệu cảm biến → Nguồn dữ liệu → Bộ số đo mẫu · 6 điểm → Xem bộ số đo mẫu**. Sáu điểm trong cùng một phòng giả định có cặp số ADC MQ-2 và MQ-7 12 bit. Giao diện lấy kênh đã chọn, chia cho 4095 để đổi sang % toàn thang rồi chạy cùng phép nội suy như khi chụp số đo từ thiết bị. Bộ mẫu nằm trong trình duyệt và không ghi vào lịch sử đo.

### Thử kịch bản

Lần mở đầu hiển thị ảnh dừng ở bước 160 với nguồn bật và gió sang phải để có thể đọc bản đồ ngay.

1. Bấm **Bắt đầu**, quan sát điểm Nguồn và tín hiệu tăng quanh nguồn.
2. Thử **Luồng khí** sang trái/phải, thay đổi mức nguồn hoặc vị trí nguồn.
3. Bỏ chọn **Bật nguồn minh họa**, tăng **Thông gió**, tiếp tục quan sát tín hiệu giảm.
4. **Tạm dừng** để đọc bảng; **Đặt lại** để xóa lưới và bắt đầu lại. Không tự chạy hoạt ảnh khi mở trang.

**Luồng:** tham số người dùng → Web Worker → bước sai phân hữu hạn trên lưới 48×48 → `Float32Array` → Canvas 2D, chú giải và bảng tóm tắt. Phương trình minh họa gồm khuếch tán, vận chuyển upwind, nguồn Gaussian và giảm tín hiệu do thông gió. Hệ số bảo thủ để giữ tính ổn định; chặn giá trị trong 0–100. Bước tính và thang tín hiệu không có đơn vị vật lý. Biên kín, thông gió là giảm toàn vùng, chưa mô hình hóa tường/cửa/độ cao/phản ứng hóa học. Không phải mô phỏng CFD đã kiểm chứng.

### Từ tín hiệu cảm biến

1. Chọn chế độ, MQ-2 hoặc MQ-7, nguồn thật hoặc mô phỏng.
2. Chọn 3–8 thiết bị, nhập tọa độ ngang/dọc 0–100% trên vùng minh họa.
3. Bấm **Lấy số đo mới**. Các điểm đánh số tương ứng bảng số đo; ảnh chụp có thời gian và không tự thay đổi.

**Luồng:** trạng thái/số đo mới nhất từ API thiết bị hiện có → kiểm tra online, chất lượng, tuổi mẫu và cùng độ phân giải → chuẩn hóa % toàn thang ADC → nội suy IDW bậc 2 trong Worker → Canvas và bảng số đo.

Từ chối mẫu quá cũ (tuổi từ lúc nhận cộng `age_ms` vượt max(30 giây, 3 chu kỳ)), mẫu chưa sẵn sàng, khác ADC profile, quá ít/quá nhiều điểm hoặc điểm gần thẳng hàng. Vùng cách điểm gần nhất hơn 55% chiều rộng lưới để xám. Khoảng cách không phải độ tin cậy thống kê; cảm biến cùng ADC vẫn có thể khác độ nhạy. Tọa độ lưu riêng theo người dùng trong trình duyệt, chỉ phục vụ thử nghiệm; không sửa sơ đồ phòng của module khác.

Web Worker/Canvas có sẵn trong trình duyệt hiện đại, không thêm thư viện đồ họa. Nếu Worker không chạy, dùng cùng thuật toán trên lưới nhỏ trực tiếp. Giao diện có bảng thay thế cho thông tin chính trên canvas.

## 5. Thời gian thiết bị

**Ý nghĩa:** nhận ra dữ liệu không thể dùng thời gian đo để đọc lịch sử hoặc đánh giá chậm trễ.

**Cách dùng:** xem số mẫu đã/chưa đồng bộ, số lần giờ đo đi lùi và mẫu có giờ đo sau lúc nhận. Nếu chưa đồng bộ, dùng thời gian server nhận ở trang lịch sử hiện có.

**Luồng:** `time_quality`, `sampled_at`, `received_at`, `boot_id`, `seq` → thống kê và so cặp mẫu đúng thứ tự trong cùng phiên. Mẫu đến muộn không tự bị coi là giờ đi lùi. Không so đồng hồ qua reboot. Chênh lệch âm được đếm riêng và loại khỏi độ trễ.

## 6. Khởi động & phiên bản

**Ý nghĩa:** quan sát reboot nhiều lần và firmware thay đổi để hỗ trợ tìm nguyên nhân thiết bị không ổn định.

**Cách dùng:** đọc tổng số phiên/lần đổi phiên, bảng thời gian nhận đầu–cuối và phiên bản phần mềm. Mở **Mã kỹ thuật** khi cần người phụ trách hỗ trợ.

**Luồng:** mẫu đã sắp thứ tự → nhóm `boot_id` → đếm phiên và firmware, nhận diện thay đổi theo thứ tự mẫu. Phiên đầu không được tính là reboot; số phiên trừ một chỉ là mức tối thiểu quan sát được. Bảng giữ tối đa 200 phiên/lần đổi firmware gần nhất, tổng vẫn phản ánh toàn bộ mẫu phân tích được. Không có dữ liệu nguyên nhân reset nên không khẳng định mất điện hay lỗi firmware.

## Việc cần kiểm tra — lời nhắc cho hộ gia đình

Mỗi thẻ có **tình trạng → bằng chứng → việc có thể làm**; phần đầu ghi tên và vị trí thiết bị đã khai báo. Không tự đoán phòng khi chưa có vị trí. Đây là lời nhắc trong ứng dụng, không phải lịch nhắc, thông báo đẩy hoặc khuyến nghị mục tiêu môi trường của nhóm khác.

| Dấu hiệu                                                                   | Lời nhắc và hướng xử lý                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Mẫu cuối cách cuối khoảng chọn quá max(60 giây, 3 chu kỳ)                  | Đã lâu chưa có số đo; kiểm tra nguồn và Wi‑Fi, cập nhật lại.                                                       |
| Ít nhất 3 mẫu lỗi, chiếm >=30% mẫu trong 5 phút cuối; mẫu mới nhất vẫn lỗi | Kiểm tra cảm biến cụ thể; xem có bị che, ẩm hoặc lỏng kết nối. Khi mẫu cuối trở lại hợp lệ, bỏ lời nhắc lỗi này.   |
| Đa số mẫu trong 5 phút cuối chưa đồng bộ, mẫu cuối cũng chưa đồng bộ       | Kiểm tra Internet, chờ đồng bộ giờ, dùng thời gian nhận.                                                           |
| Ít nhất 3 lần đổi phiên trong giờ cuối                                     | Kiểm tra nguồn/ổ cắm/dây; nhờ người phụ trách nếu tiếp diễn.                                                       |
| Mẫu gần nhất có `age_ms > 30.000`                                          | Thiết bị có thể đang gửi lại giá trị cũ; chờ mẫu mới và kiểm tra cảm biến.                                         |
| Chuỗi đứng hoặc bước nhảy kết thúc ở mẫu mới nhất trong 1 phút cuối        | Kiểm tra điều kiện xung quanh/cách đặt; giải thích thay đổi thật hoặc môi trường ổn định cũng có thể gây dấu hiệu. |
| MQ-7 khởi động/gia nhiệt                                                   | Thông tin chờ chuẩn bị, chưa dùng số đo để đánh giá.                                                               |
| Không có mẫu                                                               | Thử thời gian khác hoặc kiểm tra kết nối nếu mới lắp. Không hiển thị “thiết bị tốt”.                               |

Lời nhắc mô tả **cuối khoảng chọn**, không phải một kết luận luôn đúng hiện tại. Nếu xem lịch sử, giao diện có thông báo riêng. Khi cập nhật và dữ liệu hồi phục, các quy tắc được đánh giá lại. Mất nguồn chưa có số đo không bị diễn giải thành hết nguy hiểm. Không có lời nhắc cũng không chứng nhận an toàn.

## Tổ chức code, tích hợp và giới hạn

- Frontend: `apps/web/src/features/device-diagnostics/`, CSS có tiền tố `dd-`, lazy load cả module và phần mô phỏng.
- API: `apps/api/src/modules/device-diagnostics/`, gồm route đọc dữ liệu và hàm phân tích thuần.
- Contract: `packages/contracts/src/device-diagnostics.ts`, Zod kiểm tra khoảng/ngưỡng; endpoint `GET /api/v1/devices/:id/diagnostics?from=...&to=...`.
- Chỉ thêm điểm tích hợp vào `App.tsx`, API `app.ts`, contract `index.ts`. Dùng session, phân quyền đọc, API response envelope, React Query và kiểu giao diện hiện có. Admin/operator/viewer đều xem được theo quyền đọc hiện tại.
- Không thay schema/migration, ingestion, cảnh báo, cấu hình thiết bị hoặc các module của thành viên khác. API diagnostics không ghi database.
- Query chạy transaction RepeatableRead, tối đa 14 ngày, 30.000 mẫu gốc, 10.000 trạng thái và 1.000 cấu hình. Vượt giới hạn có cờ rõ ràng; không tạo lời nhắc khi dữ liệu thiếu. Có rollup giao khoảng thì báo lịch sử đã tổng hợp, không dựng lại chi tiết từ min/max.
- Đọc khoảng theo thời gian **server nhận**, từ bao gồm đến không bao gồm. Ngày giờ hiển thị theo trình duyệt của người dùng, thường Asia/Saigon trên máy này.
- Tùy chỉnh và tọa độ có khóa phiên bản, tách theo tài khoản; lỗi storage không làm hỏng màn hình. Không đồng bộ sang máy khác.
- Muốn dùng database thật: cấu hình `.env` theo `.env.example`, chạy luồng dev hiện có `npm run db:generate`, `npm run db:migrate`, `npm run dev`. Công cụ `diagnostics:local` luôn dành riêng cho demo local.

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

Kiểm tra đăng nhập, sáu tab, lời nhắc lỗi/đồng hồ, phiên khởi động, Worker/Canvas, nội suy, theme sáng và màn hình 390px. Ảnh chụp lưu trong `.local/screenshots/`. Đây là kiểm tra chức năng và bố cục, chưa phải nghiên cứu người dùng thực tế.

## Cơ sở thiết kế và công nghệ

- [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/): đưa kết quả và thao tác phổ biến lên trước; ngưỡng/mã kỹ thuật trong phần mở rộng.
- [W3C: Complex Images](https://www.w3.org/WAI/tutorials/images/complex/): biểu đồ/bản đồ có mô tả và dữ liệu bằng chữ đi kèm.
- [W3C: Use of Color](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html): màu luôn kèm tên trạng thái, số lượng hoặc lời giải thích.
- [MDN: Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers): tính toán nền bằng Worker và trao đổi message; không thao tác DOM trong Worker.
- [Esri: How IDW works](https://doc.esri.com/en/arcgis-pro/latest/tool-reference/spatial-analyst/how-idw-works.html): IDW là trung bình trọng số theo khoảng cách, không phải mô hình vật lý của khí. Dùng làm lớp minh họa có ghi rõ giả định.
- [Embedded PostgreSQL](https://github.com/leinelissen/embedded-postgres): chạy PostgreSQL riêng cho preview/test, không yêu cầu người dùng cài một dịch vụ database.
