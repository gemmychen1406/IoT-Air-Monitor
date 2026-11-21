# Cài đặt và demo AirGuard MVP

## Khởi động lại AirGuard trên máy Windows này

PostgreSQL 18 trên máy này tự bật cùng Windows. AirGuard đã lưu cấu hình bot, nhóm Telegram và tùy chọn nhận cảnh báo mô phỏng. Sáng mai chỉ cần làm hai bước.

**1. Chạy AirGuard.** Mở PowerShell thường, dán hai dòng sau và giữ cửa sổ mở trong lúc làm việc.

```powershell
Set-Location -LiteralPath 'P:\Download_backup\IoT-Air-Monitor-main\IoT-Air-Monitor-main'
npm.cmd run dev
```

Lệnh này chạy cả web, API và bộ gửi Telegram. Khi có cảnh báo mới đủ điều kiện, AirGuard tự gửi vào nhóm **Air Guard Demo** qua Internet.

**2. Mở web.** Dùng hồ sơ Edge đã đăng ký Push để mở [trang tổng quan AirGuard](http://127.0.0.1:5173/app/overview). Đăng nhập nếu được hỏi. Mở nhóm **Air Guard Demo** trong Telegram khi muốn xem tin.

**Chỉ khi PostgreSQL chưa bật.** Nếu API báo lỗi kết nối database ở cổng 5436, mở PowerShell bằng **Run as administrator** và chạy hai dòng sau.

```powershell
Start-Service -Name 'postgresql-x64-18'
& 'C:\Program Files\PostgreSQL\18\bin\pg_isready.exe' -h 127.0.0.1 -p 5436
```

Khi thấy **accepting connections**, quay lại cửa sổ AirGuard. Nếu API đã dừng do lỗi, nhấn **Ctrl+C** rồi chạy lại `npm.cmd run dev`.

**Cuối buổi**, nhấn **Ctrl+C** trong PowerShell để dừng AirGuard.

AirGuard MVP hiện có **Khu vực & phòng**, **Danh bạ hỗ trợ**, **Lịch sử gửi** và **Tiếp nhận cảnh báo**. Chạy các lệnh từ thư mục gốc có `package.json`, `package-lock.json` và `prisma.config.ts`.

## 1. Chuẩn bị môi trường

Cài Node.js từ 22.12.0 trở lên theo `package.json`, dùng bản Node 22 hoặc 24 LTS cùng npm. Chuẩn bị PostgreSQL local, quyền tạo database, và `psql` hoặc pgAdmin. Dùng trình duyệt có JavaScript và PowerShell cho các lệnh bên dưới.

```powershell
Get-Location
Test-Path .\package.json
node --version
npm --version
psql --version
npm ci
```

Với PostgreSQL local mới, có thể dùng pgAdmin hoặc chạy các câu dưới đây trong `psql` bằng một tài khoản PostgreSQL có quyền quản trị. Thay mật khẩu mẫu trước khi chạy.

```sql
CREATE ROLE airguard_local WITH LOGIN PASSWORD 'THAY_BANG_MAT_KHAU_LOCAL';
CREATE DATABASE airguard_local OWNER airguard_local;
CREATE DATABASE airguard_test OWNER airguard_local;
```

Nếu dự án đã có `.env`, giữ bản đang dùng và xác minh URL trỏ tới database local được phép thay đổi. Với bản cài mới, tạo `.env` ngay cạnh `package.json`, dùng nội dung mẫu sau rồi thay giá trị. Mã hóa percent các ký tự đặc biệt trong mật khẩu khi đưa vào URL.

```dotenv
DATABASE_URL=postgresql://airguard_local:THAY_MAT_KHAU@127.0.0.1:5432/airguard_local
WEB_ORIGIN=http://127.0.0.1:5173
HOST=127.0.0.1
PORT=4000
ADMIN_EMAIL=admin@example.test
ADMIN_PASSWORD=THAY_BANG_MAT_KHAU_IT_NHAT_12_KY_TU
TELEGRAM_ENABLED=false
WEB_PUSH_ENABLED=false
```

`DATABASE_URL` là bắt buộc. `WEB_ORIGIN`, `HOST`, `PORT` là cấu hình local tùy chọn. Giữ API ở cổng 4000 và frontend ở 5173 để dùng proxy Vite hiện có. Cần `ADMIN_EMAIL` và `ADMIN_PASSWORD` khi tạo admin lần đầu. Hai cờ thông báo mặc định tắt, nên demo không cần credential ngoài. Giữ `.env` và khóa thiết bị bên ngoài phần code chia sẻ.

## 2. Khởi tạo và đăng nhập

```powershell
npm run db:generate
npm run db:migrate
npm run admin:create
npm run dev
```

Sau khi tạo tài khoản thành công, có thể bỏ `ADMIN_PASSWORD` khỏi `.env` local. Nếu đã có admin, bỏ qua `admin:create`. Mở `http://127.0.0.1:5173` và đăng nhập. Để tạo tài khoản demo theo vai trò, admin mở **Tài khoản** tại `/app/users`, nhập email mẫu riêng, mật khẩu ít nhất 12 ký tự và chọn vai trò.

| Trang | Admin | Operator | Viewer |
| --- | --- | --- | --- |
| **Khu vực & phòng** — `/app/spaces` | Xem, thêm, sửa, lưu trữ, khôi phục, gán và bỏ gán | Xem | Xem |
| **Danh bạ hỗ trợ** — `/app/support-contacts` | Xem và quản lý toàn danh bạ | Không có quyền quản trị | Không có quyền quản trị |
| **Cảnh báo & sự cố** — `/app/alerts`, chi tiết `/app/alerts/<id>` | Xem thông tin hỗ trợ | Xem thông tin hỗ trợ | Xem thông tin hỗ trợ |
| **Lịch sử gửi** — `/app/notifications` | Web Push của mình và Telegram chung | Web Push của mình | Web Push của mình |
| **Thông báo môi trường & kết nối** — `/app/environment-settings` | Cấu hình Web Push của mình hoặc Telegram chung | Cấu hình Web Push của mình | Cấu hình Web Push của mình |
| **Tiếp nhận cảnh báo** — trong chi tiết sự cố | Xác nhận của mình nếu đủ điều kiện, xem danh sách tiếp nhận | Xác nhận của mình nếu đủ điều kiện, xem danh sách tiếp nhận | Xác nhận và xem phần của mình |

**Xác nhận nghiệp vụ** vẫn dành cho admin/operator. **Tôi đã nhận cảnh báo** là thao tác riêng của từng tài khoản đã được xếp gửi Push hoặc có cảnh báo Telegram chung.

## 3. Gán thiết bị và thêm liên hệ

1. Đăng nhập admin. Mở **Khu vực & phòng**, bấm **Thêm khu vực** và lưu `Khu demo`. Bấm **Thêm phòng**, chọn khu vực vừa tạo, nhập `Phòng demo A` và mô tả `Tầng 2, cạnh cầu thang`.
2. Trong **Thiết bị** tại `/app/devices`, tạo `Cảm biến demo` với nguồn **Simulator**. Mở chi tiết và lưu vị trí mô tả `Kệ thử nghiệm` để kiểm tra fallback. Sau đó quay về **Khu vực & phòng**.
3. Trong **Thiết bị chưa gán phòng**, bấm **Gán phòng**, chọn **Khu demo / Phòng demo A** rồi bấm **Lưu**. Để bỏ gán, tìm thiết bị trong **Thiết bị đã gán phòng**, bấm **Đổi phòng**, chọn **Chưa gán phòng** rồi **Lưu**. Vị trí mô tả trên chi tiết thiết bị vẫn là `Kệ thử nghiệm`.
4. Mở **Danh bạ hỗ trợ** và tạo các liên hệ hư cấu dưới đây. Chọn đúng phạm vi trong form.

| Tên liên hệ | Vai trò | Số mẫu | Phạm vi | Ưu tiên |
| --- | --- | --- | --- | --- |
| Trực phòng demo | Trực ca | `+1 (202) 555-0101` | Phòng demo A | 100 |
| Trực khu demo | Hỗ trợ khu vực | `+1 (202) 555-0102` | Khu demo | 1 |
| Hỗ trợ chung A | Trực chung | `+12025550101` | Chung | 1 |
| Hỗ trợ chung B | Trực chung | `+12025550103` | Chung | 2 |

Khi gán vào phòng, trang sự cố phải hiện theo thứ tự **Trực phòng demo**, **Trực khu demo**, **Hỗ trợ chung B**. Hỗ trợ chung A trùng số với liên hệ phòng nên được ẩn ở ngữ cảnh này. Bỏ gán phòng thì chỉ còn hai liên hệ chung.

Để chỉnh tên, mô tả và khu vực cha, bấm **Sửa** trên mục tương ứng. Dùng **Lưu trữ** cho phòng trước khi lưu trữ khu vực còn phòng đang hoạt động. Đổi bộ lọc **Trạng thái** sang **Đã lưu trữ** để tìm nút **Khôi phục**. Khôi phục khu vực trước phòng. Phòng lưu trữ vẫn giữ liên kết thiết bị đã có, và thiết bị có thể được bỏ gán hoặc chuyển tới phòng hoạt động. Để khôi phục liên hệ trong danh bạ, bật **Hiện liên hệ đã lưu trữ**.

## 4. Demo sự cố trong 5–10 phút

Bắt đầu sau khi hoàn thành cài đặt và có dữ liệu mẫu ở mục 3. Giữ hai kênh thông báo tắt trong demo. Trong **Thiết bị**, lấy ID của `Cảm biến demo` và bấm **Cấp key**. Sao chép key từ hộp thoại cấp khóa. Trong một PowerShell mới ở thư mục gốc, đặt các biến cho riêng terminal đó rồi chạy simulator.

```powershell
$env:SIM_DEVICE_ID = 'THAY_BANG_UUID_THIET_BI_DEMO'
$env:SIM_DEVICE_KEY = 'THAY_BANG_KEY_VUA_CAP'
$env:SIM_API_URL = 'http://127.0.0.1:4000'
npm run simulate -- --scenario danger
```

| Bước | Kết quả cần quan sát |
| --- | --- |
| Đợi terminal simulator báo mẫu 3–6 có trạng thái active. Mở **Cảnh báo & sự cố**, lọc theo thiết bị và vào một sự cố vừa tạo. | Trang hiển thị nhãn **Dữ liệu mô phỏng** và phần **Liên hệ hỗ trợ**. Simulator sẽ báo phục hồi ở mẫu 7–10. |
| Quan sát vị trí và danh bạ. | Vị trí hiện tại là `Khu demo / Phòng demo A`, có mô tả tầng. Ba liên hệ đúng thứ tự và số trùng chỉ hiện một lần. |
| Bấm **Sao chép số**, sau đó dán vào trình soạn thảo. | Nhận `+12025550101`. Nếu trình duyệt chặn clipboard, ô số được chọn sẵn để sao chép thủ công. |
| Quay về **Khu vực & phòng**, bỏ gán thiết bị và mở lại cùng sự cố. | Sau khi tải lại, vị trí là `Kệ thử nghiệm`, danh bạ chỉ còn hai liên hệ chung. |
| Lưu trữ liên hệ chung A rồi mở lại sự cố. Sau đó thử bằng tài khoản viewer hoặc operator. | Danh bạ sự cố bỏ qua mục lưu trữ. Hai vai trò này xem được không gian và liên hệ trên sự cố, không thấy nút ghi dữ liệu hoặc menu quản trị danh bạ. |

Không dùng kịch bản này cho thiết bị phần cứng. Dừng simulator bằng Ctrl+C và xóa các biến khóa khỏi terminal nếu tiếp tục dùng cửa sổ đó.

```powershell
Remove-Item Env:SIM_DEVICE_ID,Env:SIM_DEVICE_KEY,Env:SIM_API_URL
```

## 5. Cấu hình Telegram và Web Push

Các demo danh bạ và sơ đồ chạy được khi hai kênh tắt. Mục 7 và Mục 8 có chế độ dùng transport giả. Mục 10 hướng dẫn chạy API chính với hai kênh thật.

Trên môi trường riêng được phép gửi, tạo bot Telegram, thêm bot vào đích thử nghiệm có quyền gửi và cung cấp `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` từ cấu hình backend. Bật `TELEGRAM_ENABLED=true` rồi khởi động lại API. Dùng `WEB_ORIGIN` là origin HTTPS public của frontend, ví dụ `https://airguard.example.test` thay bằng origin thực tế, để tin có link tới đúng sự cố. Đích Telegram áp dụng chung cho workspace. `TELEGRAM_INCLUDE_SIMULATORS` mặc định tắt. Chỉ bật mô phỏng nếu đích thử nghiệm đã được phép nhận.

Web Push hiện có dùng `npm run webpush:keys` để tạo cặp VAPID. Đặt cặp tương ứng vào `WEB_PUSH_VAPID_PUBLIC_KEY` và `WEB_PUSH_VAPID_PRIVATE_KEY`, đặt `WEB_PUSH_VAPID_SUBJECT` dạng `mailto:` hoặc URL HTTPS, rồi bật `WEB_PUSH_ENABLED=true` và khởi động lại API. Trình duyệt cần HTTPS hoặc môi trường localhost hỗ trợ service worker. Người dùng cấp quyền và tùy chọn nhận mô phỏng tại **Cài đặt**. Đăng xuất hoặc hết phiên có thể ngừng nhận vì subscription gắn với phiên.

Trong **Cài đặt → Thông báo Web Push**, **Hiển thị chi tiết thông báo** mặc định tắt. Bật để các trình duyệt đã đăng ký của tài khoản nhận thêm tên, loại cảnh báo, thời gian và vị trí nếu có. Tắt để lần gửi tiếp theo trở lại nội dung chung. Tên và vị trí có thể xuất hiện trên màn hình khóa. Tin đã gửi có thể đến muộn sau đăng xuất. Tùy chọn chi tiết và lịch sử cá nhân vẫn còn khi đăng nhập lại, trình duyệt cần đăng ký Push lại theo phiên mới.

Tắt gửi tại backend bằng cờ tương ứng rồi khởi động lại API. Màn hình lịch sử vẫn đọc dữ liệu đã lưu. Mục 8 của hướng dẫn này mô tả lịch bản tin, biến động, giờ yên lặng và trạng thái mất/kết nối lại. Xác nhận tiếp nhận sự cố thực hiện trên web.

## 6. Kiểm thử lại và xử lý lỗi

Chỉ dùng database test riêng cho các test có ghi dữ liệu. Ví dụ PowerShell dưới đây đặt URL cho lệnh migrate trong một terminal riêng, rồi dùng nó làm URL test. `cloud:api:migrate` chạy Prisma với biến môi trường của terminal. Không dùng URL của database nhóm hoặc production.

```powershell
$env:DATABASE_URL = 'postgresql://airguard_local:THAY_MAT_KHAU@127.0.0.1:5432/airguard_test'
$env:TEST_DATABASE_URL = $env:DATABASE_URL
npm run db:generate
npm run cloud:api:migrate
npm run typecheck
npm run lint
npm run build
npm test -- apps/api/tests/monitoring-spaces-support.test.ts apps/web/src/features/incident-response/IncidentSupport.test.tsx
```

Chạy `npm test` để kiểm tra rộng hơn, theo các biến môi trường mà từng suite cần. Nếu không đặt `TEST_DATABASE_URL`, test mới phía API sẽ được bỏ qua. Script integration/e2e cấp gốc cần runner ở `tests/`; bản thư mục đang triển khai không có runner đó.

| Triệu chứng | Cách kiểm tra |
| --- | --- |
| Lệnh npm không nhận hoặc build thiếu module | Kiểm tra phiên bản Node/npm và đang ở gần `package.json` nào. Chạy `npm ci` từ gốc. |
| API khu vực/danh bạ báo lỗi sau cập nhật | Chạy lại generate Prisma và kiểm tra migration đã áp dụng vào đúng database mà API dùng. Khởi động lại API. |
| Không thấy thiết bị hoặc sự cố demo | Kiểm tra ID/key, cổng 4000, trạng thái thiết bị và thông báo nhận mẫu ở terminal. Xóa bộ lọc danh sách nếu cần. |
| Phiên hết hạn hoặc bị từ chối ghi | Đăng nhập lại. Dùng admin để quản lý dữ liệu. |
| Không lưu được tên hoặc phòng | Kiểm tra tên trùng, kể cả bản lưu trữ, và trạng thái khu vực/phòng. |
| Danh bạ rỗng | Kiểm tra phạm vi, trạng thái liên hệ, trạng thái không gian và phòng hiện gán. Thiết bị chưa gán phòng chỉ thấy danh bạ chung. |
| Danh bạ báo lỗi | Bấm **Thử lại**. Vị trí và nút **Sao chép số** hiển thị lại khi tải danh bạ thành công. |
| Clipboard không khả dụng | Chọn số trong ô và sao chép thủ công. |
| Push bị chặn hoặc VAPID không khớp | Với chức năng nền, kiểm tra cờ bật, quyền trình duyệt, origin và cặp VAPID. Kiểm tra lại trạng thái đăng ký sau đăng nhập. |
| Telegram thiếu đích/quyền | Kiểm tra cờ bật, bot token, chat ID và quyền gửi. Lịch sử tin môi trường ghi lý do nếu kênh chưa sẵn sàng. |
| Không có lượt gửi hoặc nút tiếp nhận | Kiểm tra bộ lọc, kênh đã bật tại thời điểm tạo sự cố và quyền xem. Thử bằng sự cố mô phỏng mới với kênh demo, hoặc kiểm tra phiên/đăng ký Push và tùy chọn nhận mô phỏng. |
| Job chờ lâu | Kiểm tra backend/worker, trạng thái kênh và thời điểm thử tiếp trong lịch sử. Khi dùng demo, kiểm tra terminal A. |

Dừng API/frontend bằng Ctrl+C ở terminal chạy `npm run dev`. Khi ghép vào nhánh nhóm, lấy riêng các file mới và các điểm tích hợp ghi trong [báo cáo thay đổi](BAO_CAO_THAY_DOI_MVP.md), rồi thử migration trên database test trước.

## 7. Demo sự cố mô phỏng → lịch sử gửi → xác nhận tiếp nhận

Dự kiến 5–10 phút sau khi cài dependencies. Dùng database local riêng có hậu tố `_demo`. Tạo database `airguard_alert_demo` với owner local theo Mục 1. Dừng API và Vite đang chạy ở 4000/5173 trước khi bắt đầu.

Ở terminal A, tạo Prisma client, áp dụng migration và tạo admin mới cho database demo. Nếu đã có admin ở database này, bỏ qua lệnh tạo admin.

```powershell
$env:TEST_ALERT_DELIVERY_DATABASE_URL = 'postgresql://airguard_local:THAY_MAT_KHAU@127.0.0.1:5432/airguard_alert_demo'
$env:DATABASE_URL = $env:TEST_ALERT_DELIVERY_DATABASE_URL
$env:ADMIN_EMAIL = 'admin@example.test'
$env:ADMIN_PASSWORD = 'THAY_BANG_MAT_KHAU_IT_NHAT_12_KY_TU'
npm run db:generate
npm run cloud:api:migrate
npm run cloud:admin:create
Remove-Item Env:ADMIN_PASSWORD
.\node_modules\.bin\tsx.cmd tools/operations/mock-alert-delivery.ts
```

Terminal A phải báo API demo loopback ở cổng 4000 và **transport Telegram giả**. Transport trả kết quả chấp nhận giả cho worker hiện có, không dùng bot/token và không gọi dịch vụ bên ngoài. Để server demo chạy và mở terminal B.

```powershell
npm run dev -w @iot/web
```

1. Mở `http://127.0.0.1:5173`, đăng nhập admin demo và tạo thiết bị nguồn **Simulator**. Gán phòng theo Mục 3, hoặc đặt vị trí mô tả `Kệ demo` để thử fallback. Cấp key và sao chép ID/key thiết bị.
2. Ở terminal C, đặt biến bên dưới. Khi simulator báo mẫu active, dừng ngay bằng Ctrl+C trước loạt mẫu phục hồi. Làm vậy để so trạng thái cùng một sự cố trước và sau thao tác tiếp nhận.

```powershell
$env:SIM_DEVICE_ID = 'THAY_BANG_UUID_SIMULATOR'
$env:SIM_DEVICE_KEY = 'THAY_BANG_KEY_LOCAL'
$env:SIM_API_URL = 'http://127.0.0.1:4000'
npm run cloud:simulator -- --scenario danger
```

3. Vào **Lịch sử gửi**, chọn **Telegram**, thiết bị vừa tạo và **Dịch vụ đã chấp nhận**. Job mô phỏng có một lần thử. Trong demo, “Dịch vụ” là transport giả. Bấm tên cảnh báo để mở sự cố. Ghi lại trạng thái hiển thị và thời gian bắt đầu.
4. Bấm **Tôi đã nhận cảnh báo** rồi tải lại. Thời gian tiếp nhận vẫn giữ nguyên. Trạng thái sự cố, xác nhận nghiệp vụ và timeline giữ như trước thao tác. Quay lại lịch sử và quan sát **Bạn đã xác nhận tiếp nhận** bên cạnh kết quả gửi. Tiếp nhận sau khi sự cố đã kết thúc sẽ có nhãn **Tiếp nhận muộn**.
5. Đổi tên phòng rồi tải lại lịch sử và trang sự cố. Trang sự cố hiện vị trí hỗ trợ hiện tại. Lịch sử giữ tên khu vực/phòng từ lúc tạo lượt gửi.
6. Đăng xuất và đăng nhập lại cùng tài khoản. Lịch sử và thời điểm tiếp nhận vẫn còn. Với tài khoản operator/viewer, mở sự cố qua **Cảnh báo & sự cố** để xem điều kiện tiếp nhận Telegram chung. Nhật ký Telegram chung chỉ admin xem.

Trạng thái gửi **Lỗi, chờ thử lại** kèm giờ thử tiếp xuất hiện khi provider báo lỗi tạm thời. Mở **lần thử gửi** để xem thời điểm, kết quả và mã lỗi. **Hết hạn** và **Đã bỏ qua** là các trạng thái riêng. Bản ghi cũ có thể thiếu chi tiết từng lần thử hoặc vị trí lúc gửi. **Dịch vụ đã chấp nhận** và **Bạn đã xác nhận tiếp nhận** là hai kết quả độc lập.

Dừng terminal A và B bằng Ctrl+C, xóa biến simulator ở terminal C như Mục 4. Để chạy bộ kiểm tra API Mục 7, dùng database test riêng mới, ví dụ `airguard_alert_test`, với migration đã áp dụng.

```powershell
$env:TEST_ALERT_DELIVERY_DATABASE_URL = 'postgresql://airguard_local:THAY_MAT_KHAU@127.0.0.1:5432/airguard_alert_test'
$env:DATABASE_URL = $env:TEST_ALERT_DELIVERY_DATABASE_URL
npm run db:generate
npm run cloud:api:migrate
npm test -- apps/api/tests/alert-delivery-history.test.ts apps/web/src/features/incident-response/IncidentSupport.test.tsx apps/web/src/lib/push-service-worker.test.ts
```

Suite API dùng callback Push/Telegram giả và có thể chạy khi hai kênh ngoài tắt. Nếu thiếu `TEST_ALERT_DELIVERY_DATABASE_URL`, suite PostgreSQL được bỏ qua. Để chạy lại trên database đã có các job thử chờ gửi, ưu tiên tạo database test trống khác để worker không tiêu thụ job của lần trước.

## 8. Cài đặt và demo Mục 6

Chạy `npm run db:generate` và `npm run db:migrate` trên database local từ Mục 1. API thường khởi động scheduler cùng `npm run dev`. Scheduler ở backend, nên đóng tab vẫn tính lịch và gửi vào các đích còn hiệu lực.

1. Vào **Cài đặt → Thông báo môi trường & kết nối**. Chọn **Web Push cá nhân** hoặc, với admin, **Telegram chung**. Telegram dùng đích server đã cấu hình tại Mục 5. Với Web Push, đăng ký trình duyệt trong **Cài đặt** trước. Bật **Nhận cả dữ liệu mô phỏng** ở chính sách và tại kênh/đăng ký nếu dùng simulator.
2. Chọn tối đa 20 thiết bị, bật thông báo và chọn các loại tin. Đối với bản tin, chọn chu kỳ và cửa sổ lấy mẫu. Ví dụ 5 phút/lần, tổng hợp 5 phút vừa qua. Sau khi lưu, màn hình hiện mốc tiếp theo theo múi giờ đã chọn. Mốc đầu tiên là một chu kỳ sau lúc bắt đầu theo dõi thiết bị. Mốc tiếp theo có thể bị hoãn hoặc bỏ qua khi thiếu đích hoặc đã hết hạn.
3. Với biến động, đặt ngưỡng nhiệt độ °C, độ ẩm theo **điểm %RH**, thời gian duy trì N phút và cooldown. Worker so N phút đã chốt gần nhất với N phút liền trước. Cửa sổ chốt sau ít nhất 2 phút, hoặc sau 3 chu kỳ gửi nếu lâu hơn, để đợi mẫu hợp lệ đến trễ. Cả hai cửa sổ cần đủ các phút có mẫu hợp lệ. Tất cả N phút gần nhất phải vượt ngưỡng cùng chiều. Ví dụ 50%RH xuống 42%RH là giảm 8 điểm %RH. Ngưỡng này dùng để theo dõi biến động.
4. Với kết nối, đặt khoảng chờ trước khi báo mất và khoảng nghỉ giữa hai lần báo mất. Một lần mất ngắn hồi phục trước khi gửi sẽ bị gộp. Chỉ các lượt mất đã được dịch vụ chấp nhận mới có lượt phục hồi tương ứng. Nếu sự kiện kết nối đã đổi lần nữa trước khi gửi, tin phục hồi cũ được bỏ qua và lịch sử ghi **Đã có tin mới hơn**. Thiết bị đã offline trước khi bật không phát lại lịch sử cũ.
5. Bật giờ yên lặng và chọn múi giờ, ví dụ **22:00–07:00** tại `Asia/Ho_Chi_Minh`. Tin thường được hoãn và gộp theo giá trị còn hiệu lực. Nếu bật **Áp dụng cho cả cảnh báo sự cố**, có thể chọn **critical bỏ qua giờ yên lặng**. Tùy chọn này chỉ áp dụng trên AirGuard. Hệ điều hành vẫn có thể hoãn hoặc chặn thông báo.

Mở **Lịch sử gửi → Tin môi trường & kết nối** tại `/app/notifications?view=environment`. Lọc theo loại, kênh, thiết bị, trạng thái hoặc khoảng thời gian. Bản tin thiếu mẫu hiện lý do và số mẫu hợp lệ. Trạng thái hoãn có giờ kiểm tra tiếp. Một lượt **Dịch vụ đã chấp nhận** chỉ xác nhận kết quả của transport. Tin môi trường có mã riêng và không có nút tiếp nhận sự cố.

### Demo trình duyệt khoảng 5–10 phút

Dùng database loopback có hậu tố `_demo` và làm các bước chuẩn bị terminal A/B của Mục 7. Thay lệnh khởi động API ở terminal A bằng:

```powershell
.\node_modules\.bin\tsx.cmd tools/operations/mock-alert-delivery.ts --environment
```

Chế độ này bật scheduler và kiểm tra offline trên database demo. Telegram trả chấp nhận giả, không cần bot hoặc gửi ra ngoài. Trang chạy qua API demo dùng REST.

| Bước | Quan sát |
| --- | --- |
| Tạo thiết bị simulator, chọn **Telegram chung** và bật simulator. Chọn chu kỳ/cửa sổ 5 phút, bật thông báo kết nối với thời gian chờ/khoảng nghỉ 1 phút. Để giờ yên lặng tắt lúc đầu. | Cài đặt báo đã lưu, mốc bản tin kế tiếp xuất hiện. |
| Chạy simulator ở terminal C như Mục 7, đổi tham số thành `--scenario normal`. Đợi qua mốc bản tin và mở tab lịch sử môi trường. | Bản tin có mã riêng, số mẫu, min/max/TB hoặc trạng thái thiếu dữ liệu hợp lệ nếu simulator mới chạy. Không có sự cố được tạo từ bản tin. |
| Dừng simulator sau khi đã thấy mẫu. Sau ngưỡng offline hiện có (ít nhất 30 giây) và khoảng chờ 1 phút, kiểm tra lịch sử. Khởi động lại cùng thiết bị. | Có một lượt **Mất kết nối** và sau đó có một lượt **Kết nối lại**. Khởi động lại API demo trên cùng DB không tạo lại những lượt đã chấp nhận. |
| Đặt giờ yên lặng chứa giờ hiện tại. Để chạy demo qua nửa đêm mà không đổi đồng hồ hệ thống, dùng bài kiểm tra dưới đây. | Nếu có lượt tới hạn trong khoảng yên lặng, lịch sử hiện trạng thái hoãn hoặc hết hạn. Mục **Lịch sử sự cố** vẫn hoạt động theo chính sách của kênh. |

### Demo đồng hồ giả và kiểm thử

Bộ kiểm tra không cần token. Phần không dùng database mô phỏng 22:59, 23:00, nửa đêm và 06:00 theo múi giờ Việt Nam, kiểm tra cửa sổ 3+3 phút của biến động và restart khi job đã được chấp nhận. Phần PostgreSQL nạp dữ liệu mô phỏng có kiểm soát, gọi scheduler đồng thời, giả lập một lần mất kết nối trong quiet hours và một cặp mất/phục hồi sau khi hết quiet hours. Suite cần database test trống riêng `airguard_environment_test`.

```powershell
$env:TEST_ENVIRONMENT_DATABASE_URL = 'postgresql://airguard_local:THAY_MAT_KHAU@127.0.0.1:5432/airguard_environment_test'
$env:DATABASE_URL = $env:TEST_ENVIRONMENT_DATABASE_URL
npm run db:generate
npm run cloud:api:migrate
npm test -- apps/api/tests/environment-notifications.test.ts apps/api/tests/delivery-send-guard.test.ts apps/web/src/lib/push-service-worker.test.ts
```

Nếu bỏ biến test database, chỉ suite PostgreSQL bị bỏ qua. Chạy thêm suite lịch sử Mục 7 với database riêng như Mục 7 của hướng dẫn này. Sau demo, Ctrl+C ở từng terminal. Để tắt riêng tin môi trường, tắt cấu hình theo kênh, và tắt tùy chọn quiet hours cho sự cố nếu đã bật. Khi ghép code hoặc rollback, xem mục Mục 6 của [báo cáo thay đổi](BAO_CAO_THAY_DOI_MVP.md).

## 9. Demo sơ đồ khu vực và phòng

Chạy `npm run db:generate` và `npm run db:migrate` trên database demo riêng rồi khởi động web/API như Mục 2. Nếu PostgreSQL local lắng nghe ở **5436**, đặt đúng cổng này trong `DATABASE_URL`. Dùng mật khẩu local trong biến môi trường, tránh lưu vào source code.

1. Đăng nhập admin. Trong **Khu vực & phòng** (`/app/spaces`), tạo một khu vực và hai phòng, ví dụ **Phòng vận hành** và **Phòng kỹ thuật**. Chọn khu vực ở ô **Khu vực trên sơ đồ** để thấy khung và số thiết bị của từng phòng.
2. Qua **Thiết bị** (`/app/devices`), đăng ký ba thiết bị nguồn **Simulator**. Chúng xuất hiện trong **Thiết bị chưa gán phòng**. Gán hai thiết bị vào **Phòng vận hành** bằng **Gán phòng → chọn phòng → Lưu**. Giữ thiết bị thứ ba ở danh sách chưa gán.
3. Trong khung **Phòng vận hành**, bấm thiết bị có nhãn **Chưa đặt vị trí**, chọn **Đặt lên sơ đồ**, bấm một vị trí trong khung và chọn **Lưu vị trí**. Làm tương tự với điểm thứ hai ở vị trí khác. Tải lại hoặc thu nhỏ màn hình. Điểm giữ nguyên tọa độ tương đối trong phòng.
4. Cấp key cho hai thiết bị đã đặt và chạy hai simulator ở hai terminal. Đặt `SIM_DEVICE_ID`, `SIM_DEVICE_KEY` và `SIM_API_URL` của từng terminal như Mục 7. Dùng `npm run cloud:simulator -- --scenario normal` cho thiết bị thứ nhất và `npm run cloud:simulator -- --scenario danger` cho thiết bị thứ hai. Mở sơ đồ và quan sát khi simulator danger qua mẫu 3–6. Cùng một phòng có thể có một điểm xanh và một điểm đỏ.
5. Mở **Ngưỡng hiển thị sơ đồ**. Mặc định điểm vàng khi nhiệt độ từ **30 °C** hoặc độ ẩm từ **75 %RH**. Để thấy vàng với simulator normal, thử hạ ngưỡng nhiệt độ của khu vực xuống **26 °C** rồi **Lưu ngưỡng**. Đây là ngưỡng hiển thị riêng của sơ đồ. MQ-2/MQ-7 trong phần chi tiết vẫn dùng ADC thô. Dữ liệu DHT phải hợp lệ và còn mới để hiển thị xanh hoặc vàng.
6. Bấm một điểm để xem số đo, thời điểm đo/nhận, trạng thái kết nối, lý do màu và liên kết chi tiết. Dừng simulator normal để xem điểm chuyển xám khi mẫu cũ hoặc mất kết nối. Nếu dừng simulator danger lúc sự cố đang mở, điểm vẫn đỏ và khi mất kết nối sẽ có nhãn riêng **Mất kết nối**.
7. Vào **Thiết bị đã gán phòng**, bấm **Đổi phòng**. So sánh **Phòng hiện tại** và **Phòng mới**, rồi thử **Hủy**. Bấm **Lưu** khi chuyển thật. Thiết bị sang phòng mới với nhãn **Chưa đặt vị trí**. Chọn **Chưa gán phòng** rồi **Lưu** để xóa gán. Phòng lưu trữ vẫn hiện trên sơ đồ với nhãn trạng thái và giữ điểm đã lưu. Muốn gán mới hoặc đổi vị trí trong phòng đó, admin cần khôi phục trước.

Operator và viewer có thể chọn khu vực và mở chi tiết, còn thao tác gán, đặt điểm và lưu ngưỡng dành cho admin. Kết nối realtime gọi lại dữ liệu theo sự kiện. Nếu Socket.IO gián đoạn, sơ đồ vẫn tải lại qua REST mỗi 5 giây khi tab mở.

### Phiên demo đã mở trên máy này

Web demo dùng [http://127.0.0.1:5273/app/spaces](http://127.0.0.1:5273/app/spaces) và API cổng **4400** trên database riêng `airguard_room_map_demo_20261119`. Đây là cổng riêng vì ứng dụng khác đã dùng 5173 và 4000. Hãy đăng nhập tài khoản demo được cung cấp trong cuộc trò chuyện. Khu **Khu giám sát A** đã có hai phòng. **AQ-01** xanh, **AQ-03** vàng và có mẫu mô phỏng đang gửi. **AQ-02** đỏ từ sự cố đang mở dù đã mất kết nối. **AQ-04** chưa gán phòng và **AQ-05** đã gán nhưng chưa đặt vị trí.

## 10. Phát kịch bản JSON hoặc CSV với API chính

### Chạy API và chuẩn bị thiết bị

Dùng database demo riêng. Tạo `.env` từ Mục 1, thay cổng PostgreSQL nếu đang dùng 5436. Với Vite local, đặt `WEB_ORIGIN=http://127.0.0.1:5173`, `HOST=127.0.0.1` và `PORT=4000`. Chạy từ thư mục có `package.json`. Bỏ qua lệnh tạo admin nếu đã có tài khoản.

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run admin:create
npm.cmd run dev
```

`npm.cmd run dev` chạy Vite và API chính, gồm scheduler, worker thông báo và Socket.IO. Khi API chạy trên máy chủ đã cấp biến môi trường, dùng `npm.cmd run cloud:api:migrate` và `npm.cmd run cloud:api:start` ở backend. Dùng origin HTTPS thực tế của frontend trong `WEB_ORIGIN` để URL Telegram trỏ tới đúng web và để giữ cấu hình Origin/cookie. Frontend cần chuyển tiếp `/api` và `/socket.io` tới backend theo cấu hình triển khai đang dùng.

Trong **Thiết bị**, tạo một thiết bị nguồn **Simulator** cho mỗi kịch bản, giữ cấu hình gửi **5 giây** và cấp DeviceKey. Gán phòng nếu muốn thử vị trí trong lịch sử và danh bạ. Trong terminal simulator, đặt ID và key tương ứng trước mỗi lần chạy:

```powershell
$env:SIM_API_URL = 'http://127.0.0.1:4000'
$env:SIM_DEVICE_ID = Read-Host 'UUID thiết bị Simulator'
$key = Read-Host 'DeviceKey' -AsSecureString
$env:SIM_DEVICE_KEY = [System.Net.NetworkCredential]::new('', $key).Password
Remove-Variable key
```

Dùng URL HTTPS của API nếu chạy từ máy khác. Giữ DeviceKey trên máy chạy simulator. Simulator kiểm tra toàn bộ file trước khi gửi, gắn `sampled_at` tại thời điểm tạo mẫu, rồi gửi lần lượt qua `POST /api/v1/device/telemetry`. Retry dùng cùng mẫu và cùng boot/seq, có thể làm lịch chạy lâu hơn. Simulator chờ đủ thời lượng pha `pause` sau khi lượt gửi trước đó hoàn tất nếu lần gửi kéo dài. Hai chế độ vòng lặp `--scenario normal` và `--scenario danger` vẫn dùng được.

### Bật Telegram và Web Push thật

Áp dụng các biến bên dưới ở backend thử nghiệm và khởi động lại API. Cấp quyền gửi cho bot trong nhóm thử. Chạy `npm.cmd run webpush:keys` một lần để tạo cặp VAPID, giữ nguyên cặp này khi khởi động lại.

```dotenv
TELEGRAM_ENABLED=true
TELEGRAM_INCLUDE_SIMULATORS=true
TELEGRAM_BOT_TOKEN=THAY_BANG_BOT_TOKEN
TELEGRAM_CHAT_ID=THAY_BANG_ID_NHOM_DANG_SO
WEB_PUSH_ENABLED=true
WEB_PUSH_VAPID_SUBJECT=mailto:THAY_BANG_EMAIL_LIEN_HE
WEB_PUSH_VAPID_PUBLIC_KEY=THAY_BANG_VAPID_PUBLIC_KEY
WEB_PUSH_VAPID_PRIVATE_KEY=THAY_BANG_VAPID_PRIVATE_KEY
```

Giữ bot token và khóa VAPID riêng tư ở backend. Mở **Cài đặt → Thông báo Web Push** trên từng trình duyệt cần nhận. Đăng nhập, chọn **Nhận cả cảnh báo mô phỏng**, bấm **Bật Web Push** và cấp quyền. Mỗi trình duyệt hoặc hồ sơ trình duyệt cần đăng ký riêng. Đăng xuất, phiên hết hạn hoặc phiên bị thu hồi thì đăng nhập và bật lại. **Hiển thị chi tiết thông báo** mặc định tắt. Chỉ bật khi chấp nhận hiển thị chi tiết trên màn hình khóa.

Trên iPhone chạy iOS 16.4 trở lên, mở AirGuard qua HTTPS trong Safari. Chọn **Chia sẻ → Thêm vào MH chính** và bật **Mở dưới dạng ứng dụng web** nếu iOS có tùy chọn này. Mở AirGuard từ biểu tượng vừa thêm, đăng nhập và thực hiện các bước bật Push ngay trong ứng dụng. Kiểm tra quyền AirGuard trong cài đặt thông báo của iOS nếu chưa thấy tin. Địa chỉ loopback của máy chạy API chỉ dùng trên máy đó. [Apple Support](https://support.apple.com/en-az/guide/iphone/iphea86e5236/26/ios/26), [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

### Chạy từng kịch bản

Trong **Cài đặt → Thông báo môi trường & kết nối**, bật riêng kênh cần thử, chọn đúng thiết bị, bật nhận dữ liệu mô phỏng và để giờ yên lặng tắt trong lúc demo. Với **Telegram chung**, thao tác bằng admin. Với **Web Push cá nhân**, bật đăng ký ở trình duyệt trước. Hai kịch bản môi trường và kết nối cần chính sách này. Cảnh báo lửa dùng luồng sự cố hiện có, nên chỉ cần kênh cảnh báo đã bật.

| Kịch bản | Cấu hình và thời lượng tối thiểu của file | Kết quả mong đợi |
| --- | --- | --- |
| `environment.json` | **13 phút**, 156 mẫu. Bản tin 5 phút/lần với cửa sổ 5 phút. Biến động đặt ngưỡng **4 °C** hoặc **8 điểm %RH**, duy trì **3 phút**, khoảng nghỉ **10 phút**. Bắt đầu simulator ngay sau khi lưu. | 6 phút đầu ổn định **26 °C / 52 %RH**, đủ kỳ bản tin đầu. 7 phút sau **36 °C / 68 %RH**. Mẫu hợp lệ mỗi 5 giây phủ từng phút của hai cửa sổ 3 phút. Với cấu hình gửi 5 giây, scheduler chờ 2 phút chốt cửa sổ rồi quét tối đa sau khoảng 15 giây. Mở **Lịch sử gửi → Tin môi trường & kết nối** để thấy bản tin ổn định và tin biến động. Có thể có thêm bản tin định kỳ. |
| `connectivity.json` | **3 phút 45 giây**, 15 mẫu. Bật kết nối, đặt thời gian chờ **1 phút** và khoảng nghỉ **1 phút**. Gửi 30 giây, ngừng 150 giây, gửi lại 45 giây. | Sau ngưỡng offline ít nhất 30 giây từ lần gửi cuối và khoảng chờ 1 phút, lịch sử có **Mất kết nối**. Sau khi gửi tiếp bằng cùng ID, thấy **Kết nối lại** nếu lượt mất đã được dịch vụ chấp nhận. Nếu kênh đang retry, tăng pha `pause` để lượt mất kịp gửi. Khi file kết thúc, thiết bị sẽ lại mất kết nối nếu không có nguồn tiếp tục gửi. |
| `incident.json` | **1 phút 35 giây**, 19 mẫu. Mở tab AirGuard đã đăng nhập trước khi chạy. 15 giây đầu bình thường, 60 giây có lửa mô phỏng, 20 giây phục hồi. | Một sự cố **flame / critical**, một banner trong tab có tên thiết bị và link chi tiết, cùng lượt gửi ở **Lịch sử gửi → Cảnh báo sự cố** cho mỗi đích đủ điều kiện. Mở từ Telegram, Web Push hoặc banner. Trong pha có lửa, bấm **Tôi đã nhận cảnh báo**, kiểm tra vẫn **Chưa kết thúc**, rồi quan sát trạng thái kết thúc sau mẫu phục hồi. Tải lại tab không bật lại banner cũ. Trang sự cố giữ danh bạ theo phòng và **Sao chép số**. |

```powershell
# Mỗi lần chọn một lệnh và đặt đúng ID/key của thiết bị demo
npm.cmd run cloud:simulator -- --scenario-file tools/device-simulator/scenarios/environment.json
npm.cmd run cloud:simulator -- --scenario-file tools/device-simulator/scenarios/connectivity.json
npm.cmd run cloud:simulator -- --scenario-file tools/device-simulator/scenarios/incident.json
```

`alert_snapshot.flame` của kịch bản sự cố là trạng thái được chỉ định trong file. MQ-2 và MQ-7 vẫn báo ADC thô, với `concentration_ppm: null`. Các giá trị này không dùng để suy ra nồng độ ppm hoặc ngưỡng an toàn. Lọc lịch sử theo thiết bị và kênh, rồi kiểm tra nhãn **Mô phỏng** trên lượt gửi. **Dịch vụ đã chấp nhận** là kết quả từ dịch vụ gửi. Kiểm tra đã nhận bằng cách xem tin trong nhóm Telegram hoặc thông báo trên thiết bị. **Tôi đã nhận cảnh báo** ghi thời điểm tiếp nhận riêng cho tài khoản.

### Dùng file tự ghi

JSON phiên bản `1` gồm danh sách `phases` theo thứ tự. Pha `send` cần `duration_s`, `interval_s`, `temperature_c`, `humidity_pct` và hỗ trợ `flame: "normal"` hoặc `"active"`. Pha `pause` chỉ cần `duration_s`. Nhiệt độ hợp lệ từ −40 đến 125 °C, độ ẩm từ 0 đến 100 %RH. Giới hạn 24 giờ và 10.000 mẫu mỗi file.

CSV dùng đúng dòng tiêu đề dưới đây, ba cột số thập phân với dấu chấm, offset tính bằng giây kể từ lúc bắt đầu và tăng nghiêm ngặt. Offset có thể bắt đầu ở 0 và dùng tối đa 3 chữ số phần lẻ. CSV phát nhiệt độ/độ ẩm, với trạng thái lửa bình thường.

```csv
offset_s,temperature_c,humidity_pct
0,26,52
5,26.2,52
10,26.4,53
```

```powershell
npm.cmd run cloud:simulator -- --scenario-file tools/device-simulator/scenarios/incident.json --validate-only
npm.cmd run cloud:simulator -- --csv tools/device-simulator/scenarios/example.csv --validate-only
npm.cmd run cloud:simulator -- --csv tools/device-simulator/scenarios/example.csv
Remove-Item Env:SIM_DEVICE_ID,Env:SIM_DEVICE_KEY,Env:SIM_API_URL
```

## 11. Demo bốn thiết bị và luồng xử lý sự cố

Khởi động API chính và web như Mục 10. Dùng tài khoản admin, database demo riêng và PowerShell ở thư mục có `package.json`. Chuẩn bị bộ demo một lần:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -Provision
```

Lệnh hỏi email và mật khẩu admin. Nó tạo khu **Demo - AirGuard**, hai phòng và bốn thiết bị nguồn Simulator **chưa gán phòng**. Mỗi thiết bị có ID và DeviceKey riêng. Lệnh lưu dữ liệu đăng nhập của các thiết bị vào `%TEMP%\airguard-multi-device.env`. Chạy lại với cùng file sẽ dùng các ID/key đã ghi. `-ExecutionPolicy Bypass` chỉ áp dụng cho PowerShell chạy script này. Nếu thử trên API/web có cổng riêng, truyền `-WebOrigin`, `-ApiUrl` và một `-EnvFile` riêng khi chuẩn bị bộ demo.

Trong **Khu vực & phòng**, chọn khu **Demo - AirGuard**, gán theo bảng rồi dùng **Đặt lên sơ đồ** để lưu bốn điểm trong hai phòng.

| Thiết bị | Gán vào | Kịch bản và kết quả |
| --- | --- | --- |
| **Demo - Nhiet do** | **Demo - Phong A** | `Temperature`, 13 phút. Nhiệt độ 26 °C rồi tăng lên 36 °C, điểm xanh rồi vàng với ngưỡng sơ đồ mặc định. Nếu bật bản tin/biến động, lịch sử môi trường có bản tin ổn định và tin biến động. |
| **Demo - Gas** | **Demo - Phong A** | `Gas`, 1 phút 40 giây. Một sự cố Gas **WARNING** ở khoảng giây 15, phục hồi ở giây 80. Khi còn mở, điểm báo sự cố. Gas là trạng thái mô phỏng ghi trong JSON, ADC vẫn là số thô. |
| **Demo - Lua** | **Demo - Phong B** | `Flame`, 1 phút 35 giây. Một sự cố lửa **CRITICAL** ở khoảng giây 15, phục hồi ở giây 75. Banner mở đúng sự cố của thiết bị này. |
| **Demo - Ket noi** | **Demo - Phong B** | `Connectivity`, 3 phút 45 giây. Gửi 30 giây, ngừng 150 giây rồi gửi lại. Sơ đồ đổi từ đang kết nối sang mất kết nối rồi trở lại. Kênh được bật có tin mất kết nối và tin kết nối lại khi lượt mất đã được chấp nhận. |

Trong **Cài đặt → Thông báo**, mỗi người bật **Web Push** của mình. Admin chọn **Telegram chung** trong phần lịch để quản lý chính sách chung. Đích bot và khóa VAPID cấu hình trên server như Mục 10. Với lịch môi trường/kết nối, chọn **Demo - Nhiet do** và **Demo - Ket noi**, bật nhận mô phỏng, giữ giờ yên lặng tắt khi thử, dùng bản tin 5 phút/lần với cửa sổ 5 phút. Đặt biến động 4 °C hoặc 8 điểm %RH, duy trì 3 phút, khoảng nghỉ 10 phút. Đặt chờ mất kết nối và khoảng nghỉ đều 1 phút. Lưu trên mỗi kênh cần thử.

Chạy một trong các lệnh sau. `All` chạy bốn tiến trình đồng thời. Mỗi tiến trình nhận `SIM_DEVICE_ID`, `SIM_DEVICE_KEY` và `SIM_API_URL` qua biến môi trường riêng. Runner cũng hỗ trợ đặt sẵn từng cặp như `SIM_GAS_DEVICE_ID`, `SIM_GAS_DEVICE_KEY`. Tương tự dùng tiền tố `SIM_TEMPERATURE`, `SIM_FLAME` và `SIM_CONNECTIVITY`. Nếu dùng `-EnvFile` riêng lúc chuẩn bị, truyền lại cùng đường dẫn khi chạy.

```powershell
# Chạy cả bộ
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -Scenario All

# Hoặc chạy từng kịch bản
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -Scenario Temperature
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -Scenario Gas
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -Scenario Flame
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -Scenario Connectivity
```

### Hai tình huống kiểm tra

1. **Hai cảm biến tạo sự cố độc lập.** Mở sơ đồ và để tab đăng nhập trước khi chạy `All`. Gas ở phòng A và lửa ở phòng B phải tạo hai banner với hai link khác nhau. Bấm điểm **Demo - Gas → Chi tiết thiết bị → Xem sự cố của thiết bị**. Bộ lọc đã chọn Gas theo ID thiết bị. Mở sự cố, kiểm tra phòng A, **WARNING** và khối **Lịch sử gửi của sự cố**. Mở banner lửa và kiểm tra phòng B, **CRITICAL** và lịch sử riêng. Bấm **Tôi đã nhận cảnh báo** khi sự cố lửa đang mở. Trạng thái chỉ chuyển sang đã kết thúc sau mẫu phục hồi.
2. **Một sự cố gửi tới ba đích.** Đăng nhập cùng admin trên Edge và Chrome, bật Web Push và **Nhận cả cảnh báo mô phỏng** ở cả hai. Giữ cả hai phiên còn hiệu lực và cấu hình một nhóm Telegram thử. Chạy riêng `Gas` rồi mở lịch sử của đúng sự cố WARNING. Kỳ vọng **ba lượt gửi ban đầu** gồm hai Web Push và một Telegram. Nếu có lỗi gửi tạm thời, mở **lần thử gửi** trong dòng tương ứng để thấy các lần retry vẫn thuộc lượt gửi đó. Kiểm tra tin thực tế ở nhóm và trên cả hai trình duyệt để xác nhận đã nhận.

Kết quả kiểm tra tự động, trình duyệt và giới hạn kiểm tra thiết bị thật được ghi trong [báo cáo thay đổi](BAO_CAO_THAY_DOI_MVP.md).

## 12. Check5 cập nhật — từ sơ đồ đến tiếp nhận cảnh báo

**Tổng quan.** Admin chuẩn bị hai phòng và gán bốn Simulator ở Mục 11. Người trực mở danh sách khu vực để thấy nơi phát sinh sự cố, mở phòng, chọn cảm biến rồi mở sự cố. Một WARNING tạo một lượt ban đầu trên mỗi đích phù hợp. CRITICAL có lượt ban đầu và các lượt nhắc riêng trong thời gian còn mở và chưa ai tiếp nhận.

### Cập nhật và chạy

Dừng tiến trình API/web cũ bằng Ctrl+C ở cửa sổ đang chạy. Giải nén vào thư mục riêng, đặt bản cấu hình `.env` của máy bạn cạnh `package.json`. Chọn đúng database demo và giữ bộ khóa VAPID hiện có để trình duyệt nhận ra ứng dụng. Có thể thêm `CRITICAL_REMINDER_SECONDS=15` vào `.env` để kịp thấy nhắc trong kịch bản lửa dài 95 giây. Mặc định là 300 giây, khoảng cho phép từ 10 đến 86400 giây. Khởi động lại API sau khi đổi. Chạy lần lượt trong PowerShell, chỉ tiếp tục sau khi từng lệnh thành công.

```powershell
npm.cmd ci
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run build
npm.cmd run dev
```

Mở **http://127.0.0.1:5173/app/spaces**. Giữ PowerShell này chạy. Với checkout đã có dependency, có thể bắt đầu ở `db:generate`. Ba migration mới giữ các phòng, tọa độ, lượt gửi, lịch sử tiếp nhận và URL sự cố cũ.

### Chuẩn bị trình duyệt và thiết bị

1. Trên từng trình duyệt, vào **Cài đặt → Thông báo**. Bật **Nhận cả cảnh báo mô phỏng**, chọn thiết bị trong **Thiết bị nhận cảnh báo** rồi bấm **Bật Web Push** hoặc **Lưu tùy chọn Web Push**. Để trống danh sách sẽ nhận cảnh báo sự cố từ tất cả thiết bị. Lịch bản tin nhiệt độ/độ ẩm vẫn có danh sách thiết bị riêng trong phần lịch.
2. Đăng ký check5 cũ có dòng “Đăng ký cũ theo phiên”. Bấm **Lưu tùy chọn Web Push** một lần trên chính trình duyệt đó. Nếu đã hết phiên, đăng nhập trước. Bản mới giữ đăng ký khi đóng tab hoặc phiên đăng nhập tự hết hạn. Mở link vẫn phải đăng nhập. Đăng nhập lại cùng tài khoản trên cùng trình duyệt sẽ tiếp tục dùng đăng ký lâu dài. Đăng xuất hoặc tắt Push sẽ ngắt riêng trình duyệt đang dùng. Đăng nhập bằng tài khoản khác thu hồi liên kết của tài khoản trước và tài khoản mới tự chọn bật Push. Tin đã được nhà cung cấp chấp nhận có thể đến muộn. Quyền thông báo của hệ điều hành, HTTPS và cài đặt màn hình chính iPhone xem Mục 10.
3. Admin cấu hình nhóm Telegram và bật gửi Simulator theo Mục 10. Để demo nhắc ngắn, tắt giờ yên lặng hoặc kiểm tra tùy chọn cho CRITICAL vượt giờ yên lặng. Với demo ba đích, dùng đúng một nhóm và hai trình duyệt đã bật cùng thiết bị Gas.
4. Nếu chưa có bộ demo, chạy lệnh `-Provision` ở Mục 11. **Khu vực & phòng → Thêm khu vực → mở khu vực → Thêm phòng**. Trong từng phòng, bấm **Gán thiết bị**, chọn cảm biến chưa gán và **Lưu**. Gán nhiệt độ và Gas vào phòng A, lửa và kết nối vào phòng B. Bấm thiết bị → **Đặt lên sơ đồ** → bấm/chạm lưới → **Lưu vị trí**. Trên máy tính cũng có thể kéo tên hoặc điểm vào lưới rồi lưu. Tải lại để kiểm tra. **Ngưỡng màu trên sơ đồ** áp dụng cho khu vực đang xem.
5. Nếu hai admin cùng mở chế độ đổi vị trí trong một phòng, người lưu sau có thể thấy “Bố trí phòng đã thay đổi”. Bấm **Tải bố trí mới**, chọn lại điểm rồi lưu. Operator và viewer chỉ xem.

### Chạy demo và đọc kết quả

Mở PowerShell thứ hai ở cùng thư mục. Chọn một lệnh trong bảng lệnh dưới đây.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -Scenario All
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -Scenario Gas
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -Scenario Flame
```

- **Hai sự cố độc lập.** Với All, mở danh sách khu vực. Khi Gas và lửa cùng phát sinh, khu vực có hai sự cố mở. Vào từng phòng để thấy số **thiết bị** có sự cố. Một thiết bị có hai sự cố chỉ tính một thiết bị trong tổng của phòng. Những thiết bị chưa đặt điểm vẫn được tính và mở được từ danh sách dưới lưới.
- **WARNING tới ba đích.** Chọn điểm Gas → link sự cố. Mở **Lịch sử gửi của sự cố**. Mỗi trình duyệt và nhóm Telegram có một dòng. Mở dòng để thấy lượt ban đầu, lần thử, lỗi và vị trí lúc tạo thông báo. Admin thấy Telegram chung và Push của chính mình, nên dùng cùng tài khoản trên hai trình duyệt nếu muốn thấy cả ba dòng cùng lúc.
- **Nhắc CRITICAL.** Chạy Flame. Giữ sự cố mở đến khi có “Nhắc lần 1”, rồi bấm **Tôi đã nhận cảnh báo**. Nhắc của sự cố đó dừng cho mọi đích. Trạng thái vẫn là **Chưa kết thúc** tới khi Simulator gửi mẫu phục hồi. Chạy lại Flame và để tự phục hồi để thử cách dừng thứ hai. Chu kỳ tính theo lượt trước của từng đích, worker xét khoảng mỗi 5 giây. Retry/backoff của một lượt không tạo số thứ tự nhắc mới. Một transport đang gửi hoặc một tin đang nằm ở dịch vụ ngoài có thể hoàn tất sau khi tiếp nhận.
- **Phân biệt ba mốc.** “Dịch vụ đã chấp nhận” là kết quả gọi nhà cung cấp. “Bạn đã xác nhận tiếp nhận” là thao tác của tài khoản AirGuard. “Đã kết thúc” do vòng đời sự cố. **Xác nhận nghiệp vụ** bên dưới cho operator/admin lưu ghi chú. **Gọi** mở ứng dụng điện thoại với số đã chọn, **Sao chép số** sao chép số liên hệ.
- Để kiểm tra nhận thật, xem trực tiếp nhóm và cả hai máy/trình duyệt. Ở bản bàn giao này, các ca gửi nhiều đích và nhắc dùng transport giả.

## 13. Demo sơ đồ mới và kiểm tra Edge trên Windows

1. Mở khu vực, chọn thiết bị ở điểm trên lưới hoặc trong danh sách **Chưa đặt vị trí**. Admin chọn **Gỡ khỏi phòng**, đọc tên thiết bị và phòng trong hộp xác nhận. Sau khi đồng ý, vào phòng đích → **Gán thiết bị** → chọn thiết bị → **Lưu**. Nếu muốn đặt điểm mới, chọn **Đặt lên sơ đồ**. Số đo và lịch sử sự cố cũ vẫn thuộc thiết bị; vị trí trong lịch sử gửi vẫn là vị trí lúc tạo tin.
2. Khi có một sự cố, bấm **Xem sự cố Gas**, **Xem sự cố lửa** hoặc **Xem sự cố CO** ngay trong bảng thiết bị. Nếu có nhiều sự cố, mở **Xem N sự cố** và chọn loại/mức cần xử lý. **Chi tiết thiết bị** mở trang riêng. Khi đã phục hồi, vẫn tra cứu được sự cố ở **Cảnh báo & sự cố**.
3. Trong **Edge thường**, mở đúng **http://127.0.0.1:5173/app/settings/notifications** và đăng nhập tài khoản cần nhận. Do đăng ký cũ đã hết phiên, chọn **Nhận cả cảnh báo mô phỏng**, để danh sách thiết bị trống hoặc chọn **Demo - Gas**, rồi bấm **Bật Web Push** (hoặc **Lưu tùy chọn Web Push**). Chọn **Kiểm tra lại** và tìm dòng **Đang nhận thông báo trên trình duyệt này**. Giữ đúng origin và hồ sơ Edge; localhost:5173 có đăng ký riêng. Có thể đóng tab sau khi bật. Đăng xuất chủ động sẽ ngắt nhận.
4. Trong PowerShell tại thư mục chứa package.json, chạy lại `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -Scenario Gas`. Đợi khoảng 15 giây cho pha Gas phát sinh rồi mở sự cố **mới nhất**. Sự cố cũ không gửi bù. Mở lịch sử ngay trong trang sự cố, xem Telegram và Web Push của đúng ID. Nếu chỉ có Telegram, kiểm tra tài khoản, origin, lựa chọn cảm biến và Simulator. Nếu Push báo lỗi, mở dòng để xem mã lỗi/lần thử và giữ mã yêu cầu để tra cứu.
5. Khi Web Push ghi **Dịch vụ đã chấp nhận**, kiểm tra hiển thị vật lý. Trong Edge, mở biểu tượng thông tin trang cạnh thanh địa chỉ → quyền **Thông báo**. Nếu cần chẩn đoán sâu, F12 → Application → Service Workers, kiểm tra `/push-sw.js` ở đúng origin. Trong Windows mở **Cài đặt → Hệ thống → Thông báo → Microsoft Edge**, kiểm tra quyền hiển thị banner và Trung tâm thông báo, cùng chế độ **Không làm phiền**. Mở Trung tâm thông báo (Windows 11: **Win + N**). Ghi riêng “có trong trung tâm” và “thấy banner”. Có thể tin đã vào trung tâm dù Windows không hiện banner nổi.
6. Telegram hiển thị **Xem sự cố**. Với origin local, liên kết dùng được trên chính máy chạy AirGuard. Muốn mở từ điện thoại, cấu hình origin HTTPS mà điện thoại truy cập được. Tiêu đề Push mới hiện loại và mức độ. Tên thiết bị và phòng chỉ hiện khi bật chi tiết. Thời gian chi tiết theo múi giờ đã chọn cho kênh, mặc định Asia/Ho_Chi_Minh.

## 14. Kiểm tra từ phòng đến đúng thông báo

1. Vào **Khu vực & phòng → Demo - AirGuard → Thêm phòng**. Đọc tiêu đề **Thêm phòng vào Demo - AirGuard**, nhập tên và lưu. Phòng mới hiện lưới trống, **0 thiết bị** và **Gán thiết bị**. Chọn **Khách** rồi quay về **Demo - AirGuard** và nhấn F5. Nếu báo đã tạo phòng nhưng sơ đồ đọc lỗi, chọn **Thử lại** để đọc lại.
2. Để AirGuard mở trước khi phát Simulator để thấy banner mới. Mở hai cửa sổ PowerShell tại thư mục chứa package.json. Chạy từng lệnh ở một cửa sổ để tạo Gas và Lửa gần nhau.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -Scenario Gas
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -Scenario Flame
```

3. Bấm phần nội dung của thẻ Gas hoặc đưa tiêu điểm vào thẻ và nhấn Enter. Kiểm tra thiết bị, phòng và ID cuối URL. Nút **Đóng** chỉ ẩn thẻ. Trên sơ đồ, bấm thiết bị rồi mở sự cố. So sánh URL đó với **Xem sự cố** trong Telegram và với trang mở từ Push. Dữ liệu số đo cuối có giờ và nhãn độ mới ngay cả khi thiết bị đã mất kết nối.
4. Để thử trên Windows, dùng cùng hồ sơ Edge đã bật Push cho Simulator. Tải lại AirGuard để trình duyệt kiểm tra bản service worker. Tiêu đề tin mới hiện loại sự cố và mức độ. Bật **Hiển thị chi tiết thông báo** nếu muốn hiện thiết bị, vị trí và giờ trên màn hình khóa. Tin đã nằm trong Trung tâm thông báo giữ nội dung lúc nhận.
5. Mở **Win + N**, bấm vào phần nội dung của một tin. Lần đầu giữ tab AirGuard đang mở. Lần tiếp theo đóng các tab AirGuard trước khi bấm một tin khác. Để kiểm tra phiên tự hết hạn, giữ một tin trong trung tâm đến khi phiên hết hạn rồi bấm và đăng nhập. Cả ba lần cần đến đúng ID sự cố. Có thể mở sự cố đã phục hồi để kiểm tra. Ghi nhận riêng việc thấy tin, bấm tin và URL sau khi mở.
