# Simulator AirGuard

[CLI](src/main.ts) nhận chế độ normal/danger hoặc kịch bản; [replay](src/replay.ts) kiểm tra JSON/CSV trước khi phát. [Payload](src/payload.ts) dùng cùng contract, DeviceKey, boot và seq khi POST tới `/api/v1/device/telemetry`. Giữ chế độ cũ khi ghép CLI. Gateway nhận mẫu theo thời gian phát; ADC MQ-2/MQ-7 dùng đơn vị thô.

[Bộ demo](scenarios/run-demo.ps1) dùng bốn thiết bị mô phỏng, mỗi thiết bị có ID và DeviceKey riêng. Admin gán phòng trên web sau khi đăng ký. Chạy từ thư mục gốc sau khi đã cấu hình như [hướng dẫn demo](../../docs/HUONG_DAN_SU_DUNG_MVP_A_Z.md):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\device-simulator\scenarios\run-demo.ps1 -Scenario Gas
```

Kiểm tra parser/nhịp phát bằng `npm.cmd test -- replay.test`. Kiểm tra API nhiều thiết bị bằng `npm.cmd test -- multi-device-demo` với `TEST_MULTI_DEVICE_DATABASE_URL` riêng. Demo phục hồi cần mẫu normal từ chính thiết bị đã báo lỗi. Giữ DeviceKey và cấu hình gửi thật trên máy chạy.

[Quy trình ghép toàn nhánh](../../README.md)
