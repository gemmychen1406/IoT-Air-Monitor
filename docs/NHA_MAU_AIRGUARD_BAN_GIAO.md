# Bàn giao Nhà mẫu AirGuard

## Mục tiêu của nhóm

AirGuard là hệ thống giám sát môi trường không khí hộ gia đình. Nhóm muốn nộp một đường dẫn web để giảng viên có thể xem các chức năng qua cùng một diễn biến trong nhà. Buổi demo tập trung vào nhiệt độ, độ ẩm, thông gió và sự khác biệt giữa các vị trí trong từng phòng. Tín hiệu khí/khói, CO, lửa và lỗi thiết bị là các tình huống riêng để kiểm tra cảnh báo và chẩn đoán.

Web nộp đặt trên Vercel. Vercel chuyển yêu cầu API sang Railway để ghi và đọc PostgreSQL. Mỗi thành viên có thể chạy cùng bộ mô phỏng với database riêng trên máy theo [hướng dẫn chạy local](../tools/device-simulator/README.md#chạy-sau-khi-clone-trên-windows).

Luồng dữ liệu

```text
Bảng điều khiển → Bộ phát Nhà mẫu → API telemetry → PostgreSQL
                                                    ↓
                                      AirGuard đọc qua API chung
```

Mỗi trạm có ID và DeviceKey riêng, được đăng ký với loại nguồn `simulator` và gửi khoảng một mẫu mỗi 5 giây. Tiến trình chạy trên máy người phát duy trì số đo khi đóng tab điều khiển và ngừng gửi khi máy ngủ hoặc tắt. Bản local có database thử riêng. Web nộp sẽ đọc bộ dữ liệu Nhà mẫu sau khi đăng ký thiết bị và cho bộ phát gửi vào API của môi trường nộp.

## Thiết kế đã chốt

**3 phòng, mỗi phòng 3 trạm, tổng cộng 9 trạm.** Tên trạm cần khớp giữa bảng điều khiển và web AirGuard. Ba vị trí trong từng phòng bố trí lệch nhau để có thể xem bản đồ nội suy của chính phòng đó.

| Phòng | Vị trí đặt ba trạm | Kịch bản sinh hoạt chính |
|---|---|---|
| Bếp | Gần bếp nấu, giữa bếp, gần cửa | Nấu ăn làm nhiệt và ẩm tăng từ gần bếp, rồi giảm dần khi thông gió. |
| Phòng khách | Gần cửa sổ, khu vực sinh hoạt, gần cửa thông sang bếp | Mở cửa sổ làm các vị trí thay đổi khác nhau. Trạm gần cửa thông có thể phản ứng trước khi bếp nóng lên. |
| Phòng ngủ | Gần giường, giữa phòng, gần cửa sổ | Phòng kín ẩm dần về đêm. Bật hút ẩm để quan sát độ ẩm giảm và đối chiếu khuyến nghị. |

Mỗi trạm dùng bộ cảm biến hiện có gồm DHT11 cho nhiệt độ và độ ẩm, MQ-2 cho tín hiệu khí/khói, MQ-7 cho tín hiệu CO và cảm biến lửa. Mặc định hai kênh MQ gửi ADC 12 bit. Giá trị ADC dùng để quan sát và so sánh tín hiệu. Gói gửi theo hợp đồng telemetry hiện có, gồm thời gian đo, chất lượng dữ liệu, số thứ tự mẫu, phiên khởi động và trạng thái cảnh báo. Mỗi phòng có một liên hệ hỗ trợ mẫu để kiểm tra trang sự cố.

## Bảng điều khiển cần có

Tổ chức theo **phòng → trạm**. Nút kịch bản theo phòng phối hợp các trạm trong phòng. Nút theo trạm chỉ tác động đến trạm đã chọn. Hiện tình huống đang chạy, trạng thái API và thời điểm nhận thành công gần nhất của từng trạm. Các trạm còn lại tiếp tục gửi khi một trạm ngừng.

| Phạm vi | Nút hoặc lựa chọn | Dữ liệu cần tạo và cách đối chiếu |
|---|---|---|
| Cả nhà hoặc từng trạm | Bình thường | Gửi đều với dao động nhẹ. Dùng làm mốc so sánh và gửi mẫu bình thường để phục hồi cảnh báo. |
| Bếp | Nấu ăn / Bếp nóng dần / Bếp ẩm dần | Nhiệt và ẩm tăng trước gần bếp. Các trạm khác có độ trễ và biên độ thấp hơn. Kịch bản đầy đủ khoảng 20–30 phút để đối chiếu xu hướng, dự báo và tương quan. |
| Theo phòng | Tắt bếp / Thông gió, Mở cửa sổ phòng khách, Phòng ngủ ẩm dần / Bật hút ẩm | Nhiệt hoặc ẩm thay đổi dần từ mức đang có, khác nhau theo vị trí. Đối chiếu Eco-Score, khuyến nghị, đồ thị và so sánh trước/sau. Khuyến nghị theo thời tiết còn phụ thuộc đầu vào Open-Meteo. |
| Cả nhà | Các trạm biến động độc lập | Tạo chuỗi riêng từng trạm để thử phân tích khi thiếu bằng chứng về độ trễ. |
| Theo trạm | Gas cao, CO cao, Phát hiện lửa | Gửi tín hiệu và cờ cảnh báo tương ứng qua nhiều chu kỳ. Có thể giữ gas ở bếp và lửa ở phòng khách cùng lúc. Thử tiếp nhận trên web, rồi phục hồi từng sự cố riêng. |
| Theo trạm | Ngừng gửi / Gửi lại | Thử mất và phục hồi kết nối. Kiểm tra sự cố còn mở khi mất mạng và chỉ kết thúc sau mẫu đã hết cảnh báo. Mốc theo tài liệu là hơn 5 phút cho Forecast và hơn 15 phút cho Giám sát thông minh. |
| Theo trạm | Lỗi cảm biến, Mất đồng bộ giờ, Giữ số đo, Tạo bước nhảy | Tạo mẫu lỗi hoặc không đồng bộ, chuỗi đứng hoặc chênh lệch đột ngột để thử chẩn đoán, lời nhắc và lọc dữ liệu. Chuỗi đứng cần đủ 15 phút theo quy tắc chẩn đoán. |
| Theo trạm | Khởi động lại / Đổi phiên bản mô phỏng | Tạo phiên mới hoặc gửi phiên bản firmware khác để kiểm tra lịch sử thiết bị. |
| Theo trạm | Nhập số đo / Đổi thang ADC thử nghiệm | Nhập nhiệt, ẩm và giá trị MQ. Có thể thử một trạm ở 10 bit để kiểm tra cách So sánh xử lý thang khác nhau, sau đó trả về 12 bit để nội suy với các trạm cùng phòng. |
| Cả nhà | Chuẩn bị lịch sử demo | Chuẩn bị 90–120 phút mẫu hợp lệ rồi tiếp tục phát live. Xác minh API nhận mẫu lịch sử trên local. Để trình diễn đủ hai kỳ 24 giờ cần ít nhất 48 giờ dữ liệu. |

## Các chức năng cùng dùng bộ dữ liệu này

- **Hà · Kiểm tra thiết bị**: chất lượng dữ liệu, gián đoạn và bất thường, kết nối, thời gian, khởi động, lời nhắc và bản đồ phân bố. Để vẽ bản đồ, chọn ba trạm đang online, có mẫu mới, cùng loại cảm biến và cùng thang ADC trong một phòng.
- **Dương · Giám sát thông minh**: đặt mục tiêu từng trạm, kiểm tra Eco-Score và khuyến nghị, chuyển khuyến nghị thành việc trên Kanban, thử thiết bị chấp hành ảo. Mục tiêu và nhắc việc hiện lưu trong trình duyệt.
- **Nhi · Xu hướng & Dự báo**: dùng mẫu DHT11 hợp lệ, có thời gian đo đồng bộ. Thử xu hướng theo phút, dự báo 15/30 phút, kiểm chứng bằng mẫu thực về sau và phân tích độ trễ khi đủ cặp.
- **Ngọc · So sánh & báo cáo**: so sánh hai kỳ liền nhau của một trạm hoặc nhiều trạm trong cùng kỳ. Kiểm tra độ phủ, mẫu lỗi, lịch sử sự cố, CSV và in/lưu PDF.
- **Phương · Không gian, sự cố và thông báo**: kiểm tra phòng, vị trí, trạng thái, liên hệ hỗ trợ, tiếp nhận và phục hồi sự cố. Telegram và Web Push cần kênh thử đã cấu hình để nhận cảnh báo mô phỏng. Bản tin môi trường và kết nối cần kịch bản duy trì đủ thời gian theo chính sách gửi.

Forecast và So sánh cho chọn tối đa **4 trạm mỗi lượt**. Khi demo cả nhà, chọn một trạm đại diện mỗi phòng và thêm một trạm ở phòng đang thử nếu cần. Khi demo bản đồ khí, chọn ba trạm trong cùng phòng.

## Trạng thái triển khai

Bộ phát đã có đủ 3 phòng và 9 trạm. Khi đăng ký, script tạo trạm mô phỏng, cấp DeviceKey riêng, gán phòng và đặt tọa độ trên sơ đồ. Các trạm gửi qua cùng API telemetry mà web sử dụng. Một lần chuẩn bị lịch sử tạo 120 mẫu mỗi trạm, mỗi phút một mẫu. Liên hệ hỗ trợ mẫu cần cấu hình riêng nếu muốn thử trang sự cố.

Trên môi trường nộp đã kiểm tra ba tình huống: tăng nhiệt một vị trí trong bếp, lỗi DHT11 ở phòng khách và ngừng gửi một trạm phòng ngủ. Khi đưa các trạm thử về bình thường, web nhận số đo mới và hiển thị cả 9 trạm đang kết nối.

## Tài liệu liên quan

- [Chạy bộ phát và bảng điều khiển](../tools/device-simulator/README.md)
- [Quy trình thử Giám sát thông minh](QUY_TRINH_TEST_GIAM_SAT_THONG_MINH.md)
- [Kiểm tra thiết bị](../apps/web/src/features/device-diagnostics/README.md)
