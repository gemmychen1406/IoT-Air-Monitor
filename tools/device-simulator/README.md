# Simulator AirGuard

[CLI](src/main.ts) nhận chế độ normal/danger hoặc kịch bản; [replay](src/replay.ts) kiểm tra JSON/CSV trước khi phát. [Payload](src/payload.ts) dùng cùng contract, DeviceKey, boot và seq khi POST tới `/api/v1/device/telemetry`. Giữ chế độ cũ khi ghép CLI. Gateway nhận mẫu theo thời gian phát; ADC MQ-2/MQ-7 dùng đơn vị thô.

[Bộ demo](scenarios/run-demo.ps1) dùng bốn thiết bị mô phỏng, mỗi thiết bị có ID và DeviceKey riêng. Admin gán phòng trên web sau khi đăng ký. Chạy từ thư mục gốc sau khi đã cấu hình như [hướng dẫn demo](../../docs/HUONG_DAN_SU_DUNG_MVP_A_Z.md):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -Scenario Gas
```

Kiểm tra parser/nhịp phát bằng `npm.cmd test -- replay.test`. Kiểm tra API nhiều thiết bị bằng `npm.cmd test -- multi-device-demo` với `TEST_MULTI_DEVICE_DATABASE_URL` riêng. Demo phục hồi cần mẫu normal từ chính thiết bị đã báo lỗi. Giữ DeviceKey và cấu hình gửi thật trên máy chạy.

[Quy trình ghép toàn nhánh](../../README.md)

## Nhà mẫu có bảng điều khiển

Nhà mẫu gồm bếp, phòng khách và phòng ngủ, mỗi phòng có ba trạm. Tên, vị trí và mức đo nền dùng chung [danh mục trạm](src/house-stations.json). Bộ phát gửi số đo bình thường mỗi 5 giây kể cả khi đóng tab điều khiển. Tắt máy, để máy ngủ hoặc dừng tiến trình sẽ làm gián đoạn dữ liệu.

### Chạy sau khi clone trên Windows

Cài Git và Node.js 22.12 trở lên. Mở PowerShell ở thư mục muốn lưu project rồi chạy:

```powershell
git clone https://github.com/gemmychen1406/IoT-Air-Monitor.git
cd IoT-Air-Monitor
npm.cmd ci
npm.cmd run diagnostics:local
```

Lệnh cuối khởi động PostgreSQL riêng, API và web trên máy. Giữ cửa sổ này mở. Khi thấy email và mật khẩu admin local, mở cửa sổ PowerShell thứ hai **ở thư mục gốc repo** và chạy:

```powershell
$run = '.\tools\device-simulator\scenarios\run-demo.ps1'
$cfg = Join-Path $PWD ('.local/house-' + (Get-Date -Format yyyyMMdd-HHmmss) + '.env')
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $run -House -Provision -EnvFile $cfg
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $run -House -EnvFile $cfg
```

Lệnh đăng ký hỏi tài khoản admin của cửa sổ đầu và lưu 9 cặp ID/DeviceKey vào tệp riêng dưới `.local`. Mở [bảng điều khiển](http://127.0.0.1:5180), kiểm tra dòng **API nhận số đo** trỏ tới `http://127.0.0.1:4000`. Đăng nhập [web local](http://127.0.0.1:5173/app/overview) bằng cùng tài khoản. Vào **Khu vực & phòng → Nhà mẫu AirGuard** để xem 3 trạm mỗi phòng. Có thể chọn **Tạo bước nhảy** cho trạm **Bếp · Gần cửa**, bấm **Áp dụng**, rồi xem đúng trạm đó trên web. Chọn **Bình thường** và bấm **Áp dụng** để phục hồi.

Nhấn Ctrl+C trong cửa sổ thứ hai để dừng bộ phát. Khi API local vẫn chạy, dùng lại lệnh cuối với cùng tệp `$cfg` để phát tiếp. Mỗi lần khởi động lại `diagnostics:local`, công cụ tạo database mới: chạy lại cả khối lệnh ở cửa sổ thứ hai để cấp bộ khóa mới. Mỗi thành viên dùng database và tài khoản local riêng.

### Gửi tới web nộp

Trên máy đã cấu hình cho web nộp, dùng lệnh sau khi cần khởi động lại. Giữ một tiến trình phát cho bộ thiết bị này. Khi chạy trong cửa sổ PowerShell, nhấn Ctrl+C để dừng.

```powershell
$cfg = Join-Path $env:LOCALAPPDATA 'AirGuard\house-host.env'
powershell.exe -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -House -AllowRemote -PanelPort 5181 -EnvFile $cfg
```

Bảng điều khiển ở <http://127.0.0.1:5181>, web nhận số đo ở <https://io-t-air-monitor.vercel.app/app/overview>. Với môi trường mới, chạy đăng ký bằng `-House -Provision -WebOrigin <URL-web> -ApiUrl <URL-API> -EnvFile <tệp-riêng>`, sau đó khởi động với cùng tệp và `-AllowRemote` khi dùng HTTPS từ xa. Người clone repo có thể tự chạy với API và database local riêng.

### Điều khiển

Chọn kịch bản theo phòng hoặc tình huống riêng cho từng trạm. Nấu ăn tăng nhiệt và ẩm trong khoảng 20–22 phút. Thông gió hoặc hút ẩm chuyển dần từ số đo hiện tại. Từng trạm có thể ngừng gửi, giữ số đo, tạo bước nhảy, nhập tay, đổi ADC hoặc firmware, khởi động lại, thử lỗi DHT11, mất đồng bộ, gas, CO hoặc lửa. Các tình huống cảnh báo có thể tạo sự cố và thông báo trên môi trường đã chọn. Chọn Bình thường để phục hồi.

Nút chuẩn bị lịch sử gửi 120 mẫu cách nhau một phút cho mỗi trạm bằng một phiên cũ, trong khi các trạm tiếp tục phát live. Chỉ bấm khi cần bổ sung dữ liệu vào môi trường đang hiển thị. Hai kỳ báo cáo 24 giờ cần tích lũy ít nhất 48 giờ.
