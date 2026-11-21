# Phương — Dữ liệu kiểm thử trên Nhà mẫu AirGuard

Quy trình kiểm thử nhóm chức năng Khu vực & phòng, Xử lý sự cố và Thông báo của Phương:

1. Thiết lập nhà mẫu: Dùng chung nhà mẫu của nhóm gồm 2 phòng và 4 trạm. Ba trạm đặt ở ba vị trí trong Bếp, một trạm đặt ở Phòng khách. Tên trạm trên bộ phát và trên web cần giống nhau để dễ đối chiếu. Mình sẽ gán trạm vào phòng, đặt vị trí trên sơ đồ và tạo một liên hệ hỗ trợ mẫu cho mỗi phòng.

2. Dữ liệu đầu vào cần có: Mỗi trạm dùng một mã thiết bị (`device_id`) và khóa riêng, gửi số đo khoảng 5 giây/lần tới API của web đang demo. Khi demo online thì bộ phát dùng địa chỉ API Railway. Mỗi gói dùng định dạng simulator hiện có, gồm thời gian đo, số thứ tự mẫu, nhiệt độ, độ ẩm, MQ-2, MQ-7, trạng thái cảm biến lửa và trạng thái cảnh báo (`alert_snapshot`). Khi bấm **Áp dụng**, chỉ trạm được chọn đổi tình huống; các trạm còn lại tiếp tục gửi như trước.

3. Chọn tình huống kiểm thử trên bộ phát:

   - Tình huống 1 (Bình thường): Cho cả 4 trạm gửi đều. Ví dụ một trạm gửi 27 °C, độ ẩm 60%, MQ-2 là 900 ADC, MQ-7 là 500 ADC, không phát hiện lửa và các trạng thái cảnh báo đều là `normal`. → Kiểm tra sơ đồ hiển thị đủ 3 trạm ở Bếp, 1 trạm ở Phòng khách và số đo mới nhất của từng trạm.
   - Tình huống 2 (Gas tăng ở Bếp): Chọn **Bếp · gần bếp nấu**, tăng MQ-2 lên khoảng 3200 ADC và gửi `alert_snapshot.gas="active"` qua vài chu kỳ. → Kiểm tra web tạo một sự cố Gas – WARNING tại đúng trạm Bếp. Các mẫu gửi tiếp trong cùng đợt phải cập nhật cùng sự cố. Phần mình cần cả trạng thái `active` vì chỉ tăng số ADC có thể mới làm đổi màu trên giao diện.
   - Tình huống 3 (Lửa ở Phòng khách): Giữ nguyên cảnh báo gas ở Bếp. Chọn trạm Phòng khách, gửi `sensors.flame.detected=true`, `alert_snapshot.flame="active"` và `alert_snapshot.buzzer_commanded_on=true`. → Kiểm tra web có thêm sự cố Lửa – CRITICAL ở Phòng khách. Mở từng sự cố phải thấy đúng trạm, đúng phòng và đúng liên hệ hỗ trợ.
   - Tình huống 4 (Tiếp nhận và phục hồi): Trên web, bấm **Tiếp nhận** sự cố lửa khi trạm Phòng khách vẫn báo lửa. Sau đó mới chọn **Bình thường** cho trạm này trên bộ phát. → Kiểm tra web ghi nhận người tiếp nhận, sự cố vẫn mở cho tới khi nhận mẫu phục hồi. Lúc đó chỉ sự cố lửa kết thúc, còn sự cố gas ở Bếp vẫn mở.
   - Tình huống 5 (Mất kết nối): Ngừng gửi riêng trạm Bếp đang báo gas cho tới khi web hiển thị offline. Sau đó cho chính trạm đó gửi lại mẫu bình thường bằng mã thiết bị cũ. → Kiểm tra mất mạng không tự đóng sự cố gas; khi trạm kết nối lại và báo `gas="normal"`, sự cố mới kết thúc và vẫn xem được trong lịch sử.

4. Kiểm tra Telegram và Web Push: Dùng một nhóm Telegram thử và một trình duyệt đã bật Web Push, cho phép cả hai kênh nhận cảnh báo mô phỏng. Khi chạy tình huống 2 và 3, mở **Lịch sử gửi** để xem kênh và trạng thái gửi. Sau đó mở tin thực nhận trên Telegram hoặc điện thoại: tin gas phải dẫn tới sự cố ở Bếp, tin lửa phải dẫn tới sự cố ở Phòng khách.

5. Kiểm tra bản tin môi trường và kết nối: Dùng lại chế độ **Tăng nhiệt độ** ở một trạm và duy trì đủ thời gian theo chính sách đã cài trên web để kiểm tra tin biến động. Dùng **Ngừng gửi → Gửi lại** để kiểm tra tin mất kết nối và kết nối lại. Với bản tin định kỳ, đặt giờ nhận gần buổi demo rồi đối chiếu trong lịch sử bản tin môi trường.
