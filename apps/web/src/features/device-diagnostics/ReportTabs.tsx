import type { DiagnosticReport } from "@iot/contracts";
import {
  date,
  duration,
  qualityNames,
  sensorNames,
  Stat,
  Table,
} from "./shared.js";

export function QualityTab({ report }: { report: DiagnosticReport }) {
  return (
    <section className="panel dd-section">
      <h2>Số đo có dùng được không?</h2>
      <p>
        Cảm biến đang chuẩn bị đo và cảm biến đọc lỗi là hai tình trạng khác
        nhau. Tín hiệu khí chưa hiệu chuẩn vẫn có thể xem ở dạng ADC, chưa dùng
        để suy ra nồng độ.
      </p>
      <div className="dd-quality-grid">
        {report.quality.map((item) => (
          <article className="dd-quality" key={item.sensor}>
            <h3>{sensorNames[item.sensor]}</h3>
            <p>{item.total.toLocaleString("vi-VN")} mẫu đã kiểm tra</p>
            <div className="dd-quality-bar" aria-hidden="true">
              {Object.entries(item.counts)
                .filter(([, count]) => count)
                .map(([key, count]) => (
                  <span
                    key={key}
                    className={`dd-q-${key}`}
                    style={{ width: `${(100 * count) / item.total}%` }}
                  />
                ))}
            </div>
            <dl>
              {Object.entries(item.counts).map(([key, count]) => (
                <div key={key}>
                  <dt>
                    <i className={`dd-q-${key}`} />
                    {qualityNames[key]}
                  </dt>
                  <dd>
                    {count.toLocaleString("vi-VN")}{" "}
                    <small>
                      (
                      {item.total
                        ? ((100 * count) / item.total).toFixed(1)
                        : "—"}
                      %)
                    </small>
                  </dd>
                </div>
              ))}
            </dl>
            {item.stale ? (
              <p className="dd-muted">
                {item.stale} mẫu có số đo đã cũ hơn 30 giây ngay trong gói gửi;
                không dùng các mẫu này để nhận diện tín hiệu bất thường.
              </p>
            ) : null}
          </article>
        ))}
      </div>
      <details>
        <summary>Hiểu các trạng thái</summary>
        <p>
          Hợp lệ: mẫu đáp ứng điều kiện đọc của thiết bị. Chưa hiệu chuẩn: có
          tín hiệu ADC nhưng chưa xác định nồng độ khí. Đang khởi động/gia
          nhiệt: chưa sẵn sàng đánh giá. Lỗi đọc: thiết bị báo không lấy được số
          đo.
        </p>
        <p>
          Tỷ lệ ở đây tính trên các mẫu đã nhận, không phải tỷ lệ thời gian hoạt
          động hoặc chứng nhận độ chính xác của cảm biến.
        </p>
      </details>
    </section>
  );
}
export function EventsTab({ report }: { report: DiagnosticReport }) {
  const labels = {
    gap: "Thiếu mẫu",
    flat: "Ít thay đổi",
    jump: "Thay đổi nhanh",
    clock: "Giờ đi lùi",
  };
  return (
    <section className="panel dd-section">
      <h2>Có khoảng nào cần xem lại?</h2>
      <p>
        Các dấu hiệu dưới đây giúp tìm đoạn dữ liệu cần kiểm tra. Môi trường ổn
        định hoặc một thay đổi thật cũng có thể tạo dấu hiệu tương tự.
      </p>
      {report.event_count ? (
        <>
          <p role="status">
            {report.event_count} dấu hiệu; hiển thị tối đa 200 dấu hiệu gần
            nhất.
          </p>
          <Table
            caption="Các khoảng dữ liệu cần kiểm tra"
            headers={[
              "Dấu hiệu",
              "Cảm biến",
              "Khoảng ghi nhận trên server",
              "Giải thích",
            ]}
          >
            {report.events.map((e, i) => (
              <tr key={i}>
                <th scope="row">{labels[e.kind]}</th>
                <td>{sensorNames[e.sensor]}</td>
                <td>
                  {date(e.from)}
                  <br />
                  đến {date(e.to)}
                </td>
                <td>{e.detail}</td>
              </tr>
            ))}
          </Table>
        </>
      ) : (
        <div className="dd-empty">
          Chưa thấy dấu hiệu theo ngưỡng đã chọn. Điều này không thay thế việc
          kiểm tra thiết bị.
        </div>
      )}
      <details>
        <summary>Cách nhận diện</summary>
        <p>
          Khoảng trống dựa trên thời gian hoạt động giữa hai mẫu trong cùng
          phiên khởi động và khoảng im lặng cuối kỳ. Chu kỳ tham chiếu theo
          phiên bản cấu hình của mẫu nếu còn lịch sử. Đứng tín hiệu chỉ xét
          chuỗi liên tục. Thay đổi nhanh chỉ xét hai mẫu cách nhau tối đa 2
          phút; bỏ qua mẫu lỗi và lần đổi độ phân giải ADC.
        </p>
        <p>
          Thời điểm trong bảng là lúc server nhận; mẫu gửi bù có thể được nhận
          cùng lúc dù được đo cách xa nhau.
        </p>
      </details>
    </section>
  );
}
export function ConnectionTab({
  report,
  incomplete,
}: {
  report: DiagnosticReport;
  incomplete: boolean;
}) {
  const c = report.connection;
  return (
    <section className="panel dd-section">
      <h2>Kết nối có ổn định không?</h2>
      <div className="dd-stats">
        <Stat
          title="Lần chuyển mất kết nối"
          help="Trong lịch sử của khoảng chọn"
        >
          {incomplete ? "Chưa kết luận" : c.disconnects}
        </Stat>
        <Stat title="Thời gian mất kết nối">
          {incomplete ? "Chưa kết luận" : duration(c.offline_ms)}
        </Stat>
        <Stat title="Chưa xác định trạng thái">
          {incomplete ? "Chưa kết luận" : duration(c.unknown_ms)}
        </Stat>
        <Stat
          title="Khoảng cách mẫu thường gặp"
          help="Trung vị theo thời gian hoạt động"
        >
          {duration(c.interval_median_ms)}
        </Stat>
        <Stat
          title="Từ lúc đo đến lúc nhận"
          help={`${c.delay_count} mẫu có thời gian đồng bộ, không âm`}
        >
          {duration(c.delay_median_ms)}
        </Stat>
        <Stat
          title="95% mẫu nhận trong"
          help="Tính trên các mẫu có độ trễ không âm"
        >
          {duration(c.delay_p95_ms)}
        </Stat>
      </div>
      <p>
        Thiết bị có thể vẫn online nhưng cảm biến không gửi số đo mới. Thời gian
        đo–nhận gồm cả chờ gửi, truyền mạng và sai lệch đồng hồ; không phải phép
        đo riêng tốc độ Wi‑Fi.
      </p>
      <details>
        <summary>Giới hạn của lịch sử kết nối</summary>
        <p>
          Hệ thống dùng trạng thái ngay trước khoảng chọn làm mốc và cắt thời
          gian mất kết nối theo hai biên. Phần chưa có mốc được ghi chưa xác
          định. Khoảng cách mẫu được đo trong cùng phiên khởi động, không phải
          khoảng cách giữa các gói mạng; gửi gộp có thể làm hai đại lượng này
          khác nhau.
        </p>
      </details>
    </section>
  );
}
export function ClockTab({ report }: { report: DiagnosticReport }) {
  return (
    <section className="panel dd-section">
      <h2>Thiết bị có ghi đúng thời gian không?</h2>
      <div className="dd-stats">
        <Stat title="Mẫu đã đồng bộ giờ">{report.clock.synced}</Stat>
        <Stat title="Mẫu chưa đồng bộ">{report.clock.unsynced}</Stat>
        <Stat title="Lần giờ đo đi lùi">{report.clock.backwards}</Stat>
        <Stat title="Mẫu có giờ đo sau lúc nhận">{report.clock.future}</Stat>
      </div>
      <p>
        Nếu thiết bị chưa đồng bộ giờ, hãy xem lịch sử theo thời gian server
        nhận. Mẫu có giờ đo sau lúc nhận có thể do đồng hồ lệch; phần chênh lệch
        âm không được gộp vào thống kê độ trễ.
      </p>
      <details>
        <summary>Cách kiểm tra giờ đi lùi</summary>
        <p>
          Sắp xếp theo phiên khởi động và số thứ tự mẫu, chỉ so sánh thời gian
          đo của hai mẫu cùng phiên. Mẫu đến server không đúng thứ tự không tự
          tạo lỗi giờ đi lùi.
        </p>
      </details>
    </section>
  );
}
export function SessionsTab({ report }: { report: DiagnosticReport }) {
  return (
    <section className="panel dd-section">
      <h2>Thiết bị đã khởi động lại khi nào?</h2>
      <div className="dd-stats">
        <Stat title="Phiên có dữ liệu">{report.session_count}</Stat>
        <Stat
          title="Lần đổi phiên quan sát được"
          help="Số phiên trừ phiên đầu, là mức tối thiểu"
        >
          {report.reboots_observed}
        </Stat>
        <Stat title="Lần thay đổi phiên bản">
          {report.firmware_change_count}
        </Stat>
      </div>
      <p>
        Phiên đầu có thể đã bắt đầu trước khoảng đang xem. Thời điểm bên dưới là
        lúc server quan sát được, không khẳng định thời điểm khởi động chính xác
        hay nguyên nhân.
      </p>
      {report.sessions.length ? (
        <>
          <p>Hiển thị tối đa 200 phiên gần nhất trong khoảng có dữ liệu.</p>
          <Table
            caption="Các phiên hoạt động"
            headers={[
              "Phiên",
              "Nhận mẫu đầu / cuối",
              "Số mẫu",
              "Phiên bản phần mềm",
            ]}
          >
            {report.sessions.map((s, i) => (
              <tr key={s.boot_id}>
                <th scope="row">
                  Phiên{" "}
                  {Math.max(0, report.session_count - report.sessions.length) +
                    i +
                    1}
                  <details>
                    <summary>Mã kỹ thuật</summary>
                    <code>{s.boot_id}</code>
                    <p>Bộ đếm: {s.boot_counter}</p>
                  </details>
                </th>
                <td>
                  {date(s.first_at)}
                  <br />
                  đến {date(s.last_at)}
                </td>
                <td>{s.samples}</td>
                <td>{s.firmware.join(", ")}</td>
              </tr>
            ))}
          </Table>
        </>
      ) : (
        <p>Chưa có phiên hoạt động để hiển thị.</p>
      )}
      {report.firmware_changes.length ? (
        <>
          <p>Hiển thị tối đa 200 lần thay đổi gần nhất.</p>
          <Table
            caption="Lịch sử thay đổi phần mềm quan sát được"
            headers={["Nhận tại", "Trước", "Sau"]}
          >
            {report.firmware_changes.map((f, i) => (
              <tr key={i}>
                <td>{date(f.at)}</td>
                <td>{f.previous}</td>
                <td>{f.current}</td>
              </tr>
            ))}
          </Table>
        </>
      ) : null}
    </section>
  );
}
