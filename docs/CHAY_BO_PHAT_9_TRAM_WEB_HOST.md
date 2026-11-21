# Chạy bộ phát cho 9 trạm đã đăng ký trên web AirGuard

Dành cho thành viên dùng Windows đã nhận file `house-host.env` của nhóm. Máy bạn chạy bộ phát, còn web và database dùng chung của nhóm vẫn chạy trên host. Khi bật bộ phát, số đo mới được ghi tiếp vào lịch sử của đúng 9 trạm trong khu vực **Nhà mẫu AirGuard** (Bếp, Phòng khách, Phòng ngủ).

## 1. Lưu file cấu hình — làm một lần

1. Nhấn **Win + R**, nhập `%LOCALAPPDATA%` rồi nhấn **Enter**.
2. Mở thư mục **AirGuard** (tạo mới nếu chưa có).
3. Chép file đã nhận vào đó với tên **house-host.env**. Trong File Explorer, bật hiển thị phần mở rộng để kiểm tra file có bị thêm đuôi `.txt` hay không.

File chứa khóa gửi dữ liệu của 9 trạm. Giữ file ngoài repo và chỉ chuyển riêng cho người phụ trách phát.

## 2. Chuẩn bị project — làm một lần

Cài **Git** và **Node.js từ 22.12 trở lên**. Mở PowerShell ở thư mục bạn muốn đặt project và chạy lần lượt:

```powershell
git clone --branch main https://github.com/gemmychen1406/IoT-Air-Monitor.git
cd IoT-Air-Monitor
npm.cmd ci
```

Nếu đã có repo, mở PowerShell trong thư mục **IoT-Air-Monitor** có file `package.json`. Khi đang ở nhánh `main`, chạy `git pull --ff-only origin main` và `npm.cmd ci`, sau đó sang bước 3.

## 3. Bật bộ phát — mỗi lần đến lượt bạn

**Nhờ người đang phát dừng bộ phát trên máy họ trước.** Cả nhóm dùng chung 9 danh tính thiết bị nên chỉ một máy phát tại một thời điểm.

Trong PowerShell ở thư mục **IoT-Air-Monitor**, kiểm tra đường dẫn:

```powershell
$cfg = Join-Path $env:LOCALAPPDATA 'AirGuard\house-host.env'
Test-Path -LiteralPath $cfg -PathType Leaf
```

Nếu hiện `False`, kiểm tra lại vị trí và tên file ở bước 1. Nếu hiện `True`, chạy tiếp trong **cùng cửa sổ**:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -House -AllowRemote -PanelPort 5181 -EnvFile $cfg
```

Giữ cửa sổ này mở. Lệnh sử dụng các khóa đã cấp. **Bỏ qua bước đăng ký `-Provision` và lệnh `diagnostics:local`** trong hướng dẫn demo local.

## 4. Kiểm tra web nộp đã nhận số đo

1. Trên **máy đang phát**, mở [bảng điều khiển](http://127.0.0.1:5181/). Dòng **API nhận số đo** phải hiển thị `https://io-t-air-monitor.vercel.app`.
2. Đợi vài chu kỳ gửi (khoảng 5 giây mỗi chu kỳ). Kiểm tra các trạm hiện **API đã nhận** và thời gian nhận gần nhất tiếp tục tăng.
3. Đăng nhập [Nhà mẫu AirGuard trên web nộp](https://io-t-air-monitor.vercel.app/app/spaces/d3dfe24f-6e8c-4e69-a988-d58d83d451c6). Kiểm tra mỗi phòng có **3 đang kết nối**, rồi chọn một trạm để xem thời gian **Server nhận**. Người xem trên máy khác cũng mở đường dẫn web nộp này.
4. Để đối chiếu một thao tác, ở bảng điều khiển chọn **Bếp → Gần cửa → Tạo bước nhảy → Áp dụng**. Trên web nộp chọn **Bếp · Gần cửa** để xem nhiệt độ thay đổi. Thử xong chọn **Bình thường → Áp dụng** cho cùng trạm.

## Dừng và chạy lại

Đóng tab điều khiển vẫn để bộ phát chạy. Để dừng, nhấn **Ctrl+C** trong cửa sổ PowerShell đang phát. Nếu tắt máy hoặc để máy ngủ, số đo mới sẽ ngừng. Khi muốn phát lại, mở PowerShell ở thư mục project và lặp lại **bước 3** với cùng file cấu hình.

Đối chiếu theo [script trên nhánh main tại commit aca3481](https://github.com/gemmychen1406/IoT-Air-Monitor/blob/aca3481b73b2e88dad0ad72a75284d570c081fb4/tools/device-simulator/scenarios/run-demo.ps1).
