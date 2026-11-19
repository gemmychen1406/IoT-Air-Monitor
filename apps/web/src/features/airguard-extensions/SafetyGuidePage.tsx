import { AlertTriangle, Flame, ShieldAlert, Wind } from 'lucide-react';

const guides = [
  {
    title: 'Rò rỉ khí gas dễ cháy', icon: Wind, tone: 'warning',
    signs: 'AirGuard cảnh báo MQ-2, có mùi gas hoặc nghi ngờ rò rỉ.',
    steps: ['Không bật/tắt công tắc điện, không dùng lửa và không tạo tia lửa.', 'Nếu làm được mà không gặp nguy hiểm, khóa nguồn gas và mở cửa thông gió tự nhiên.', 'Rời khỏi khu vực, cảnh báo những người xung quanh và gọi lực lượng khẩn cấp từ nơi an toàn.', 'Không quay lại cho đến khi người có chuyên môn xác nhận an toàn.'],
  },
  {
    title: 'Nghi ngờ khí CO', icon: ShieldAlert, tone: 'danger',
    signs: 'AirGuard cảnh báo MQ-7 hoặc có người đau đầu, chóng mặt, buồn nôn, lú lẫn.',
    steps: ['Đưa mọi người ra nơi thoáng khí ngay; không nán lại để tìm nguồn phát.', 'Gọi cấp cứu và thông báo nghi ngờ ngộ độc CO. Người có triệu chứng cần được đánh giá y tế.', 'Không vào lại khu vực và không khởi động thiết bị đốt nhiên liệu cho đến khi được kiểm tra.', 'CO không màu, không mùi; tuyệt đối không dựa vào giác quan để kết luận đã an toàn.'],
  },
  {
    title: 'Phát hiện cháy hoặc ngọn lửa', icon: Flame, tone: 'danger',
    signs: 'Cảm biến lửa cảnh báo, nhìn thấy khói/lửa hoặc nghe thiết bị báo cháy chuyên dụng.',
    steps: ['Hô hoán, kích hoạt báo động của tòa nhà và sơ tán theo lối thoát hiểm.', 'Cúi thấp khi có khói, đóng cửa phía sau nếu có thể và không dùng thang máy.', 'Gọi lực lượng chữa cháy từ vị trí an toàn, cung cấp địa chỉ và thông tin rõ ràng.', 'Chỉ dùng bình chữa cháy nếu đã được huấn luyện, đám cháy rất nhỏ và luôn có lối thoát phía sau.'],
  },
];

export default function SafetyGuidePage() {
  return (
    <section className="extension-section safety-guide">
      <div className="extension-heading"><div><h2>Hướng dẫn ứng phó nguy hiểm</h2><p>Các bước ngắn gọn để ưu tiên con người và sơ tán an toàn.</p></div><AlertTriangle /></div>
      <div className="notice error safety-disclaimer" role="note"><AlertTriangle /><div><b>AirGuard chỉ hỗ trợ giám sát.</b><br />Website và cảm biến nghiên cứu này không thay thế thiết bị báo gas, báo CO, báo cháy đạt chứng nhận hoặc hướng dẫn của cơ quan khẩn cấp. Khi có dấu hiệu nguy hiểm thực tế, hãy ưu tiên sơ tán và gọi số khẩn cấp tại địa phương.</div></div>
      <div className="safety-grid">{guides.map(({ title, icon: Icon, tone, signs, steps }) => <article className={`panel safety-card ${tone}`} key={title}><header><Icon /><h3>{title}</h3></header><p><b>Khi nào áp dụng:</b> {signs}</p><ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol></article>)}</div>
      <div className="panel safety-footer"><h3>Sau sự cố</h3><p>Không tự ý đặt lại cảnh báo để che trạng thái đang diễn ra. Ghi nhận thời gian, khu vực, người liên quan và chỉ vận hành lại hệ thống khi nguồn nguy hiểm đã được người có chuyên môn xử lý.</p></div>
    </section>
  );
}

