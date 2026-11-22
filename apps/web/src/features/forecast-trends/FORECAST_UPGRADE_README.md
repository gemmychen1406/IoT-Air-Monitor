# Forecast 15/30 phút – nâng cấp riêng module

Các thay đổi này **chỉ nằm trong** `apps/web/src/features/forecast-trends/`.
Không chỉnh API, database, Simulator, Dashboard hoặc phần của thành viên khác.

- **Naive, Linear, Holt:** giữ làm đối chứng thống kê và fallback, không ép tạo sóng.
- **Random Forest:** rừng cây hồi quy tự triển khai bằng TypeScript, bootstrap có seed, các đầu vào trễ 1/3/5/10/15/20 phút, mức trung bình và biến động quá khứ của cả nhiệt độ và độ ẩm. Mỗi lá lưu vector dự báo trực tiếp từng phút +1…+30, không dùng giá trị tương lai khi huấn luyện. Yêu cầu ít nhất 50 cửa sổ học đủ dữ liệu.
- **Holt-Winters (additive):** chỉ dự báo khi lịch sử có ít nhất ba chu kỳ liên tục, độ dao động đáng kể và tương quan chu kỳ đạt ngưỡng. Chu kỳ được chọn từ các ứng viên 8/10/12/15/20/30/45/60 phút. Nếu không có bằng chứng chu kỳ thì hiện “chưa đủ dữ liệu” chứ không tự vẽ sóng.
- **Tự động:** so MAE ở các mốc +5, +10, +15 (thêm +20/+25/+30 khi chọn 30 phút); mô hình mới chỉ được chọn nếu tốt hơn mô hình cơ sở trên **cùng các thời điểm dự báo và đối chiếu** ít nhất 8%, đồng thời vượt ngưỡng chênh tuyệt đối. Có kiểm tra tối thiểu cặp gần đây; thiếu thì giữ cơ chế đối chứng.
- **Đối chiếu MAE:** có nút mở riêng trong tab Dự báo. Không trình bày sai số trên các tập kiểm chứng khác nhau như thể so sánh công bằng tuyệt đối.
- **Nguồn:** chuỗi mô hình dựa trên giá trị **trung bình từng phút**, kết quả hiện tại được neo vào mẫu hợp lệ mới nhất (nếu cùng phút và có thời gian đồng bộ), tránh sai lệch điểm đầu giữa Forecast và số đo thô.
- **Cảnh báo:** đồng bộ điều kiện biến động với 6–7 phút liên tục của tab Giám sát. Tách rõ biến động đã đo khỏi dự báo vượt vùng tham chiếu.
- **Lịch sử:** tăng cửa sổ tối đa từ 180 lên 360 phút, nhưng không có nghĩa đã đủ cho chu kỳ ngày-đêm hoặc bảo đảm Random Forest/Holt-Winters tốt hơn trong môi trường thực tế.

## Kiểm tra trên Windows, tại thư mục dự án

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build -w @iot/web
```

## Lưu ý khoa học

Mô hình mới là **mô hình thử nghiệm có kiểm chứng**, không phải bảo đảm chính xác. Dữ liệu Simulator có thể dao động đều theo quy luật, trong khi cảm biến thực tế có nhiễu, thay đổi đột ngột hoặc không có mùa vụ. Nếu kết quả trên các mốc quá khứ không chứng minh được mô hình mới tốt hơn, chế độ Tự động sẽ giữ mô hình đối chứng.
