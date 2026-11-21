# Quy trình kiểm thử nhóm Giám sát thông minh, Mục tiêu môi trường & Khuyến nghị

> Tài liệu chuẩn hóa quy trình dữ liệu và kịch bản kiểm thử phục vụ đối chiếu, tích hợp hệ thống AirGuard.

---

## Quy trình của nhóm Giám sát thông minh là:

### 1. Thiết lập không gian và dải mục tiêu theo từng trạm
Sử dụng dữ liệu từ các trạm ở các vị trí khác nhau (ví dụ: trạm Bếp, trạm Phòng khách, trạm Hầm xe). Người dùng cài đặt một dải mục tiêu mong muốn riêng cho từng phòng (Nhiệt độ 22–28°C, Độ ẩm 45–65%, mức gas MQ-2 < 1000 ADC, mức CO MQ-7 < 600 ADC). Cấu hình này lưu riêng trên web, đóng vai trò như cảnh báo mềm tiện nghi và không đè lên cấu hình phần cứng.

### 2. Dữ liệu số đo đầu vào cần có
Mỗi trạm gửi dữ liệu đều đặn khoảng 5 giây/lần. Gói tin cảm biến bắt buộc có đủ 4 thông số:
- **Nhiệt độ** (`sensors.dht11.temperature_c`): Đơn vị °C.
- **Độ ẩm** (`sensors.dht11.humidity_pct`): Đơn vị %RH.
- **Tín hiệu gas / khói** (`sensors.mq2.adc_raw`): Giá trị ADC thô (0–4095).
- **Tín hiệu khí độc CO** (`sensors.mq7.adc_raw`): Giá trị ADC thô (0–4095).
- **Cảm biến lửa** (`sensors.flame.detected`): Boolean (`true` / `false`).
- **Thời gian đo** (`sampled_at`): Chuỗi thời gian chuẩn ISO để hệ thống nhận diện dữ liệu đang trực tiếp hay đã mất tín hiệu quá 15 phút.

*Lưu ý:* Hệ thống tự động kết hợp thêm nhiệt ẩm ngoài trời từ API thời tiết (Open-Meteo) để so sánh đối lưu.

### 3. Chọn tình huống kiểm thử trên dữ liệu
Bạn chọn một trạm rồi mô phỏng các trạng thái sau để xem phản ứng của hệ thống:
- **Tình huống 1 (Môi trường chuẩn):** Nhiệt ẩm nằm trong khoảng mong muốn, gas và CO thấp $\rightarrow$ Kiểm tra điểm Eco-Score đạt Hạng A (Tối ưu) và không có cảnh báo thừa.
- **Tình huống 2 (Nồm ẩm / Chênh lệch thời tiết):** Cho độ ẩm phòng tăng trên 75% trong khi ngoài trời cũng ẩm ướt $\rightarrow$ Kiểm tra hệ thống có đưa ra lời khuyên đóng kín cửa và bật máy hút ẩm hay không.
- **Tình huống 3 (Khí gas hoặc CO tăng cao):** Cho chỉ số MQ-2 hoặc MQ-7 tăng vượt ngưỡng $\rightarrow$ Kiểm tra điểm Eco-Score có tụt xuống Hạng C/D, hệ thống tự đề xuất bật quạt thông gió và xếp lịch ưu tiên Khẩn cấp (P0/P1) hay không.
- **Tình huống 4 (Thiết bị lỗi hoặc mất tín hiệu):** Ngừng gửi dữ liệu trạm đó quá 15 phút $\rightarrow$ Kiểm tra hệ thống có tự động tạm dừng sinh khuyến nghị rác và báo thiết bị gián đoạn hay không.

### 4. Mở chức năng Giám sát thông minh để đối chiếu kết quả
Các chức năng cùng đọc nguồn dữ liệu này để hiển thị đồng bộ:
- Đồng hồ **Eco-Score** tự nhảy điểm từ 0 đến 100 và đánh giá mức độ dễ chịu (Thoải mái, Bí bách hay Nguy hại).
- **Dòng thời gian 24 giờ** đổi màu các khối giờ tương ứng (Xanh: Đạt chuẩn, Vàng: Cảnh báo nhẹ, Đỏ: Vượt ngưỡng).
- **Khuyến nghị thông minh** hiển thị ngay số đo thực tế, giải thích rõ nguyên nhân kích hoạt và cho phép bấm nút chuyển nhanh thành thẻ việc trên **Bảng nhắc việc (Kanban)**.
- Bảng điều khiển thiết bị chấp hành ảo tự động phản hồi (quạt thông gió bật quay cánh quạt khi nồng độ khí hoặc độ ẩm vượt chuẩn).
