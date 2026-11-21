# AirGuard — bàn giao hệ thống

Nhánh review `integration/airguard-full-system` dùng `origin/main@d47bb85` làm nền. Sau khi fetch, remote có bốn nhánh chức năng.

| Nhánh nguồn | Đầu nhánh | Kết quả đối chiếu |
|---|---|---|
| Duong/smart-monitoring | b123b12 | Là tổ tiên của main. Giữ phiên bản trên main và sửa lỗi strict trong điều khiển mô phỏng, khuyến nghị và cấu hình mặc định. |
| Ha/device-diagnostics | 98f1d58 | Là tổ tiên của main. Dùng lại runner PostgreSQL nhúng và bộ test chẩn đoán. |
| feat/gas-co-level-display | f69b756 | Là tổ tiên của main. Giữ mức MQ-2/MQ-7 và đơn vị ADC. |
| Phuong/spaces-notification | b3771d2 | Có merge commit riêng. `git merge-tree --write-tree origin/main origin/Phuong/spaces-notification` trả cùng cây với `git rev-parse 'origin/main^{tree}'`, bắt đầu bằng `3030f8d7`. |

Dự báo DHT11 đã có tại đầu main. Có thể kiểm tra lại ba quan hệ tổ tiên bằng `git branch -r --merged origin/main`.

## Đối chiếu bổ sung ngày 21/11/2026

Fetch mới ghi nhận `origin/main@ee0ace3` đã merge PR #5, chứa `Ha/device-diagnostics@49d4ee0`. Đã merge main mới vào nhánh tích hợp, Git ghép tự động thành công. Bản đồ phân bố có thành phần DistributionMap mới, đọc giá trị theo điểm, đường đồng mức, vùng thiếu dữ liệu và bộ sáu điểm mẫu. Bộ mẫu chạy trong trình duyệt, không thêm số đo vào database. Schema và toàn bộ migrations giống main mới. Nhánh Phuong vẫn có merge commit riêng, ghép thử cho kết quả cùng nội dung.

Mô hình vận hành hiện tại là một hệ thống dùng chung cho những người được cấp tài khoản. Tài khoản admin quản lý thiết bị, phòng và người dùng. Operator/viewer xem tập thiết bị chung theo quyền hiện có. Có thể dùng cho một căn nhà hoặc nhóm demo. Schema chưa có thực thể gia đình và quan hệ thành viên để phân chia nhiều căn nhà độc lập trong cùng database.

| Nhóm chức năng | Nguồn mô tả đã đối chiếu | Dữ liệu và giới hạn hiện tại |
|---|---|---|
| Giám sát thông minh của Dương | Commit b123b12 và mã smart-monitoring; commit không bổ sung README riêng | Đọc số đo chung. Mục tiêu, tasks và trạng thái điều khiển lưu localStorage; khóa dùng chung giữa tài khoản trong cùng trình duyệt. Tasks ban đầu là ví dụ. Nút áp dụng lưu trạng thái trên trang; điều khiển tác nhân là mô phỏng. |
| Chẩn đoán của Hà | README device-diagnostics trên nhánh Hà, cập nhật tại 49d4ee0 | Phân tích mẫu gốc, trạng thái và cấu hình từ PostgreSQL. API chỉ đọc. Tọa độ mô phỏng và tùy chỉnh kiểm tra lưu theo tài khoản trên trình duyệt, không đồng bộ với vị trí phòng PostgreSQL. |
| Phòng, sự cố và thông báo của Phương | docs/BAN_GIAO_MODULE_GITHUB.md và README monitoring-spaces, incident-response, alert-delivery, environment | Phòng, gán thiết bị, vị trí, sự cố, tiếp nhận, chính sách và hàng đợi gửi lưu PostgreSQL. Bot token, chat ID và khóa VAPID đặt ở môi trường backend. |
| Mức MQ-2/MQ-7 | Nội dung commit f69b756 và contracts/gas-level.ts | Tính mức từ ADC/full-scale và snapshot thiết bị. Không cần bảng riêng. |
| So sánh và dự báo | Mã comparison-reporting, forecast-trends cùng các bộ test; không có README riêng cho hai thư mục này | Phân tích dữ liệu API chung. Lựa chọn so sánh đã lưu nằm trên trình duyệt theo tài khoản. Dự báo tính lại khi đọc lịch sử, chưa lưu kết quả dự báo thành bản ghi. |

### Những điểm chưa thống nhất về hành vi

- SensorPanel dùng ngưỡng tỷ lệ ADC `0.35/0.55/0.75`. Khuyến nghị thông minh dùng giá trị ADC cố định MQ-2 `1300/2000`, MQ-7 `1100/1800`. Eco-Score dùng mục tiêu riêng. Ví dụ MQ-2 2100 trên thang 12 bit có thể hiện Chú ý ở SensorPanel và khuyến nghị khẩn ở module thông minh. Sự cố gửi Telegram/Push lấy trạng thái và sự kiện thiết bị. Thay mục tiêu Eco-Score chưa đổi quy tắc sự cố.
- Khuyến nghị thông minh còn thay giá trị thiếu bằng mặc định và có câu suy diễn nồng độ/LEL từ ADC. Các kết luận này cần sửa trước khi dùng để hướng dẫn người ở nhà. Chức năng mức ADC đã ghi rõ chưa hiệu chuẩn.
- Sơ đồ phòng PostgreSQL, sơ đồ Tiện ích và tọa độ mô phỏng chẩn đoán là ba dữ liệu khác nhau. Tên và số đo thiết bị lấy chung nhưng bố trí chưa tự đồng bộ.
- Công việc chung của căn nhà chưa có bảng/API. Nếu một người tạo việc bảo dưỡng và muốn mọi thành viên cùng nhìn thấy, cần bổ sung lưu PostgreSQL, người tạo và quyền cập nhật. Cấu trúc hiện tại phù hợp với nhắc việc riêng trên trình duyệt.
- README Tiện ích trước đây ghi chưa tích hợp và liệt kê năm module; đã sửa để khớp route đang hoạt động và ba tab hiện tại.

Đối chiếu schema chứng minh dữ liệu hiện có đủ để đọc các chức năng phân tích đã triển khai. Việc chia sẻ danh sách công việc và mục tiêu giữa thành viên vẫn cần bổ sung nghiệp vụ lưu chung. Chưa chạy nghiệm thu kênh nhận Telegram/Push thật hoặc firmware thiết bị.

Sau khi merge cập nhật Hà, đã chạy lại `npm run build` gồm typecheck, `npm run test:integration` (279 test qua trong 63 tệp, 12 migrations) và `npm run test:e2e` bằng Chrome (mã thoát 0, cùng trạm có 24 mẫu). Kịch bản E2E kiểm tra luồng hệ thống, chưa kiểm tra đầy đủ thao tác đọc điểm và đường đồng mức của DistributionMap mới.

## Chạy từ bản clone

Dùng Node ≥22.12.0. Lần nghiệm thu dùng Windows, Node 26.13.1 và Chrome. Từ thư mục gốc sau khi checkout nhánh tích hợp:

```sh
npm ci --include=dev
npm run db:generate
npm run typecheck
npm run build
npm run build -w @iot/web
npm run diagnostics:local
```

Mở URL và đăng nhập bằng tài khoản mà runner in ra. Runner tạo cụm PostgreSQL mới trong `.local/`, áp migrations, nạp sáu thiết bị mẫu và chạy Express cùng Vite trên loopback. Nếu cổng mặc định đang bận, dùng địa chỉ thực tế trong terminal. Ctrl+C để dừng. Mỗi lần khởi động tạo bộ dữ liệu demo mới.

Với PostgreSQL phát triển riêng cần giữ dữ liệu qua lần khởi động, sao chép `.env.example` thành `.env`, sửa `DATABASE_URL` thành URL database thử nghiệm, đặt `ADMIN_EMAIL`, `ADMIN_PASSWORD`, rồi chạy `npm run db:migrate`, `npm run admin:create` và `npm run dev`. Xóa mật khẩu khởi tạo khỏi môi trường sau bước tạo admin.

## Lặp lại kịch bản

1. Trong **Thiết bị**, tạo trạm loại mô phỏng và cấp khóa. Trong **Khu vực & phòng**, tạo phòng và gán đúng trạm. Ghi ID thiết bị để đối chiếu ở các màn hình.
2. Đặt `SIM_API_URL=http://127.0.0.1:4000` (thay bằng URL API runner in ra), `SIM_DEVICE_ID=<UUID của trạm>` và `SIM_DEVICE_KEY=<khóa vừa cấp>` trong `.env` cục bộ. Chạy `npm run simulate -- --scenario gas --duration 60 --repeat false`. Theo dõi **Giám sát trực tiếp**. MQ hiển thị ADC thô, chưa hiệu chuẩn sang ppm.
3. Ở pha đỉnh, simulator gửi trạng thái gas active cùng số đo. Trong **Cảnh báo & sự cố**, lọc theo trạm, mở chi tiết và xác nhận đã xem. Khi simulator gửi mẫu phục hồi, kiểm tra lúc kết thúc. **Lịch sử gửi** phản ánh công việc của kênh đã cấu hình. Với cả hai kênh tắt, kết quả mong đợi là 0 lượt gửi.
4. Mở **Kiểm tra thiết bị**, chọn trạm. Trong **So sánh & báo cáo**, chọn thêm một trạm có dữ liệu rồi bấm **Xem kết quả**. Trong **Xu hướng & Dự báo**, chọn **Dữ liệu hệ thống** và đúng thiết bị. Kịch bản tự động dưới đây kiểm tra cả lúc mới có hai mẫu và khi đã có 21 mẫu trải đều 20 phút.

## Kết quả nghiệm thu

| Lệnh / phạm vi | Kết quả quan sát |
|---|---|
| `npm ci --include=dev`, `npm run db:generate` | Cài từ lockfile, sinh Prisma Client 7.10.1. npm báo 8 cảnh báo bảo mật mức vừa và 4 mức cao trong cây dependency. |
| `npm run typecheck`, `npm run build`, `npm run build -w @iot/web` | TypeScript strict và hai lệnh build hoàn tất. Vite xuất `apps/web/dist/index.html`. |
| `npm run test:integration` | 12 migrations áp dụng trên PostgreSQL thử nghiệm. 278/278 test qua, 63 tệp, gồm ingestion, phiên đăng nhập, phân quyền, thiết bị/phòng, socket, incident, lịch sử gửi, chẩn đoán, phân tích, so sánh và dự báo. Runner cấp database riêng cho các suite kiểm tra hàng đợi. |
| `npm run cloud:config:check` | 12 test cấu hình API và origin qua. |
| `npm run test:e2e` | Chrome đăng nhập, tạo trạm và gán phòng. MQ-2 trên giao diện đổi từ 1139 sang 3241 ADC trong cùng trang; nhận sự kiện Socket.IO đúng ID. PostgreSQL lưu đúng số đo và sự cố gas; kênh tắt, 0 lượt gửi. Chẩn đoán đọc 21 mẫu, so sánh có biểu đồ và số trung bình, dự báo tính được cả hai đại lượng sau khi có đủ lịch sử. CLI phát thêm ba mẫu từ `example.csv`, tổng cộng 24 bản ghi của trạm. |

Trước khi chạy E2E, dùng `npx playwright install chromium` hoặc đặt `$env:AIRGUARD_BROWSER_CHANNEL='chrome'` trong PowerShell để dùng Chrome cài sẵn. Runner tự mở trình duyệt headless, API, web và database riêng. Repo không có runner thử tải mà script cũ tham chiếu. Các test gửi đồng thời và chống trùng đã chạy trong integration. Chưa đo thông lượng tải và chưa chạy diễn tập backup/restore cần Docker.

## Dữ liệu và triển khai

Xem [hướng dẫn kích hoạt Web Push và mời thành viên vào Telegram theo gia đình](CAU_HINH_CANH_BAO_GIA_DINH.md).

- PostgreSQL dùng chung lưu tài khoản, phiên, thiết bị, khóa, phòng và vị trí, số đo, sự cố, xác nhận và lịch sử gửi. Giám sát trực tiếp nhận sự kiện qua namespace `/monitoring` rồi đọc lại API. Chẩn đoán, phân tích, so sánh và dự báo hệ thống dùng dữ liệu từ API.
- Trình duyệt lưu giao diện, mục tiêu Eco-Score, công việc của module thông minh, tùy chọn chẩn đoán và cấu hình so sánh đã lưu. Nút quạt/cửa sổ/hút ẩm và biểu đồ theo giờ của module thông minh là mô phỏng. Dự báo có chế độ thử nghiệm bốn phòng tách khỏi dữ liệu hệ thống.
- **Vercel** dùng gốc monorepo, install `npm ci --include=dev`, build `npm run build -w @iot/web`, output `apps/web/dist`. Theo `vercel.json`, `/api/:path*` và `/socket.io/:path*` đi tới cùng đường dẫn tại `https://iot-air-monitor-production.up.railway.app`; các route SPA trả `index.html`. Frontend gọi `/api/v1` cùng origin và dùng Socket.IO polling ở bản production.
- **Railway** dùng gốc monorepo. Cài `npm ci --include=dev`, build `npm run cloud:api:build`, pre-deploy `npm run cloud:api:migrate`, start `npm run cloud:api:start`. Đặt `NODE_ENV=production`, `WEB_ORIGIN=https://airguard.example.org` thành origin Vercel thực tế, `DATABASE_URL` từ PostgreSQL của đúng môi trường. Backend đọc `PORT` Railway cấp, mặc định bind `0.0.0.0` ở production. `GET /health/ready` trên hostname API thực thi `SELECT 1` trước khi trả ready. Migrations, socket và kênh gửi cần được kiểm tra riêng.
- **Kênh gửi** dùng `TELEGRAM_ENABLED=false`, `WEB_PUSH_ENABLED=false` khi demo local. Khi nghiệm thu kênh thật, cấu hình riêng `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_INCLUDE_SIMULATORS` hoặc `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT` và đăng ký trình duyệt nhận. Lần nghiệm thu này chỉ chạy local và transport giả trong bộ test. Nhóm cần xác nhận domain, biến môi trường thực tế và việc nhận tin trên thiết bị đích.
