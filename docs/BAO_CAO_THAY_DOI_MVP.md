# Báo cáo thay đổi AirGuard MVP

## Trạng thái bốn nhóm MVP

| Nhóm | Kết quả |
| --- | --- |
| Mục 5 — Khu vực, phòng và gán thiết bị | Đã bổ sung sơ đồ 2D và xác minh trên PostgreSQL và Chrome local. |
| Mục 6 — Thông báo môi trường và kết nối | Đã nối cài đặt, scheduler, worker, lịch sử và demo transport giả. Kiểm tra độc lập đã qua. PostgreSQL, build và UI end-to-end còn cần xác minh. |
| Mục 7 — Tiếp nhận cảnh báo và lịch sử gửi | Đã nối worker hiện có, lịch sử, quyền riêng tư Push và xác nhận. Kiểm tra độc lập đã chạy, migration và luồng tích hợp còn cần PostgreSQL/dependencies. |
| Mục 8 — Danh bạ và gọi hỗ trợ | Triển khai lượt trước. Lượt này ẩn vị trí và thao tác gọi từ cache khi tải lại thất bại, giữ nút **Thử lại**. |

## Lượt Mục 5 và 8 — 18 file mới

| File | Vai trò |
| --- | --- |
| `packages/contracts/src/monitoring-spaces.ts` | Schema đầu vào và DTO cho khu vực, phòng, gán thiết bị. |
| `packages/contracts/src/incident-response.ts` | Schema danh bạ, chuẩn hóa số, DTO liên hệ và vị trí sự cố. |
| `packages/database/prisma/migrations/202611180001_monitoring_spaces_and_support/migration.sql` | Tạo bốn bảng cùng các khóa, chỉ mục và ràng buộc. |
| `apps/api/src/modules/monitoring-spaces/store.ts` | Khóa giao dịch, chuẩn hóa tên và kiểm tra tham chiếu. |
| `apps/api/src/modules/monitoring-spaces/routes.ts` | Danh sách, thêm/sửa/lưu trữ/khôi phục và gán/bỏ gán. |
| `apps/api/src/modules/incident-response/contacts.ts` | DTO, kiểm tra phạm vi, xếp ưu tiên và loại số trùng. |
| `apps/api/src/modules/incident-response/routes.ts` | Quản trị danh bạ và tra cứu hỗ trợ theo sự cố. |
| `apps/api/tests/monitoring-spaces-support.test.ts` | Kịch bản API với PostgreSQL test, kiểm tra quyền, tên trùng đồng thời, lưu trữ, fallback và phạm vi. |
| `apps/web/src/features/monitoring-spaces/MonitoringSpacesPage.tsx` | Màn hình danh mục và bộ lọc, quản lý tải và lưu qua React Query. |
| `apps/web/src/features/monitoring-spaces/SpaceEditor.tsx` | Form thêm và sửa khu vực/phòng. |
| `apps/web/src/features/monitoring-spaces/DeviceAssignments.tsx` | Xem, gán và bỏ gán phòng, hiển thị vị trí cũ khi chưa gán. |
| `apps/web/src/features/monitoring-spaces/styles.css` | Bố cục responsive cho không gian giám sát. |
| `apps/web/src/features/incident-response/SupportContactsPage.tsx` | Giao diện quản trị danh bạ, gồm lưu trữ và khôi phục. |
| `apps/web/src/features/incident-response/IncidentSupport.tsx` | Vị trí, thứ tự liên hệ, gọi nhanh và sao chép số. |
| `apps/web/src/features/incident-response/styles.css` | Bố cục responsive cho danh bạ và thao tác hỗ trợ. |
| `apps/web/src/features/incident-response/IncidentSupport.test.tsx` | Kiểm tra đích `tel:`, vị trí hiển thị và chọn số khi clipboard thất bại. |
| `docs/BAO_CAO_THAY_DOI_MVP.md` | Báo cáo triển khai và kiểm chứng. |
| `docs/HUONG_DAN_SU_DUNG_MVP_A_Z.md` | Hướng dẫn cài đặt, kiểm thử và demo. |

## Lượt Mục 5 và 8 — 5 file cũ đã sửa

| File | Thay đổi và lý do | Tương thích và điểm ghép |
| --- | --- | --- |
| `apps/api/src/app.ts` | Import và đăng ký hai router vào router đã xác thực. Module mới cần được gắn vào Express. | Ghép ở nhóm import và nhóm `register…(features, context)`, trước khi gắn `features`. Giữ nguyên middleware, envelope và route cũ. |
| `apps/web/src/App.tsx` | Thêm hai lazy import, biểu tượng, menu và route. Router và menu được khai báo tại đây. | Ghép route và menu không gian chung, đặt menu danh bạ trong nhánh admin. |
| `apps/web/src/pages/IncidentPage.tsx` | Import và chèn `IncidentSupport` trước phần xác nhận. Đây là điểm hiển thị nội dung theo sự cố. | Giữ truy vấn chi tiết, xác nhận nghiệp vụ và timeline hiện có. |
| `packages/contracts/src/index.ts` | Export hai file mới vì các ứng dụng lấy contract qua entry point này. | Thêm export bên cạnh các export hiện có. |
| `packages/database/prisma/schema.prisma` | Thêm bốn model và quan hệ ngược tùy chọn `Device.roomAssignment`. Prisma generate đọc schema chung. | Quan hệ ngược không thêm cột vào bảng `devices`. Ghép model theo tên và giữ migration của các thành viên khác. |

## API và dữ liệu

Các URL dưới đây dùng tiền tố `/api/v1`. Tất cả yêu cầu phiên đăng nhập. Các thao tác ghi tiếp tục dùng header `X-Requested-With: AirGuard` như API hiện có.

| Phương thức và đường dẫn | Quyền | Dữ liệu |
| --- | --- | --- |
| `GET /spaces` | Cả ba role | Khu vực, phòng, thiết bị hiện hành và thiết bị lưu trữ đang có phòng. Có trạng thái lưu trữ và liên kết hiện tại. Bộ lọc danh sách xử lý trên giao diện. |
| `POST /spaces/areas`, `PUT /spaces/areas/:id` | Admin | `{name, description}` |
| `POST /spaces/rooms`, `PUT /spaces/rooms/:id` | Admin | `{name, description, area_id}` |
| `PATCH /spaces/areas/:id/archive`, `PATCH /spaces/rooms/:id/archive` | Admin | `{archived: true/false}` |
| `PUT /spaces/devices/:id/room` | Admin | `{room_id: UUID hoặc null}` |
| `GET /support/contacts` | Admin | Danh bạ quản trị, gồm mục đã lưu trữ. |
| `POST /support/contacts`, `PUT /support/contacts/:id` | Admin | `{name, role, phone, description, priority, scope}`. Scope dùng `{kind: "global"}` hoặc `{kind: "area"/"room", id}`. |
| `PATCH /support/contacts/:id/archive` | Admin | `{archived: true/false}` |
| `GET /alerts/incidents/:id/support` | Người có quyền xem sự cố (cả ba role hiện tại) | Vị trí hiện tại có nguồn rõ ràng và danh bạ được lọc. Sự cố không tồn tại trả 404. |

API hiện có giữ schema request, response và quyền cũ. Các API mới dùng envelope chung. Lỗi quyền trả 403, dữ liệu sai định dạng trả 422, tham chiếu không tồn tại trả 404 và xung đột nghiệp vụ trả 409.

Migration bổ sung `MonitoringArea`, `MonitoringRoom`, `DeviceRoomAssignment`, `SupportContact`. Unique key trên `device_id` giới hạn một phòng trên mỗi thiết bị. Unique key tên, khóa ngoại và CHECK bảo vệ dữ liệu. Khóa advisory theo giao dịch tuần tự hóa các thao tác ghi mới liên quan đến danh mục, để lưu trữ và gán/khôi phục không vượt qua kiểm tra của nhau. Schema và script hiện có đủ để triển khai, không cần dependency, biến môi trường hoặc worker mới.

## Chính sách đã triển khai

- Tên hiển thị được trim. Khóa so trùng dùng Unicode NFC, chữ thường, rồi NFC lần nữa. Dấu tiếng Việt vẫn có ý nghĩa. Khu vực giữ tên duy nhất toàn danh mục, phòng giữ tên duy nhất trong khu vực cha. Bản ghi lưu trữ vẫn giữ tên.
- Admin có thể chuyển phòng sang khu vực đang hoạt động. Liên kết thiết bị và liên hệ cấp phòng đi theo phòng. Khu vực còn phòng hoạt động bị từ chối lưu trữ. Lưu trữ phòng giữ nguyên liên kết đã có, chặn gán mới và cho phép bỏ gán. Khôi phục phòng yêu cầu khu vực cha hoạt động.
- Sự cố dùng tên/mô tả vị trí hiện tại. Phòng đã lưu trữ vẫn có thể được hiển thị với nhãn lưu trữ. Danh bạ cấp phòng hoặc khu vực bị lưu trữ được loại tương ứng. Khi chưa gán phòng, hệ thống dùng `Device.location` và danh bạ chung.
- Danh bạ sự cố chỉ có liên hệ hoạt động, lần lượt theo phòng, khu vực và chung. Trong từng phạm vi, số ưu tiên nhỏ hơn đứng trước, sau đó là tên và ID. Một số chuẩn hóa chỉ xuất hiện một lần. Số Việt Nam 10 chữ số đầu 0 đổi sang +84, số quốc tế lưu dưới dạng dấu + và 7–15 chữ số. API từ chối URI và phần mở rộng số. Việc kiểm tra định dạng không xác minh chủ số hay khả năng liên lạc.
- Nút gọi mở ứng dụng xử lý `tel:`. Nút sao chép dùng Clipboard API hoặc chọn sẵn số để sao chép thủ công. MVP không ghi log cuộc gọi và không có số mặc định. Danh bạ và vị trí được lưu ở database, độc lập với phiên trình duyệt.
- Trang hỗ trợ sự cố hiển thị vị trí hiện tại. Snapshot riêng của thông báo hiện được mô tả ở phần Mục 7 bên dưới.

## Kiểm tra

| Lệnh/cách kiểm tra | Kết quả |
| --- | --- |
| `node -v`, `npm -v`, kiểm tra `node_modules`, `.env`, `psql`/`postgres`/`docker` | Shell thiếu Node/npm trong PATH, thiếu dependencies và `.env`, không tìm thấy các công cụ PostgreSQL/Docker. |
| `curl.exe -I --connect-timeout 5 https://registry.npmjs.org/typescript` | Không kết nối được từ môi trường này. WSL cũng trả `E_ACCESSDENIED` khi liệt kê distro. |
| Chạy `Code.exe <thư mục tạm>/check.cjs <typescript.js của VS Code>` bằng Node 24.22.1 tích hợp | Pass. TypeScript 6.0.3 transpile 18 file TS/TSX đã rà, gồm cả các điểm tích hợp và file test, không có lỗi cú pháp. |
| `ts.createProgram` với `strict` và `noEmit` cho hai contract mới, cùng Zod 4.6.5 từ cache | Pass. Đây là kiểm tra riêng hai contract. Lockfile dùng Zod 4.6.7. |
| `node:assert/strict` trong script tạm, chạy trên các module đã transpile | Pass. Kiểm tra trim/NFC/hoa thường, số quốc tế và Việt Nam, từ chối URI/ký tự điều khiển, bỏ gán bằng null, thứ tự và loại số trùng. |
| `npm ci`, `npm run db:generate`, `npm run db:migrate` | Chưa chạy. Thiếu npm, dependency và database/cấu hình local. |
| `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` | Chưa chạy với bộ dependency đúng lockfile. |
| `npm test -- apps/api/tests/monitoring-spaces-support.test.ts apps/web/src/features/incident-response/IncidentSupport.test.tsx` | Chưa chạy. Test API cần thêm database test đã migrate. Test giao diện cần dependencies và jsdom. |
| Demo UI, kiểm tra migration thật và hồi quy đăng nhập, thiết bị, monitoring, cảnh báo, analytics, tiện ích | Chưa chạy. Hướng dẫn tái hiện nằm trong tài liệu sử dụng. |

Bản thư mục được giao không có metadata Git hoặc thư mục `tests/` gốc. Vì vậy chưa có diff từ Git để so với đầu nhánh của nhóm, và các script integration/e2e cấp gốc trỏ tới runner thiếu trong bản này. Hai test mới nằm cạnh test hiện hữu của từng ứng dụng. Chưa đủ dữ liệu để kết luận có lỗi build nền hay lỗi build do đợt này.

## Ghép và rollback

1. Ghép hai contract và dòng export, schema và thư mục migration mới. Nếu nhánh đích đã có migration khác, giữ toàn bộ migration đó và kiểm tra thứ tự/tên trước khi áp dụng.
2. Ghép hai module API, đăng ký router sau xác thực. Ghép hai thư mục frontend rồi chèn menu/route và phần liên hệ trong sự cố.
3. Ghép test và tài liệu. Chạy generate, migrate trên database test, typecheck/build/lint, test mới và demo theo tài liệu B trước khi đưa vào database dùng chung.
4. Khi cần tắt sau khi đã migrate, triển khai bản trước thay đổi hoặc bỏ điểm đăng ký route/menu, component sự cố và hai router mới. Không có worker mới để dừng. Giữ migration và dữ liệu đã tạo khi rollback code. Lập kế hoạch migration riêng nếu sau này thực sự cần thay đổi cấu trúc đã triển khai.

Các bảng danh mục trả toàn bộ dữ liệu ở quy mô MVP. Gọi phụ thuộc thiết bị có trình xử lý `tel:`. Telegram callback, chuyển cấp và gọi tự động là hướng phát triển sau, cần chính sách quyền và vận hành riêng.

## Lượt Mục 7 và sửa lỗi danh bạ

Thư mục không có `.git`. Trước khi sửa, đối chiếu SHA-256 của 156 file với ZIP `IoT-Air-Monitor-main(check1).zip` ở thư mục cha. Không có khác biệt. Đợt này bổ sung 12 file và sửa 15 file tính cả hai tài liệu bàn giao.

| File mới | Chức năng |
| --- | --- |
| `packages/contracts/src/alert-delivery.ts` | DTO lịch sử, trạng thái, receipt và validation tùy chọn Push. |
| `packages/database/prisma/migrations/202611180002_alert_delivery_history/migration.sql` | Cột quyền riêng tư, ba bảng, nạp trạng thái công việc cũ còn tồn tại và trigger ghi lịch sử. |
| `apps/api/src/modules/alert-delivery/routes.ts` | API tùy chọn cá nhân, quyền xem lịch sử và nhận xác nhận. |
| `apps/api/src/modules/alert-delivery/receipt.ts` | Kiểm tra điều kiện tiếp nhận và ghi idempotent theo tài khoản–sự cố. |
| `apps/api/src/modules/alert-delivery/message.ts` | Nội dung Telegram, URL HTTPS và chi tiết Push. |
| `apps/api/src/modules/alert-delivery/revoked-result.ts` | Hoàn tất dấu vết in-flight khi xóa đăng ký trong lúc chờ phản hồi. |
| `apps/api/tests/alert-delivery-history.test.ts` | PostgreSQL test cho quyền, nhận đồng thời, snapshot, retry, phiên, chống trùng, cursor và xác nhận muộn. |
| `apps/web/src/features/incident-response/IncidentReceipt.tsx` | Nút nhận, kết quả của mình và danh sách có phân trang cho operator/admin. |
| `apps/web/src/features/notification-center/DeliveryHistoryPage.tsx` | Lịch sử gửi với bộ lọc, từng lần thử, phân trang và link sự cố. |
| `apps/web/src/features/notification-center/PushPrivacyPreference.tsx` | Tùy chọn tài khoản về chi tiết Push. |
| `apps/web/src/features/notification-center/styles.css` | CSS giới hạn ở bộ lọc và thẻ lịch sử. |
| `tools/operations/mock-alert-delivery.ts` | API demo loopback, dùng đúng hàng đợi và worker Telegram với transport giả. |

| File cũ đã sửa | Lý do cần sửa và điểm ghép |
| --- | --- |
| `packages/database/prisma/schema.prisma` | Prisma cần cột `User.pushShowDetails`, ba model và quan hệ ngược để generate. Ghép cùng migration mới. |
| `packages/contracts/src/index.ts` | Export contract từ entry point mà hai ứng dụng đang dùng. |
| `apps/api/src/app.ts` | Gắn router mới sau xác thực, chung middleware ghi và envelope cũ. |
| `apps/api/src/runtime.ts` | Truyền `WEB_ORIGIN` hiện có đến lớp gửi Telegram. Giữ vòng đời worker. |
| `apps/api/src/modules/notifications.ts` | Worker Telegram cần đọc snapshot được ghi khi enqueue và dựng URL sự cố từ origin. Giữ job, lease, retry và transport. |
| `apps/api/src/modules/web-push.ts` | Ngay trước gửi, đọc consent, VAPID, phiên và lease hiện hành. Nối snapshot và lưu kết quả cuối khi subscription bị xóa. Giữ bảng công việc, topic và transport cũ. |
| `apps/web/public/push-sw.js` | Service worker đã đăng ký cần hiểu cả payload cũ và chi tiết v2, chỉ mở route cùng origin cho phép. |
| `apps/web/src/App.tsx` | Thêm lazy route và mục **Lịch sử gửi** ngay trong điều hướng chung. |
| `apps/web/src/components/PushSettings.tsx` | Chèn tùy chọn chi tiết và cập nhật câu giải thích màn hình khóa. |
| `apps/web/src/pages/IncidentPage.tsx` | Chèn component tiếp nhận riêng và đổi nhãn phần xác nhận cũ thành **Xác nhận nghiệp vụ**. |
| `apps/web/src/features/incident-response/IncidentSupport.tsx` | Chỉ render dữ liệu khi query thành công. Khi refetch lỗi, lỗi và nút **Thử lại** vẫn hiện. |
| `apps/web/src/features/incident-response/IncidentSupport.test.tsx` | Thêm hồi quy thành công → lỗi có cache → thử lại thành công, giữ test gọi và sao chép cũ. |
| `apps/web/src/lib/push-service-worker.test.ts` | Thêm độ phủ payload chi tiết và route lịch sử, giữ các trường hợp payload cũ và URL ngoài origin. |
| `docs/BAO_CAO_THAY_DOI_MVP.md` | Ghi kết quả, ảnh hưởng và cách ghép đợt này. |
| `docs/HUONG_DAN_SU_DUNG_MVP_A_Z.md` | Cập nhật quyền, cấu hình và demo sự cố tới tiếp nhận. |

### API, quyền và dữ liệu Mục 7

Các endpoint dùng tiền tố `/api/v1`, cookie phiên và header ghi hiện có. Không thay schema API subscription, sự cố hoặc xác nhận nghiệp vụ cũ.

| API | Quyền và hành vi |
| --- | --- |
| `GET/PUT /push/preferences` | Đọc/ghi tùy chọn `{show_details: boolean}` của chính tài khoản. Mặc định tắt, dùng trên các phiên đang đăng ký. |
| `GET /alerts/delivery-history` | Mỗi tài khoản chỉ xem Web Push của mình. Admin còn xem Telegram chung. Lọc `condition`, `channel`, `device_id`, `status`, `from`, `to`; `cursor` giảm dần, `limit` tối đa 50; `to` không bao gồm điểm cuối. |
| `GET /alerts/incidents/:id/receipts` | Người có quyền xem sự cố thấy điều kiện và xác nhận của mình. Operator/admin có thêm danh sách theo sự cố, dùng `after` và `meta.next_cursor`. |
| `POST /alerts/incidents/:id/receipts` | Phiên hoạt động thuộc tài khoản đã được xếp gửi Push hoặc có cảnh báo Telegram chung. Body rỗng hoặc `{}`; tài khoản lấy từ phiên. Trả lại lần đầu nếu gửi lặp. |

- `alert_deliveries` lưu trạng thái của mỗi job theo `(channel, job_id)`, ID tài khoản đích nếu có, tên thiết bị và vị trí lúc tạo. `alert_delivery_attempts` lưu lần thử theo số thứ tự. `alert_receipts` khóa chính theo `(incident_id, user_id)`. Bảng lịch sử không phụ thuộc khóa ngoại phiên/subscription và không lưu endpoint, hash endpoint, token, khóa hoặc toàn bộ nội dung tin.
- Trigger đồng bộ nguyên giao dịch từ hàng đợi hiện có. Chỉ các hàng đợi đó được worker đọc để gửi. Vẫn dùng unique key sự cố–mức độ–đích của từng kênh, lease 30 giây, giới hạn tám lần, retry và thời hạn hiện có. Lease cũ mất kết quả được ghi “Chưa rõ”. Nếu thiết bị nhận qua dịch vụ nhưng kết nối đứt trước phản hồi, retry vẫn có thể tạo thông báo trùng. Stable tag/topic Push tiếp tục được giữ.
- Nếu subscription bị thu hồi khi job chưa hoàn thành, lịch sử ghi bỏ qua. Nếu worker đã gọi provider và nhận được kết quả sau khi job bị cascade, chỉ lần thử liên quan được cập nhật. Tài khoản đăng nhập lại vẫn thấy lịch sử cá nhân. Một lượt đã được dịch vụ chấp nhận không suy ra người dùng đã nhận.
- Snapshot ưu tiên tên khu vực/phòng theo liên kết lúc enqueue, fallback `Device.location` khi chưa gán. Các job cũ còn tồn tại được sao chép trạng thái, không suy đoán snapshot hay từng lần thử trước migration. Telegram cũ có thể dùng vị trí hiện tại với nhãn rõ. Những job Push đã cascade trước migration không thể khôi phục.
- Telegram dùng đích workspace hiện có. Với origin HTTPS chuẩn, nội dung có link tới đúng sự cố. Origin HTTP local chạy tương thích và phần link HTTPS được bỏ qua. Push mặc định giữ payload cũ. Khi đã bật chi tiết, worker kiểm tra lại tùy chọn và phiên trước mỗi lần gửi. Một gói đã được dịch vụ nhận có thể đến sau đăng xuất.
- Tài khoản đã được nhắm theo chính sách enqueue có thể xác nhận kể cả khi lượt gửi lỗi hoặc chưa tới provider. Với Telegram chung, quyền căn cứ phiên web và sự cố có job Telegram, không ánh xạ người dùng trong nhóm. Chỉ API tiếp nhận ghi receipt, với `ON CONFLICT DO NOTHING`. Xác nhận sau khi sự cố kết thúc có cờ muộn; không tác động acknowledgement, sự cố, sự kiện hoặc còi.
- Các trường thời gian API dùng ISO/UTC. Giao diện lịch sử diễn giải bộ lọc theo giờ máy. Mục 6, lịch bản tin, quiet hours, biến động, mất/kết nối lại, callback Telegram, chuyển cấp và gọi tự động chưa thuộc đợt này. Kênh tắt hoặc không tìm được người nhận ở bước enqueue vẫn theo hành vi cũ, không tạo job nhận.
- Không thêm dependency hoặc biến cấu hình bắt buộc. Script demo/test dùng biến tùy chọn `TEST_ALERT_DELIVERY_DATABASE_URL` cho PostgreSQL riêng.

### Kiểm tra Mục 7

| Kiểm tra | Kết quả |
| --- | --- |
| SHA-256 thư mục và ZIP trước sửa, so manifest sau sửa | Pass. 156 file mốc khớp ZIP. Rà file thêm/sửa và không xóa file. |
| `Code.exe <temp>/check.cjs <typescript.js> <project>` với Node 24.22.1 trong VS Code | Pass. Kiểm tra cú pháp 22 file TS/TSX/JS và kiểu strict riêng contract bằng TypeScript 6.0.3, Zod 4.6.5 từ cache. |
| Bộ kiểm tra độc lập với mock trong script trên | Pass. Formatter Telegram dùng URL HTTPS, snapshot và fallback cũ. Ba test service worker chạy bằng Node VM và bộ assertion thay cho Vitest. React render của component danh bạ với mock trạng thái Query đã kiểm tra thành công → refetch lỗi còn cache → thử lại thành công. |
| `npm ci`, `npm run db:generate`, `npm run db:migrate`, `npm run typecheck`, `npm run lint`, `npm run build` | Chưa chạy. Máy thiếu npm/Node độc lập trong PATH, dependencies, PostgreSQL và `.env`. Kết nối registry bằng `curl.exe -I --connect-timeout 5 https://registry.npmjs.org/typescript` thất bại. |
| `npm test -- apps/api/tests/alert-delivery-history.test.ts apps/web/src/features/incident-response/IncidentSupport.test.tsx apps/web/src/lib/push-service-worker.test.ts` | Chưa chạy bằng Vitest. Chưa kiểm chứng migration, trigger, đồng thời thật, UI trình duyệt và vòng demo simulator với PostgreSQL. |
| Test hồi quy Telegram/Push cũ và kiểm thử nhận tin thật | Chưa chạy bộ Vitest. Không gửi tin tới dịch vụ hoặc người thật trong đợt này. |

### Ghép, triển khai và rollback Mục 7

1. Ghép file contract, schema và thư mục migration mới sau migration Mục 5/8. Dùng database thử riêng để kiểm chứng nạp job cũ, kết quả lease/retry và dữ liệu còn sau cascade.
2. Ghép module API, đăng ký router, hai điểm worker và origin từ runtime. Ghép frontend, service worker, test và tài liệu. Tạo lại Prisma client trước build.
3. Trước migrate database đang phục vụ, dừng API và worker để tránh xung đột khóa trong khi nạp lịch sử và cài trigger. Migrate, triển khai đồng bộ API/web mới rồi kiểm tra job đang chờ. Bản ghi lịch sử không làm job đã gửi phát lại.
4. Để tắt gửi khi cần, dùng cờ Telegram/Web Push hiện có và khởi động lại API. Nếu rollback code sau khi migrate, giữ ba bảng, cột và trigger. Worker cũ tiếp tục dùng bảng cũ và trigger vẫn ghi dấu vết, nhưng bản cũ không hỗ trợ opt-in chi tiết, receipt UI hay lịch sử web. Kiểm tra tương thích trên môi trường thử trước khi rollback production.

### Check2 — Sửa kiểm tra quyền gửi Mục 7

Đối chiếu SHA-256 của 168 file trước sửa với ZIP check2. Tất cả khớp. Đợt này không cần migration hay dependency mới.

| File | Thay đổi |
| --- | --- |
| `apps/api/src/modules/notifications.ts` | Sau khi chuẩn bị nội dung Telegram, đọc lại job đang gửi bằng đúng token rồi lấy giờ mới. Job hết hạn chỉ được đánh dấu hết hạn khi lease còn hiệu lực. Ghi kết quả gửi cũng yêu cầu lease còn hiệu lực. |
| `apps/api/src/modules/web-push.ts` | Lấy cả hạn job và hạn lease trong truy vấn kiểm tra cuối, so giờ sau khi truy vấn xong. Giữ các điều kiện phiên, đăng ký, VAPID, mô phỏng và quyền riêng tư. Chỉ worker còn lease ghi kết quả vào hàng đợi. Nếu job bị cascade trong lúc gửi, chỉ ghi lịch sử lần thử khớp trong thời hạn lease ban đầu. |
| `apps/api/tests/alert-delivery-history.test.ts` | Thêm `X-Requested-With: AirGuard` vào POST kỳ vọng 401. Request vẫn không có phiên, và middleware CSRF giữ nguyên. |
| `apps/api/tests/delivery-send-guard.test.ts` | Test mới với đồng hồ, database và transport giả. Bao phủ hết hạn trong lần đọc cuối ở cả hai kênh, Telegram bị đổi token, Web Push bị thu hồi hoặc hết hạn phiên, và lease hết hạn lúc transport trả kết quả. |
| `docs/BAO_CAO_THAY_DOI_MVP.md` | Ghi phạm vi và kết quả kiểm tra đợt sửa. |

| Kiểm tra | Kết quả |
| --- | --- |
| `Code.exe <temp>/check.cjs <typescript.js> <project>` với Node tích hợp của VS Code | Qua kiểm tra cú pháp TypeScript. Cả 7 ca trong `delivery-send-guard.test.ts` qua khi chạy bằng Node với lớp thay thế tối thiểu cho Vitest. Transport thật không được gọi. |
| `npm test -- apps/api/tests/delivery-send-guard.test.ts apps/api/tests/alert-delivery-history.test.ts apps/api/tests/telegram.test.ts apps/api/tests/web-push.test.ts` | Chưa chạy bằng Vitest. Chưa chạy test API 401 hay các test PostgreSQL trên database thật. |
| `npm run typecheck`, `npm run lint`, `npm run build` | Chưa chạy vì môi trường thiếu npm và dependencies. PostgreSQL và `.env` cũng chưa có. |

Khi ghép, lấy hai thay đổi worker, hai file test và phần báo cáo này. Mục 6 và việc dọn cấu trúc để lượt sau.

## Lượt Mục 6 — Thông báo môi trường và kết nối

### File mới và điểm tích hợp

| File mới | Công việc |
| --- | --- |
| `packages/contracts/src/environment.ts` | Validation chính sách, DTO cài đặt/lịch sử và payload Push v3. |
| `packages/database/prisma/migrations/202611180003_environment_notifications/migration.sql` | Tạo cấu hình, checkpoint theo thiết bị và hàng đợi bền vững cho tin thường. |
| `apps/api/src/modules/environment/policy.ts` | Tính lịch và giờ yên lặng, quyền nhận, khóa chính sách. |
| `apps/api/src/modules/environment/scheduler.ts` | Tổng hợp DHT, biến động, đọc lịch sử kết nối và ghi job cùng checkpoint. |
| `apps/api/src/modules/environment/delivery.ts` | Claim, kiểm tra trước gửi/retry, gọi transport được truyền vào và ghi lịch sử từng lần thử. |
| `apps/api/src/modules/environment/routes.ts` | Cài đặt theo kênh, tình trạng kênh, lịch tiếp theo và lịch sử theo người xem. |
| `apps/api/tests/environment-notifications.test.ts` | Test đồng hồ giả, hai cửa sổ dữ liệu, lịch, restart và test PostgreSQL về quyền, hai lượt scheduler, kết nối/giờ yên lặng. |
| `apps/web/src/features/notification-center/EnvironmentSettingsPage.tsx` | Form kênh, thiết bị, lịch, quiet hours, biến động và kết nối. |
| `apps/web/src/features/notification-center/EnvironmentHistory.tsx` | Tab tin thường, dùng bố cục/trạng thái lịch sử Mục 7 và bộ lọc riêng. |

| File cũ đã sửa | Vì sao cần tích hợp |
| --- | --- |
| `packages/contracts/src/index.ts` | Thêm export tại entry point dùng chung. |
| `packages/database/prisma/schema.prisma` | Prisma cần thêm ba model để truy vấn các bảng mới. |
| `apps/api/src/app.ts` | Nối router sau xác thực/CSRF và truyền tình trạng kênh đã cấu hình. |
| `apps/api/src/runtime.ts` | Gắn scheduler với vòng đời server, đưa cùng transport vào hai worker hiện có và đóng scheduler khi dừng. |
| `apps/api/src/modules/notifications.ts` | Cổng kiểm tra quiet hours chỉ khi có chính sách mới và gửi tin thường khi không lấy được job sự cố. |
| `apps/api/src/modules/web-push.ts` | Cổng quiet hours theo người dùng và lượt gửi tin thường sau cảnh báo. Giữ guard hết hạn, token, phiên và quyền riêng tư của Mục 7. |
| `apps/api/src/modules/web-push-client.ts` | Transport nhận payload tin thường có ID riêng và mức ưu tiên thường. Topic/urgency cảnh báo cũ giữ nguyên. |
| `apps/api/tests/web-push-client.test.ts` | Kiểm tra topic ổn định của tin thường và độ ưu tiên/định dạng cảnh báo cũ. |
| `apps/web/public/push-sw.js` | Xử lý payload v3, link cố định tới tab môi trường và tag riêng. Payload cảnh báo cũ vẫn xử lý theo nhánh cũ. |
| `apps/web/src/lib/push-service-worker.test.ts` | Thêm ca payload thường và điều hướng. Giữ ba ca Mục 7. |
| `apps/web/src/App.tsx` | Đăng ký route cài đặt trong app đã đăng nhập. |
| `apps/web/src/pages/SettingsPage.tsx` | Thêm link tới route cài đặt. |
| `apps/web/src/features/notification-center/DeliveryHistoryPage.tsx` | Tab phân biệt sự cố và tin thường trong lịch sử. Giữ endpoint Mục 7. |
| `apps/web/src/features/notification-center/styles.css` | Bố cục responsive có selector riêng cho form. |
| `tools/operations/mock-alert-delivery.ts` | Chế độ `--environment` trên demo loopback, dùng chung bộ điều phối và transport giả. |
| `docs/BAO_CAO_THAY_DOI_MVP.md`, `docs/HUONG_DAN_SU_DUNG_MVP_A_Z.md` | Bàn giao kết quả, quyền, cấu hình, kiểm tra và demo. |

### API và chính sách

- `GET/PUT /api/v1/environment/settings/webpush` cho tài khoản đang đăng nhập. Mỗi tài khoản lưu một cấu hình với tối đa 20 thiết bị. Quyền nhận yêu cầu subscription còn hạn, tài khoản hoạt động, khớp VAPID và opt-in simulator tại cả hai chỗ khi dùng dữ liệu mô phỏng.
- `GET/PUT /api/v1/environment/settings/telegram` chỉ admin. Đây là cấu hình workspace dùng đích Telegram trên backend. Không trả token hoặc chat ID. Server cũng phải bật nhận simulator nếu cần.
- `GET /api/v1/environment/history` lọc `kind`, `channel`, `status`, `device_id`, `from`, `to` và `cursor` (giảm dần, tối đa 50 dòng/trang). Tài khoản xem lịch sử Push của mình. Admin xem thêm Telegram chung. Job có UUID riêng, không liên kết sự cố và không tạo xác nhận tiếp nhận. Lịch sử giữ qua logout/xóa subscription, không lưu đích mạng hoặc khóa. Nhiều trình duyệt có lượt gửi riêng, còn xác nhận sự cố Mục 7 vẫn tính theo một người.
- Migration thêm `EnvironmentPolicy`, `EnvironmentDeviceState`, `EnvironmentDelivery`. Tin lưu tên/vị trí lúc tạo, ưu tiên khu vực/phòng và fallback `Device.location`. Lần gửi tách theo đích và số lần thử; ID theo khung giờ hoặc sự kiện kết nối. Unique key policy–thiết bị–loại–sự kiện–đích chặn enqueue trùng. Dữ liệu Mục 7 và queue đang chờ giữ nguyên khi chưa opt-in.
- Bản tin lặp **5/15/30/60/180/360/720/1440 phút** từ lúc bật cho thiết bị. Chu kỳ là phút thực, mốc UTC. Múi giờ IANA mặc định `Asia/Ho_Chi_Minh` dùng để hiển thị mốc và tính giờ yên lặng. Lần chạy trễ chỉ xem slot gần nhất, tối đa 15 phút trễ. Cửa sổ mẫu từ 5–1440 phút trước slot. Từ ba mẫu hợp lệ mới báo min/max/TB nhiệt độ và độ ẩm. Nếu thiếu thì hiện lượng mẫu hợp lệ và thiếu dữ liệu.
- Biến động dùng N phút liền kề trước và N phút gần nhất, theo phút UTC đã kết thúc. Mỗi phút ở cả hai cửa sổ cần ít nhất một mẫu hợp lệ. So trung bình mỗi phút gần nhất với trung bình có trọng số mẫu của cửa sổ trước. Chỉ báo nếu từng phút gần nhất vượt cùng một chiều so với ngưỡng đã chọn. Độ ẩm dùng điểm %RH. Cooldown tính từ lúc tạo thông báo. Dữ liệu theo `sampled_at` đã đồng bộ, chất lượng DHT hợp lệ, tuổi cảm biến và độ trễ lúc nhận không vượt max(120 giây, 3 chu kỳ thiết bị). Thiếu mẫu không suy ra trạng thái bình thường.
- Lần bật đầu ghi mốc hiện tại, bỏ qua lịch sử kết nối cũ. Scheduler đọc `DeviceStatusHistory` theo cursor từng thiết bị. Chỉ báo mất kết nối sau khoảng chờ và cooldown, không báo nếu phục hồi trước khi gửi. Mỗi lượt báo phục hồi gắn với lượt báo mất đã được dịch vụ chấp nhận ở cùng đích. Nếu lượt mất đang thử, lượt phục hồi đợi kết quả. Retry kiểm tra lại trạng thái và ID của lần chuyển offline.
- Giờ yên lặng là khoảng bắt đầu bao gồm, kết thúc loại trừ. Qua nửa đêm được hỗ trợ. Tin mới thay thế bản tin/biến động cũ vẫn đang chờ, và các tin hết hạn được loại. Bản tin hết hạn ở slot tiếp theo, biến động hết hạn sau N phút, lượt mất/phục hồi có thời hạn tối đa 48 giờ. Tin phục hồi chỉ tồn tại cho lần mất được chấp nhận nên giữ được cặp. Người dùng có thể áp dụng quiet hours vào hàng cảnh báo cũ của kênh và chọn bỏ qua với `critical`. Lựa chọn này không thay đổi chế độ Không làm phiền của hệ điều hành.
- Scheduler chạy mỗi 15 giây trong backend. Khóa advisory theo chính sách, cursor và enqueue cùng giao dịch. Hai worker cũ ưu tiên claim cảnh báo sự cố trước. Lượt thường dùng lease 30 giây, ghi tối đa tám lần thử với backoff và kiểm tra lại cấu hình/đích/lease sát lúc gửi. Lượt cũ bị mất lease ghi kết quả chưa rõ. Provider có thể đã nhận khi phản hồi bị gián đoạn, nên retry vẫn có khả năng trùng ngoài hệ thống. Push v3 mặc định chỉ hiện tin chung, chi tiết giữ tùy chọn Mục 7.
- Không có dependency hoặc biến cấu hình chạy mới. `TEST_ENVIRONMENT_DATABASE_URL` chỉ dùng bộ kiểm tra PostgreSQL. Telegram callback, chuyển cấp và gọi tự động vẫn ngoài phạm vi.

### Kiểm chứng, ghép và rollback

| Kiểm tra | Kết quả |
| --- | --- |
| `Code.exe <temp>/check.cjs <typescript.js> <project>` với Node từ VS Code, TypeScript 6.0.3 và Zod 4.6.5 cache | Kiểm tra cú pháp TS/TSX/JS và kiểu strict contract mới đã qua. Chạy 5 ca Mục 6, 7 ca guard Mục 7, 4 ca service worker và 7 ca transport bằng Node với bộ giả lập test/mocks. Cả 23 ca qua, không gọi transport thật. |
| `npm test -- apps/api/tests/environment-notifications.test.ts apps/api/tests/delivery-send-guard.test.ts apps/api/tests/alert-delivery-history.test.ts apps/web/src/lib/push-service-worker.test.ts` | Chưa chạy bằng Vitest. Chưa chạy migration, test quyền và giao dịch/cursor bằng PostgreSQL thật hay demo qua trình duyệt. |
| `npm ci`, `npm run db:generate`, `npm run db:migrate`, `npm run typecheck`, `npm run lint`, `npm run build` | Chưa chạy vì máy thiếu npm/dependencies, PostgreSQL và `.env`. Không suy ra build hay migration đã qua từ kiểm tra độc lập. |

Ghép contract, schema và migration sau Mục 7 đã sửa check2. Sau đó ghép module API, các hook tùy chọn của worker, route/UI và service worker. Áp dụng migration trên database thử, chạy test Mục 6 và hồi quy Mục 7 rồi demo theo hướng dẫn.

Để tắt riêng tin thường, tắt thông báo ở từng chính sách. Nếu muốn bỏ ảnh hưởng lên sự cố, tắt cả tùy chọn áp dụng giờ yên lặng cho sự cố. Các cờ backend hiện có tắt gửi cho toàn kênh. Khi rollback code, giữ migration và dữ liệu. Bản trước không đọc hàng tin thường và không áp dụng chính sách quiet hours mới. Một số job sự cố đã hoãn giữ lịch `next_attempt_at` đã ghi khi quay về bản trước. Khi triển khai lại, checkpoint và unique key giữ hành vi chống trùng. Tránh dùng rollback phá hủy database.

### Check3 — Sửa ba lỗi Mục 6

Đối chiếu SHA-256 của 178 file trước sửa với ZIP check3. Tất cả khớp. Lượt sửa dùng schema, API, mã trạng thái lịch sử và worker Mục 7 hiện có. Không có file mới hay migration mới.

| Lỗi và nguyên nhân | Thay đổi |
| --- | --- |
| Cửa sổ biến động được đánh dấu đã xét ngay lúc kết thúc, nên mẫu hợp lệ đến sau lần quét đầu bị bỏ sót. | `apps/api/src/modules/environment/scheduler.ts` chốt cửa sổ sau khoảng nhận mẫu hiện có, bằng max(120 giây, 3 chu kỳ gửi). Chỉ xét cửa sổ đã chốt gần nhất, giữ bộ lọc DHT, checkpoint, khóa giao dịch và khóa chống trùng theo mốc UTC. Hạn gửi biến động vẫn là N phút, nay tính từ mốc chốt để khoảng chờ không rút ngắn thời gian gửi. Không phát lại các cửa sổ đã chốt bằng bản trước. |
| Bộ đếm và nhật ký ghi lượt thử trước khi đọc lại chính sách, đích và lease. Nếu vừa vào giờ yên lặng, lượt thứ 8 bị ghi dù transport chưa được gọi. | `apps/api/src/modules/environment/delivery.ts` chỉ ghi lượt thử sau các kiểm tra cuối, với điều kiện cập nhật theo token, trạng thái, lease và hạn gửi. Hoãn do giờ yên lặng giữ nguyên bộ đếm và lịch sử lần thử. |
| Tin phục hồi chỉ kiểm tra tin mất kết nối đã gửi, nên vẫn có thể gửi khi thiết bị đã đổi trạng thái lần nữa. | Cùng file `delivery.ts`, trước khi gọi transport so cả trạng thái online và ID sự kiện mới nhất với ID của job. Tin cũ bị bỏ qua với mã `SUPERSEDED` có sẵn. |

`apps/api/tests/environment-notifications.test.ts` kiểm tra mẫu cuối đến trễ 20 giây, quét lại và khởi động lại, job giữ 7 lượt rồi gửi được ở lượt 8, tin phục hồi bị thay bởi sự kiện offline hoặc online mới hơn, và tin phục hồi còn hiệu lực chỉ gửi một lần. Suite PostgreSQL hiện có cũng thêm tình huống mẫu đến trễ và tạo/hủy tin phục hồi qua lịch sử kết nối thực. `docs/HUONG_DAN_SU_DUNG_MVP_A_Z.md` chỉ bổ sung thông tin người dùng cần biết về khoảng chờ và tin phục hồi đã cũ. Báo cáo này ghi phạm vi ghép và kiểm tra.

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| `Code.exe <temp>/check.cjs <typescript.js> <project>` với Node của VS Code và test runner thay thế tối thiểu | Qua kiểm tra cú pháp ba file TypeScript đã sửa và **28 ca** độc lập, gồm 10 ca Mục 6, 7 ca bảo vệ gửi Mục 7 và 11 ca service worker/transport. Dùng đồng hồ, database hoặc transport giả. |
| `Code.exe <temp>/baseline.cjs <typescript.js> <project>` với hai module lấy từ ZIP check3 | Bốn ca hồi quy thất bại đúng dự kiến trên bản trước sửa và đều qua trên bản mới. |
| `npm test -- apps/api/tests/environment-notifications.test.ts apps/api/tests/delivery-send-guard.test.ts` | Chưa chạy bằng Vitest. Suite tích hợp Mục 6 với PostgreSQL riêng chưa chạy. |
| `npm run build`, typecheck toàn dự án và migration | Chưa chạy. Môi trường thiếu npm, dependencies, PostgreSQL và `.env`. Ba lỗi không cần migration mới. |

Ghép hai module, file test và hai đoạn tài liệu. Việc gom giao diện hoặc thêm demo để lượt riêng.

### Check4 — Kiểm tra đồng hồ sau khi ghi lượt thử

Đối chiếu 178 file với ZIP check4 trước sửa. Chỉ thay đổi hai file TypeScript và báo cáo này.

| File | Thay đổi |
| --- | --- |
| `apps/api/src/modules/environment/delivery.ts` | Lần ghi lượt thử có thể hoàn tất sau khi job hết hạn hoặc vừa vào giờ yên lặng. Worker đọc lại giờ sau lần ghi, trước transport. Nếu hết hạn, hoàn tác lượt chưa gửi và đánh dấu `expired`. Nếu vào giờ yên lặng, hoàn tác lượt đó và trả `pending` với `QUIET_HOURS`, hẹn mốc sớm hơn giữa giờ kết thúc yên lặng và hạn gửi. Hoàn tác giảm bộ đếm và khôi phục lịch sử trong cùng cập nhật, có điều kiện theo token, trạng thái, lease còn hiệu lực và đúng hạn lease đã đọc, cùng số lượt thử vừa ghi. Mất lease thì thoát. |
| `apps/api/tests/environment-notifications.test.ts` | Hai ca dùng đồng hồ giả ngay trong `updateMany` ghi lượt thử. Cả hai xác nhận 0 lần gọi transport tại mốc chặn. Ca giờ yên lặng giữ nguyên 7 lượt và gửi được lượt 8 sau khi hết giờ. |
| `docs/BAO_CAO_THAY_DOI_MVP.md` | Ghi phạm vi và kết quả kiểm tra. |

| Kiểm tra | Kết quả thực tế |
| --- | --- |
| `Code.exe <temp>/check.cjs <typescript.js> <project>` với Node từ VS Code và runner thay thế tối thiểu | Kiểm tra cú pháp hai file TypeScript và **30 ca** độc lập đều qua. Gồm hai ca mới và 7 ca bảo vệ gửi Mục 7. Dùng database, đồng hồ hoặc transport giả. |
| `Code.exe <temp>/baseline.cjs <typescript.js> <project>` với `delivery.ts` từ ZIP check4 | Hai ca mới thất bại đúng dự kiến trên check4 và qua trên bản sửa. |
| `npm test -- apps/api/tests/environment-notifications.test.ts apps/api/tests/delivery-send-guard.test.ts` và `npm run build` | Chưa chạy bằng Vitest hoặc build đầy đủ vì thiếu npm và dependencies. Suite PostgreSQL chưa chạy do thiếu PostgreSQL và cấu hình database thử. |

API, migration, giao diện và cơ chế gửi cảnh báo Mục 7 giữ nguyên.

## MVP sơ đồ khu vực và phòng — 19/11/2026

Sơ đồ nằm trên `/app/spaces`. Hai trang Thiết bị và Giám sát trực tiếp vẫn là nơi đăng ký thiết bị và xem dữ liệu cảm biến. Không tìm thấy ảnh `Sơ đồ cảm biến theo phòng.png` trong workspace. Bố cục dùng lưới phòng với bảng chi tiết bên cạnh.

| File mới | Vai trò |
| --- | --- |
| `packages/database/prisma/migrations/202611190001_room_map_positions/migration.sql` | Cặp tọa độ nullable trên gán phòng và ngưỡng hiển thị riêng theo khu vực. |
| `apps/api/src/modules/monitoring-spaces/room-map.ts` | Đọc sơ đồ có dữ liệu theo thiết bị. Admin lưu vị trí hoặc ngưỡng. |
| `apps/api/tests/room-map.test.ts` | Test PostgreSQL hai phòng và ba thiết bị, độ bền tọa độ, đổi/bỏ gán, phân quyền, lưu trữ và sự cố khi offline. |
| `apps/web/src/features/monitoring-spaces/RoomMap.tsx` | Khung phòng, điểm, chế độ đặt vị trí, chi tiết và cấu hình ngưỡng. |
| `apps/web/src/features/monitoring-spaces/room-map.css` | Bố cục sơ đồ và điểm tương đối trên desktop/mobile. |
| `apps/web/src/features/monitoring-spaces/map-status.ts` | Quy tắc màu theo sự cố, kết nối, độ mới và ngưỡng hiển thị. |
| `apps/web/src/features/monitoring-spaces/map-status.test.ts` | Kiểm tra màu độc lập cho từng thiết bị và mẫu tại ngưỡng, hết hạn hoặc mất kết nối. |

| File cũ | Vì sao sửa |
| --- | --- |
| `packages/contracts/src/monitoring-spaces.ts` | Thêm DTO và validation cho ba API sơ đồ. |
| `packages/database/prisma/schema.prisma` | Ánh xạ cột tọa độ và ngưỡng để generate Prisma Client. |
| `apps/api/src/modules/monitoring-spaces/routes.ts` | Đăng ký API sơ đồ và xóa tọa độ khi gán sang phòng khác trong cùng giao dịch. Bỏ gán xóa cả liên kết. |
| `apps/api/src/modules/telemetry.ts` | Cho sơ đồ chọn thiết bị theo khu vực, dùng lại logic mẫu mới nhất và trạng thái kết nối. Giữ bộ lọc và giới hạn của các caller cũ. |
| `apps/web/src/features/monitoring-spaces/DeviceAssignments.tsx` | Tách thiết bị chưa gán và đã gán, chọn phòng mới rồi Lưu/Hủy. |
| `apps/web/src/features/monitoring-spaces/MonitoringSpacesPage.tsx` | Gắn sơ đồ, giữ thao tác quản lý và làm mới dữ liệu khi đổi khu vực/phòng/gán. |
| `apps/web/src/App.tsx` | Dùng luồng Socket.IO hiện tại để cập nhật sơ đồ theo sự kiện thiết bị, mẫu đo và sự cố. |
| `apps/web/src/pages/DevicesPage.tsx` | Sau khi tạo, nhắc thiết bị chưa gán phòng và cung cấp liên kết tới trang sơ đồ. |
| `docs/BAO_CAO_THAY_DOI_MVP.md`, `docs/HUONG_DAN_SU_DUNG_MVP_A_Z.md` | Ghi kết quả và hướng dẫn demo. |

`GET /api/v1/spaces/areas/:id/map` cho mọi tài khoản đăng nhập. `PUT /api/v1/spaces/devices/:id/position` và `PUT /api/v1/spaces/areas/:id/map-thresholds` chỉ dành cho admin. Vị trí dùng x/y trong đoạn 0–1 và xác nhận ID phòng hiện tại. Bản ghi gán cũ giữ phòng và có vị trí null sau migration. Phòng/khu vực lưu trữ vẫn đọc được. Đỏ ưu tiên sự cố chưa kết thúc, độc lập với kết nối. Xám dành cho thiết bị mất kết nối hoặc mẫu DHT không đánh giá được. Vàng/xanh dùng ngưỡng riêng của khu vực và quy tắc DHT còn mới hiện có (15 giây cộng xét tuổi mẫu). Luồng phát sinh sự cố, cấu hình gas và đơn vị ADC giữ nguyên.

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run db:generate`, Prisma `migrate deploy` với PostgreSQL local cổng 5436 | Qua. Áp dụng đủ 9 migrations trên `airguard_room_map_demo_20261119` và `airguard_room_map_test_20261119` riêng. |
| `psql` chạy migration sơ đồ trên bảng tạm chứa dữ liệu kiểu cũ | Qua. Giữ ID phòng cũ và tọa độ null, thêm ngưỡng mặc định, từ chối ghi một tọa độ. Giao dịch kiểm tra đã rollback. |
| `npm test -- apps/api/tests/room-map.test.ts apps/api/tests/monitoring-spaces-support.test.ts apps/web/src/features/monitoring-spaces/map-status.test.ts apps/web/src/lib/freshness.test.ts apps/web/src/App.test.tsx` | Qua 11 test, có test API trên PostgreSQL thật. |
| `npm run build` và ESLint các file TypeScript liên quan | Qua. Rollup cảnh báo cách đặt annotation trong dependency Zod, build vẫn hoàn thành. |
| Chrome/Playwright với web local và mẫu simulator | Qua các luồng gán Lưu/Hủy, bấm để đặt điểm, tải lại, đổi kích thước, trạng thái xanh/vàng theo mẫu, điểm đỏ khi offline còn sự cố và viewer chỉ xem. Sơ đồ vẫn cập nhật khi chặn Socket.IO để kiểm tra REST dự phòng. |

Cổng 4000/5173 đang có tiến trình, nên demo riêng dùng **4400/5273** trên loopback. `tsx` có lỗi Windows `uv_os_get_passwd` trong phiên này. Tạo admin và chạy API bằng shim tạm ngoài dự án. Cấu hình demo và key cảm biến tạm nằm ngoài mã nguồn. Không chạy migration trên database có sẵn của ứng dụng khác.

Chưa thử thiết bị phần cứng, trình duyệt ngoài Chrome hoặc triển khai production. Kiểm tra giao diện dùng dữ liệu mô phỏng, hai kích thước desktop/mobile và tài khoản admin/viewer. API kiểm tra quyền ghi của cả operator và viewer.

## Phát lại kịch bản và banner sự cố · 20/11/2026

| File mới | Nội dung |
| --- | --- |
| `tools/device-simulator/src/replay.ts` | Validation JSON/CSV trước khi phát, xếp mẫu theo offset, chờ pha tạm ngừng và gửi tuần tự. |
| `tools/device-simulator/src/replay.test.ts` | Kiểm tra thứ tự, khoảng tạm ngừng kể cả một lần gửi kéo dài, dữ liệu CSV/JSON lỗi, độ phủ phút và snapshot lửa. |
| `tools/device-simulator/scenarios/environment.json` | 13 phút, nhiệt độ/độ ẩm ổn định rồi tăng và duy trì qua thời gian chốt. |
| `tools/device-simulator/scenarios/connectivity.json` | 3 phút 45 giây, gửi → tạm ngừng → gửi tiếp với cùng ID. |
| `tools/device-simulator/scenarios/incident.json` | 1 phút 35 giây, lửa mô phỏng critical rồi phục hồi. |
| `tools/device-simulator/scenarios/example.csv` | Ví dụ ba mẫu tại offset 0, 5 và 10 giây. |
| `apps/web/src/features/incident-response/IncidentNotices.tsx` | Xác lập mốc thời gian từ API, lấy sự cố mới khi Socket.IO báo cập nhật hoặc đăng ký lại, bỏ trùng theo ID và liên kết trực tiếp tới chi tiết. |
| `apps/web/src/features/incident-response/IncidentNotices.test.tsx` | Kiểm tra loại, mức độ, tên thiết bị, URL, lọc sự cố cũ và chống hiển thị lại sau đóng banner hoặc tải lại. |
| `apps/web/public/manifest.webmanifest` | Định danh ứng dụng, URL mở AirGuard và chế độ standalone. |
| `apps/web/public/airguard-192.png` | Biểu tượng 192×192 cho manifest và màn hình chính iPhone. |
| `apps/web/public/airguard-512.png` | Biểu tượng 512×512 cho manifest. |

| File cũ | Vì sao sửa |
| --- | --- |
| `tools/device-simulator/src/main.ts` | Thêm `--scenario-file`, `--csv`, `--validate-only` và dùng chung client cấu hình, DeviceKey, boot/seq, POST telemetry và retry. |
| `tools/device-simulator/src/payload.ts` | Cho mẫu phát lại đặt giá trị DHT và trạng thái lửa, giữ hai chế độ có sẵn. ADC vẫn thô và trường ppm rỗng. |
| `apps/web/src/App.tsx` | Thay banner chung bằng banner theo từng sự cố. Dùng lại Socket.IO và các điểm làm mới dữ liệu hiện có. |
| `apps/web/src/features/incident-response/IncidentSupport.tsx` | Bỏ liên kết gọi. Danh bạ theo phòng và nút sao chép dùng dữ liệu tải thành công. |
| `apps/web/src/features/incident-response/IncidentSupport.test.tsx` | Kiểm tra sao chép, dự phòng chọn số, ẩn dữ liệu cache sau lỗi và phục hồi khi thử lại. |
| `apps/web/src/features/incident-response/styles.css` | Bỏ CSS liên kết gọi và cho banner xuống dòng trên màn hình hẹp. |
| `apps/web/index.html` | Gắn manifest và biểu tượng Apple Touch. |
| `docs/HUONG_DAN_SU_DUNG_MVP_A_Z.md` | Thêm hướng dẫn PowerShell, API chính, cấu hình Telegram/Push, màn hình chính iPhone và demo ba kịch bản. |
| `docs/BAO_CAO_THAY_DOI_MVP.md` | Ghi phạm vi file và kết quả kiểm tra. |

Simulator dùng `POST /api/v1/device/telemetry`. Banner dùng `GET /api/v1/alerts/incidents` và sự kiện `alert.event.created`, với `first_observed_at` để nhận biết dữ liệu mới theo thời gian server. Trang chi tiết sử dụng tiếp nhận đã có. Thay đổi không cần migration mới. Bộ gửi Telegram/Web Push, hàng đợi, lịch sử, bộ lọc Simulator, quyền riêng tư và `push-sw.js` tiếp tục dùng các module hiện có.

### Kiểm tra tự động và demo local

| Kiểm tra | Kết quả |
| --- | --- |
| `npm.cmd run build` và ESLint các file TypeScript/TSX sửa trong lượt này | Qua. Build có cảnh báo annotation từ Rollup/Zod. |
| Prisma `migrate deploy` trên PostgreSQL 18.7 cổng 5436 | Qua đủ 9 migration có sẵn trên database demo và các database test tách riêng. |
| Vitest với các suite simulator, Socket.IO, Origin, sự cố, môi trường, lịch sử gửi, transport Telegram/Web Push, bảo vệ gửi, banner, danh bạ và service worker | **81 test qua trên 18 file**. Các ca tích hợp đã kết nối PostgreSQL test. Dịch vụ gửi trong test dùng mock. |
| CLI PowerShell với `--validate-only` | Qua cả ba JSON và CSV mẫu. Lần lượt báo 156, 15, 19 và 3 mẫu. Test trình phân tích kiểm tra dữ liệu lỗi, offset trùng/đảo thứ tự và giữ đủ thời gian pause khi một lượt gửi kéo dài. |
| Phát đủ 13 phút dữ liệu môi trường qua API chính và scheduler | Qua 156 mẫu. Lịch sử có bản tin đầu ổn định với 60 mẫu và một tin biến động tăng 10 °C / 16 điểm %RH sau chốt cửa sổ. Transport giả chấp nhận. |
| Phát kết nối qua API chính và scheduler | Qua 15 mẫu. Lịch sử ghi một lượt **Mất kết nối** và một lượt **Kết nối lại** cho cùng thiết bị trong bài kiểm tra, với transport giả. Hai kịch bản môi trường/kết nối không tạo sự cố. |
| Phát sự cố và CSV qua API chính, kiểm tra Chrome/Playwright | CSV gửi 3 mẫu. Kịch bản sự cố tạo một sự cố lửa critical với 19 mẫu, một lượt Telegram giả và banner dẫn đúng ID. Đã xác nhận tiếp nhận khi sự cố đang mở, thấy sự cố kết thúc sau mẫu phục hồi. Banner vừa khung mobile và không hiện lại khi reconnect, refetch hoặc tải lại. Manifest, hai icon và `push-sw.js` tải được. |

API chính và Vite chạy trên cổng local riêng **4401/5274**, với PostgreSQL demo và transport Telegram giả. Môi trường PowerShell/Node gặp lỗi `uv_os_get_passwd ENOMEM` khi chạy trực tiếp CLI `tsx`. Thực hiện các lần chạy lại với một shim tạm ngoài dự án cho lỗi này. Các tập lệnh và biến môi trường thử nghiệm nằm ngoài mã nguồn.

### Xác minh nhận cảnh báo thật · 20/11/2026

Người dùng xác nhận đã thấy cùng một cảnh báo lửa mô phỏng mức **CRITICAL** trong nhóm Telegram thử và trong thông báo Windows qua Microsoft Edge. Ảnh cho thấy tên thiết bị và vị trí lúc tạo thông báo. Đối chiếu PostgreSQL theo ID sự cố `0da77942-a0b2-4986-9c7f-3a601595d48e` cho thấy Telegram và Web Push đều có trạng thái `sent`, mỗi kênh thực hiện một lượt gửi.

Tại thời điểm đối chiếu, sự cố còn mở và chưa có bản ghi tiếp nhận cho lượt thử thật này. Việc cài và nhận Push trên iPhone, cũng như nhận tin môi trường/kết nối qua các đích thật, còn cần xác minh. Bảng kiểm tra tự động và demo local ở trên ghi các lượt dùng transport giả.

## Demo bốn thiết bị và điều hướng xử lý sự cố · 20/11/2026

Tạo bốn Simulator và hai phòng demo. Admin gán phòng và lưu điểm trên web. Kịch bản Gas tạo một WARNING độc lập với CRITICAL lửa. Điều hướng từ điểm trên sơ đồ tới chi tiết thiết bị và danh sách sự cố mang bộ lọc `device_id` trong URL. Banner và đầu trang sự cố đọc vị trí hiện tại theo ID sự cố. Lịch sử gửi giữ phòng tại lúc tạo tin. Nút tiếp nhận ở đầu trang, dưới đó có lượt gửi của đúng sự cố, người đã tiếp nhận theo quyền và danh bạ hỗ trợ.

### File mới

| File | Nội dung |
| --- | --- |
| `tools/device-simulator/scenarios/gas-warning.json` | Một pha Gas WARNING mô phỏng và một pha phục hồi. |
| `tools/device-simulator/scenarios/run-demo.ps1` | Chuẩn bị qua API admin, lưu thông tin thiết bị local và chạy một hoặc bốn simulator đồng thời. |
| `apps/api/tests/multi-device-demo.test.ts` | Hai ca tích hợp riêng cho nhiều cảm biến và cho một WARNING tới hai đăng ký Push và Telegram. |
| `apps/web/src/features/notification-center/NotificationSettingsPage.tsx` | Trang **Cài đặt → Thông báo** dùng lại Web Push cá nhân và lịch theo kênh. |
| `apps/web/src/features/incident-response/incident-support.ts` | Dùng chung truy vấn vị trí và cách hiển thị phòng giữa banner, trang chi tiết và danh bạ. |

### File đã sửa

| File | Lý do |
| --- | --- |
| `tools/device-simulator/src/replay.ts`, `tools/device-simulator/src/payload.ts` | Thêm trạng thái `gas` tùy chọn trong JSON, đưa vào snapshot. CSV và các giá trị mặc định tiếp tục hoạt động. |
| `apps/api/src/modules/alert-delivery/routes.ts` | Thêm bộ lọc `incident_id` tùy chọn cho API lịch sử gửi, với phân trang và phạm vi quyền hiện có. |
| `apps/web/src/pages/DeviceDetailPage.tsx`, `apps/web/src/pages/AlertsPage.tsx` | Thêm liên kết xem sự cố của thiết bị và đọc/lưu bộ lọc qua URL. |
| `apps/web/src/pages/IncidentPage.tsx` | Đưa thông tin và hành động tiếp nhận lên đầu. Ghép lịch sử riêng, danh sách tiếp nhận và hỗ trợ vào luồng chi tiết. |
| `apps/web/src/features/incident-response/IncidentNotices.tsx`, `IncidentNotices.test.tsx` | Hiện phòng đã gán theo đúng ID sự cố. Kiểm tra hai banner độc lập, mỗi banner mang đúng thiết bị, phòng và link. |
| `apps/web/src/features/incident-response/IncidentSupport.tsx`, `IncidentReceipt.tsx` | Dùng chung dữ liệu vị trí giữa tiêu đề và danh bạ. Tách thao tác nhận tin khỏi bảng người đã tiếp nhận trong giao diện, dùng cùng truy vấn. |
| `apps/web/src/features/notification-center/DeliveryHistoryPage.tsx` | Dùng lại danh sách và chi tiết retry trong lịch sử chung và lịch sử theo sự cố. |
| `apps/web/src/features/notification-center/EnvironmentHistory.tsx`, `EnvironmentSettingsPage.tsx` | Đổi liên kết vào trung tâm cài đặt và nhúng lịch của từng kênh. Admin có trạng thái và chính sách Telegram chung. |
| `apps/web/src/components/PushSettings.tsx` | Làm mới trạng thái sẵn sàng của lịch sau khi người dùng bật hoặc tắt Push. |
| `apps/web/src/pages/SettingsPage.tsx`, `apps/web/src/App.tsx` | Thêm mục **Thông báo**. Các URL `/app/settings`, `/app/environment-settings`, `/app/notifications` và các link sự cố cũ tiếp tục hoạt động. |
| `docs/HUONG_DAN_SU_DUNG_MVP_A_Z.md`, `docs/BAO_CAO_THAY_DOI_MVP.md` | Bàn giao lệnh, các bước demo và kết quả kiểm tra. |

`GET /api/v1/alerts/delivery-history?incident_id=<uuid>` dùng lại DTO cũ. Admin xem Telegram chung và lịch sử Push của mình. Người dùng khác xem Push của mình. Quyền xem danh sách tiếp nhận giữ theo API hiện tại. Cấu hình Telegram, VAPID và các lần gửi dùng những module có sẵn. Bản này dùng chín migration hiện có. File DeviceKey được tạo ngoài repo trong thư mục tạm của tài khoản Windows. Khi ghép code, lấy API bộ lọc trước hoặc cùng frontend, rồi lấy phần script và hướng dẫn để chạy demo.

### Kiểm tra

| Kiểm tra | Kết quả |
| --- | --- |
| Build, ESLint các file TypeScript/TSX sửa và phân tích cú pháp PowerShell | Qua. Build vẫn có cảnh báo annotation trong dependency Zod/Rollup. |
| Prisma `migrate deploy` trên PostgreSQL cổng 5436 | Qua 9 migration trên các database thử riêng. |
| Vitest với API nhiều thiết bị, sơ đồ, scheduler, Socket.IO, quyền, bảo vệ gửi, lịch sử, worker, banner, PushSettings và simulator | Qua **73 test trên 18 file**. Chạy lại 16 test frontend/simulator sau khi tách phần dùng chung của banner và danh bạ. |
| Hai tình huống trong `multi-device-demo.test.ts` | Qua. Gas và lửa có hai ID, liên kết và vị trí khác nhau. Một WARNING tạo hai lượt Push cho hai đăng ký cùng tài khoản và một lượt Telegram. Một Push lỗi tạm thời rồi được chấp nhận. Hai lần thử vẫn thuộc cùng ID lượt gửi. Transport dùng mock. |
| PowerShell `-Provision` và `-Scenario Gas` | Qua. Kiểm tra bốn DeviceKey trên API bàn giao, bốn thiết bị vẫn chưa gán. Chạy riêng Gas trên môi trường thử với ID/key lấy trực tiếp từ biến môi trường, nhận đủ 20 mẫu, gồm pha phục hồi. |
| Chrome/Playwright desktop 1440 px và màn hình điện thoại 390/360 px | Qua thao tác gán và đặt đủ bốn điểm, luồng Gas từ sơ đồ qua thiết bị tới bộ lọc bền qua tải lại, banner lửa mở đúng phòng/sự cố, tiếp nhận khi đang mở và lịch sử theo ID. Trên khổ 390 px, thao tác chạm từ điểm lửa tới bộ lọc và chi tiết qua đúng phòng B. Trang Thông báo hiện lịch chung cho admin, viewer có Push cá nhân và API Telegram trả 403. URL cài đặt môi trường cũ tải được. |
| PowerShell `-Scenario All` với API thực và scheduler trên database demo | Qua **210/210 mẫu** của bốn tiến trình. Hai sự cố độc lập phục hồi theo từng ID. Thiết bị kết nối chuyển qua offline rồi online và có đúng vị trí phòng B trong hai tin thử. Điểm nhiệt độ từ xanh sang vàng. Scheduler ghi bản tin 26 °C ổn định và biến động +9,4 °C, +15,1 điểm %RH tại phòng A sau khi chốt cửa sổ. |

Browser và telemetry thử dùng API chính cổng 4402, web 5275 cùng database demo riêng. Telegram trả chấp nhận giả và không gọi đích ngoài. Node trong phiên kiểm thử dùng shim tạm ngoài dự án cho lỗi `uv_os_get_passwd ENOMEM`. Kết quả giao diện khổ điện thoại là giả lập viewport. Ca hai trình duyệt và một nhóm xác minh đăng ký và gửi ở mức API/queue, còn việc nhận đồng thời trên hai trình duyệt thật và nhóm Telegram cần kiểm chứng trên đích nhận. Kết quả nhận thật một Edge và một nhóm tại lượt trước vẫn ghi ở mục trên.

## 20/11/2026 — Check5, sơ đồ theo khu vực và vòng đời thông báo

Đối chiếu mã nguồn với ZIP check5, đặc tả ban đầu và bàn giao Mục 11. Đợt này dùng danh sách khu vực làm điểm vào, ưu tiên thao tác trong phòng và gom thông tin theo sự cố. Cài đặt kênh cá nhân, lịch môi trường, cài đặt Telegram theo quyền và các link cũ dùng lại các trang/API hiện có. Hai thay đổi nghiệp vụ so với check5 là Push lâu dài do từng trình duyệt chọn và nhắc CRITICAL ở backend. Admin/Operator/Viewer giữ quyền hiện hành.

### File mới

| Đường dẫn | Vai trò |
| --- | --- |
| `apps/api/src/modules/alert-delivery/reminders.ts` | Hai worker dùng cùng cách tạo lượt nhắc theo sự cố, mức, đích và số thứ tự. Chỉ xét lượt cuối đã xong và dùng unique constraint trong PostgreSQL để nhiều worker hoặc lần quét lại không nhân bản lượt. |
| `packages/database/prisma/migrations/202611200001_room_layout/migration.sql` | Thêm phiên bản phòng. Trigger tăng phiên bản khi gán, bỏ gán, chuyển phòng hoặc đặt điểm trong cùng giao dịch. |
| `packages/database/prisma/migrations/202611200002_browser_push_reminders/migration.sql` | Bổ sung định danh trình duyệt băm, số lượt nhắc, định danh đích trong lịch sử. Công việc cũ là lượt 0. Khôi phục định danh đích từ những job cũ còn tồn tại. |
| `packages/database/prisma/migrations/202611200003_push_device_filter/migration.sql` | Danh sách UUID cảm biến theo trình duyệt. Mảng rỗng mặc định nhận từ tất cả. |
| `tools/operations/check-room-workflow.mjs` | Kiểm thử Playwright trên API, Socket.IO, Vite và PostgreSQL riêng. Hai viewport, Telegram giả, hai tài khoản admin thao tác trên hai browser context. |

### File cũ đã sửa và lý do

| Đường dẫn | Thay đổi |
| --- | --- |
| `packages/database/prisma/schema.prisma` | Ánh xạ phiên bản phòng, browser hash, sensor IDs, lượt nhắc và định danh đích. |
| `packages/contracts/src/monitoring-spaces.ts` | Phiên bản khi đọc/lưu vị trí, chỉ gán nếu thiết bị còn trống phòng. |
| `packages/contracts/src/push.ts`, `packages/contracts/src/alert-delivery.ts` | Truyền lựa chọn đăng ký lâu dài, phạm vi cảm biến và lịch sử lượt nhắc. |
| `apps/api/src/modules/monitoring-spaces/routes.ts`, `room-map.ts` cùng thư mục | GET /spaces/areas đếm theo khu vực bằng một truy vấn, gồm phòng trống, thiết bị chưa đặt và số sự cố. So phiên bản trong giao dịch đã khóa catalog, trả 409 khi bố trí đổi. API cũ vẫn đọc và đặt lần đầu được. Di chuyển điểm đã có cần gửi layout_version lấy từ map. |
| `apps/api/src/modules/auth.ts`, `apps/api/src/app.ts` | Nhận cookie HttpOnly riêng của trình duyệt để gắn lại cùng user hoặc thu hồi khi đổi tài khoản. Cookie Push không cấp quyền mở API sự cố. Đăng xuất dùng luồng thu hồi hiện có. |
| `apps/api/src/modules/push-subscriptions.ts`, `maintenance.ts` cùng thư mục | Lưu lựa chọn cảm biến và hash bí mật ngẫu nhiên. Giữ bản ghi phiên hết hạn làm liên kết chủ sở hữu của đăng ký lâu dài. Middleware vẫn từ chối đăng nhập với token hết hạn. Thu hồi tài khoản và đăng xuất vẫn xóa theo quan hệ hiện có. Đăng ký cũ tiếp tục theo phiên tới khi người dùng bấm lưu. |
| `apps/api/src/modules/environment/policy.ts`, `delivery.ts` cùng thư mục | Lịch môi trường nhận biết đăng ký lâu dài khi chọn đích và trước khi gửi. Giữ quy tắc lịch, riêng tư và giờ yên lặng. |
| `apps/api/src/modules/notifications.ts`, `apps/api/src/modules/web-push.ts` | Tạo nhắc từ worker cũ, kiểm tra lease/token/hạn, sự cố và tiếp nhận trước transport. Push kiểm tra cả lựa chọn thiết bị và đăng ký; Telegram vẫn có một đích chung. |
| `apps/api/src/config.ts`, `server.ts`, `runtime.ts` | Đọc, kiểm tra và truyền CRITICAL_REMINDER_SECONDS đến cả hai worker. |
| `apps/api/src/modules/alert-delivery/routes.ts` | Trả target_id và round ở lịch sử, giữ phân trang và quyền đọc. |
| `apps/web/src/App.tsx`, `apps/web/src/styles.css` | Chia nhóm menu, route khu vực, cập nhật dấu sự cố bằng Socket.IO, chuyển URL sự cố đang xem cho banner. Chỉ hủy đăng ký trình duyệt khi đăng xuất chủ động. |
| `apps/web/src/features/monitoring-spaces/MonitoringSpacesPage.tsx`, `RoomMap.tsx`, `SpaceEditor.tsx`, `styles.css` | Danh sách khu vực, URL riêng, thêm phòng và chọn thiết bị tại phòng. Đếm trên tất cả thiết bị, kéo/thả hoặc chạm, giữ phiên bản của bố trí lúc bắt đầu sửa, cho tải lại khi xung đột. Thu gọn phần quản lý và đưa con trỏ tới tên khi mở form. |
| `apps/web/src/pages/IncidentPage.tsx`, `apps/web/src/features/incident-response/IncidentNotices.tsx`, `IncidentReceipt.tsx`, `IncidentSupport.tsx` | Tiêu đề tiếng Việt, tiếp nhận ở đầu trang, một diễn biến theo giờ thiết bị, thông tin server/seq mở rộng, ẩn banner cùng ID, tel: và sao chép số hợp lệ. |
| `apps/web/src/features/notification-center/DeliveryHistoryPage.tsx` | Nhóm bản ghi cùng đích theo incident; mở dòng xem lượt ban đầu, số lần nhắc, từng lần thử, lỗi và vị trí snapshot. Đích của bản ghi cũ đã bị xóa và không còn ID được giữ riêng để tránh gộp nhầm hai trình duyệt. |
| `apps/web/src/features/notification-center/NotificationSettingsPage.tsx`, `apps/web/src/components/PushSettings.tsx`, `apps/web/src/lib/web-push.ts`, `apps/web/public/push-sw.js` | Chọn thiết bị theo trình duyệt, hướng dẫn chuyển đăng ký cũ, gửi lựa chọn qua API và hiện số nhắc CRITICAL. Vẫn dùng cùng service worker và liên kết sự cố. |
| `apps/api/tests/room-map.test.ts`, `web-push.test.ts`, `multi-device-demo.test.ts` | Xung đột bố trí, thống kê, đăng ký cũ/mới, lọc cảm biến, hết phiên + maintenance, chuyển user, fanout, nhắc đồng thời và dừng theo từng sự cố. |
| `apps/web/src/features/incident-response/IncidentSupport.test.tsx` | Xác minh tel: đúng số cùng với sao chép và xử lý refetch lỗi. |
| `docs/HUONG_DAN_SU_DUNG_MVP_A_Z.md`, `docs/BAO_CAO_THAY_DOI_MVP.md` | Bổ sung hướng dẫn mới ở Mục 12, các file và kết quả nghiệm thu. |

### Kiểm tra thực tế

| Phạm vi | Kết quả |
| --- | --- |
| Prisma generate và migrate deploy | Qua. Đã triển khai 12 migration trên PostgreSQL thử riêng ở cổng 5436, gồm ba migration mới. Database đang dùng của người dùng chưa được migrate trong đợt này. |
| Typecheck, build Vite | Qua. Rollup có cảnh báo annotation của Zod. ESLint đã chạy qua các module giao diện chính và module lập lịch nhắc. |
| Vitest frontend, simulator và bảo vệ transport | 60 ca trên 20 file qua. Gồm banner, số điện thoại, quyền bật Push, trạng thái bản đồ, simulator, config và bảo vệ gửi. |
| PostgreSQL với room-map và web-push | 9 ca qua. Bố trí cùng phiên bản chỉ một lần lưu thành công; viewer/operator bị chặn ghi. Kiểm tra dữ liệu chưa đặt, phòng lưu trữ, quyền và lọc cảm biến. Sau hết phiên và maintenance, một đăng ký mới vẫn gửi qua mock trong khi truy cập API bị từ chối. Đổi user thu hồi đúng đăng ký và giữ lịch sử. |
| Bốn Simulator, nhiều đích và nhắc | 4 ca qua. Phát mẫu lấy từ bốn JSON qua API. Hai sự cố độc lập đúng phòng, một WARNING có hai Push và một Telegram, retry cùng lượt. Đồng hồ điều khiển và hai lần quét đồng thời tạo đúng một lượt nhắc cho mỗi đích. Telegram dừng khi tiếp nhận hoặc phục hồi. Với hai CRITICAL cùng mở, Push chỉ ngừng nhắc sự cố đã tiếp nhận. |
| Hồi quy lịch sử và môi trường | 2 ca tích hợp lịch sử, 13 ca lịch môi trường/kết nối qua trên các database riêng. |
| Chrome desktop và màn hình di động giả lập | Qua ở 1440 × 850 và 390 × 850. Tạo khu vực, thêm phòng trống, gán thiết bị, đặt điểm, tải lại, thấy dấu sự cố rồi mở đúng thiết bị/sự cố qua phòng. Tiếp nhận khi đang mở, gửi mẫu phục hồi và quay lại phòng. Viewer chỉ xem. Hai admin ở hai context desktop mở cùng bố trí, admin đầu kéo thả và lưu; admin sau thấy lỗi và tải lại thành công. |

Các bộ trên có **88 ca Vitest** và một kịch bản trình duyệt chạy ở hai kích thước. Các đích nhận ngoài đều dùng transport giả trong lần kiểm tra này. Chưa xác minh lần nhắc thật trên hai trình duyệt, iPhone thật, nhóm Telegram thật hoặc mở ứng dụng gọi trên điện thoại thật. Đợt này dùng mẫu từ bốn JSON cho kiểm tra API, chưa phát lại toàn bộ 13 phút của `-Scenario All`. Các kết quả thiết bị thật và lần phát đầy đủ của phiên bản trước nằm ở phần bàn giao tương ứng.

**Chạy lại ca giao diện.** Từ thư mục gốc, dùng database PostgreSQL thử đã migrate. Đặt `TEST_ROOM_BROWSER_DATABASE_URL` trỏ tới database đó và `BROWSER_EXECUTABLE` trỏ tới Chrome nếu máy chưa có Chromium của Playwright. Chạy `node --import tsx tools/operations/check-room-workflow.mjs`. Script dùng cổng 4406 và 5276, tạo dữ liệu thử tên ngẫu nhiên và tự đóng server/browser. Tách riêng database cho các suite Push, lịch sử, môi trường và nhiều thiết bị vì worker có thể lấy job của fixture khác. Các bài chạy trong môi trường Codex dùng shim Node tạm của máy cho tsx.

## 21/11/2026 — Lỗi tải dữ liệu, thao tác trong phòng và Push trên Edge

**Chẩn đoán API.** Khi chạy API hiện tại trên một database thử chỉ có chín migration đầu, GET `/api/v1/spaces`, `/api/v1/spaces/areas/:id/map`, `/api/v1/alerts/delivery-history?incident_id=…` và `/api/v1/alerts/incidents/:id/support` đều trả HTTP 503, mã `SERVICE_UNAVAILABLE`. Truy vấn Prisma đọc phòng và lịch sử báo `P2022`, PostgreSQL `42703` (thiếu cột). Ba migration bổ sung trong phần bàn giao trước đưa cả bốn request trở về 200. Đã xác minh database thật `airguard_alert_demo` cổng 5436 đang đủ 12 migration. Kiểm tra qua Edge với phiên thử độc lập trên origin 127.0.0.1:5173, từ danh sách và sau khi tải lại URL khu vực, sự cố Gas và sự cố lửa đều đọc được dữ liệu. Lượt này không cần migration mới.

**Chẩn đoán đích nhận thật.** Đã đọc hiện trạng trước khi thử, giữ nguyên đăng ký và khóa. Database có một subscription, tài khoản còn hoạt động, cho phép Simulator, không giới hạn cảm biến, khớp VAPID hiện tại. Đây là đăng ký check5 kiểu cũ, phiên sở hữu đã hết hạn. Tùy chọn Edge của origin 127.0.0.1:5173 đang cho phép thông báo. Với sự cố Gas trong ảnh (`3b7e4897-e91c-4dd6-aa24-44d3cf35306d`), lịch sử chỉ có Telegram. Chạy bộ phát Gas 20 mẫu trên API đang phục vụ, đúng thiết bị Demo - Gas tại Demo - AirGuard / Demo - Phong B. Sự cố mới `569107de-250a-4ce4-96bc-86fba0ad2332` đã phục hồi. Telegram ghi một lượt, được dịch vụ chấp nhận sau một lần thử. Push có **0 lượt** cho cùng ID, nên cũng có **0 lần gọi transport**. Không có kết quả dịch vụ Push hay Windows hiển thị cho sự cố này. Chưa quan sát trực tiếp tin mới trong nhóm và Trung tâm thông báo của người dùng. Bước hiện tại là chuyển đăng ký trên đúng Edge theo hướng dẫn Mục 13.

| File thay đổi | Lý do |
| --- | --- |
| `apps/web/src/pages/SettingsPage.tsx`, `apps/web/src/styles.css` | Hai thẻ cùng cột tối đa 800 px, gap 16 px, liên kết Thông báo có vùng bấm cao 44 px. |
| `apps/web/src/features/monitoring-spaces/RoomMap.tsx`, `room-map.css` cùng thư mục | Tối đa hai phòng mỗi hàng, breakpoint theo chiều rộng thực tế của sơ đồ, bảng chi tiết riêng. Admin gỡ thiết bị sau xác nhận, cập nhật lưới, danh sách, số đếm và vị trí hiện tại. Link sự cố ở ngay trạng thái thiết bị; nhiều sự cố mở có danh sách chọn. |
| `packages/contracts/src/monitoring-spaces.ts`, `apps/api/src/modules/monitoring-spaces/routes.ts` | Bổ sung điều kiện phòng dự kiến tùy chọn vào API bỏ gán để tránh gỡ nhầm nếu một admin khác vừa chuyển phòng. Giữ các caller cũ. |
| `apps/web/src/lib/api.ts`, `apps/web/src/features/notification-center/DeliveryHistoryPage.tsx` | Giữ thông tin lỗi của API, bổ sung HTTP status/mã request với lỗi server. Chỉ hiện danh sách hoặc trạng thái trống khi đọc thành công. |
| `apps/api/src/modules/alert-delivery/message.ts`, `notifications.ts`, `telegram-client.ts` trong modules, `web-push.ts` trong modules và `apps/web/public/push-sw.js` | Tiêu đề theo loại sự cố, thiết bị và phòng snapshot, giờ theo chính sách kênh, phân biệt nhắc lại. Telegram dùng liên kết có nhãn. Push có tiêu đề chung khi ẩn chi tiết. Link HTTP loopback dùng để demo trên máy chạy web, HTTPS dùng khi truy cập từ máy khác. |
| `apps/api/tests/telegram.test.ts`, `telegram-client.test.ts`, `multi-device-demo.test.ts`, `alert-delivery-history.test.ts` cùng thư mục; `apps/web/src/lib/incident-push.test.ts` (mới), `push-service-worker.test.ts` cùng thư mục; `tools/operations/check-room-workflow.mjs` | Test nội dung, URL, vị trí lịch sử sau gỡ, payload riêng tư và hiển thị service worker. Mở rộng kiểm thử trình duyệt. |
| Hai tài liệu trong `docs/` | Bàn giao kết quả, cách gỡ/gán lại và xác minh Windows. |

**Kiểm tra.** Typecheck và build production qua. Vitest qua 67 ca, gồm 51 ca giao diện, service worker, client gửi và bảo vệ transport. PostgreSQL thử riêng: 10 ca Telegram/sơ đồ, 2 ca lịch sử, 4 ca nhiều thiết bị qua. Kiểm tra qua mock gồm lỗi tải lại danh bạ, bảo vệ lease/hạn gửi, Telegram link entity sau emoji, Push ẩn/hiện chi tiết, múi giờ và mở đúng ID. E2E Chrome 1440 × 850 và 390 × 850 qua: 1, 3, 5 phòng, 4 cảm biến chưa đặt trong phòng đầu, hàng dưới dời đúng, lưới nằm trong thẻ, gỡ rồi gán lại qua tải lại, kéo/chạm, xung đột hai admin và viewer. Gas mở thẳng đúng sự cố; Gas và lửa cùng thiết bị hiện hai lựa chọn đúng ID rồi biến mất khi phục hồi. Hai thẻ Cài đặt khớp hai mép và cách 16 px. Khổ di động dùng viewport giả lập. Các bài tự động không gọi nhà cung cấp thật.

## 21/11/2026 — Tạo phòng đúng khu vực và mở sự cố từ thông báo

**Tạo phòng.** Trước khi sửa, Edge đang ở URL Demo - AirGuard (`ce32ebfc-a94c-41a9-aa39-1108a9bf91ed`) nhưng bộ chọn độc lập trong form cho phép POST với ID Khách (`a257a187-f1da-4e92-ac8b-584cd456189a`). Đã chặn request tái hiện trước khi ghi. API lưu theo ID trong body, sơ đồ đọc theo ID trên URL. Đây là đường dẫn tái hiện được, ảnh chụp riêng lẻ không xác định được thao tác trước đó. Form tạo nay lấy khu vực từ URL, cập nhật cache đúng khu theo phản hồi 201 rồi đọc lại. Lỗi ghi giữ form. Lỗi đọc lại vẫn cho thử lại và giữ phòng vừa tạo nếu đã có dữ liệu sơ đồ.

**Bấm Push.** Handler cũ gọi focus trên client ban đầu sau navigate, bỏ qua client trả về và thiếu đường dự phòng nếu tab biến mất hoặc điều hướng lỗi. Nhánh này có thể làm mất thao tác mở. Không có trace của lần bấm Windows ban đầu để khẳng định nguyên nhân trên máy người nhận. Bản mới lưu ID trong notification.data, nhận dạng tag hoặc đường nội bộ của tin cũ, focus client trả về và thử tab khác/mở mới khi cần. Màn hình đăng nhập giữ nguyên URL chi tiết.

| Tệp đã sửa | Thay đổi |
| --- | --- |
| `apps/web/src/features/monitoring-spaces/SpaceEditor.tsx`, `MonitoringSpacesPage.tsx` | Form tạo theo URL, tên khu ngay trên form, cập nhật phòng từ phản hồi API. |
| `apps/web/src/features/monitoring-spaces/RoomMap.tsx`, `room-map.css` | Giữ dữ liệu đã nhận khi đọc lại lỗi, mở rộng phòng đơn, ưu tiên sự cố nghiêm trọng nhất, làm nổi cảm biến liên quan, ghi độ mới và trạng thái mất kết nối. |
| `apps/web/src/features/incident-response/IncidentNotices.tsx`, `styles.css`, `IncidentNotices.test.tsx` | Thẻ hai dòng, màu theo mức, điều hướng bàn phím, nút đóng độc lập và hai cảnh báo Gas khác ID. |
| `apps/api/src/modules/alert-delivery/message.ts`, `apps/api/src/modules/web-push.ts`, `apps/web/public/push-sw.js` | Telegram tách mức và trạng thái, Push có loại ở tiêu đề, xử lý click và thông báo cũ. |
| `apps/web/src/lib/incident-push.test.ts`, `push-service-worker.test.ts`, `apps/api/tests/alert-delivery-history.test.ts`, `multi-device-demo.test.ts`, `telegram.test.ts` | Hồi quy nội dung, riêng tư, đích mở và lịch sử. |
| `tools/operations/check-room-workflow.mjs`, hai tài liệu bàn giao trong `docs/` | Kiểm tra lỗi ghi/đọc lại, giao diện sáng/tối và bàn phím, ghi kết quả demo. |

**Kết quả trên bản đang chạy.** Edge tạo **Phòng kiểm tra tạo mới 965240** qua POST 201. ID trong URL, request và response khớp Demo - AirGuard. Phòng hiện ngay với 0 thiết bị và nút Gán thiết bị, chuyển sang Khách không thấy, quay lại và F5 vẫn thấy. Giữ phòng này để đối chiếu. Tại Khách, thiết bị “Không khí” có sự cố lửa mở dù đã offline, mẫu lúc 15:36:01 ngày 20/11 được đánh dấu dữ liệu cũ và có tín hiệu lửa.

Simulator Gas gửi 20 mẫu, Flame gửi 19 mẫu qua API thật. Đã đối chiếu link trên sơ đồ và lịch sử. Gas WARNING (`ec46676c-5c87-438a-b142-92efd4093b33`) thuộc Demo - Phong B. Lửa CRITICAL (`e257d7b7-a920-41e0-957c-de2d60549776`) thuộc Demo - Phong A. Cả hai có một lượt Telegram và một lượt Web Push ban đầu, mỗi lượt dịch vụ chấp nhận ở lần thử thứ nhất. Chưa quan sát trực tiếp tin mới trên giao diện Telegram hoặc Trung tâm thông báo.

**Kiểm tra tự động.** Typecheck và build production qua. 18 ca giao diện/worker/client và 24 ca PostgreSQL trên DB thử riêng qua (sơ đồ/Telegram 10, lịch sử/quyền/tiếp nhận 2, nhiều thiết bị 4, Web Push 8). Edge headless 1440 và 390 px qua cả tình huống POST lỗi và tải sơ đồ lại lỗi; kiểm tra gán phòng, vị trí, xung đột, viewer, banner hai theme và mở bằng Enter. Trên origin thật, đã đăng ký service worker trong hồ sơ Edge thử riêng, phát sự kiện push và notificationclick bằng mã, đọc lại notification.data và thấy trang Gas đúng ID sau đăng nhập. Trường hợp đóng hết tab, tab biến mất và thông báo cũ có test worker giả. Chưa bấm thủ công trên Windows ở cả ba tình huống. Không cần migration mới.
