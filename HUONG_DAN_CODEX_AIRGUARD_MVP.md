# HƯỚNG DẪN CODEX TRIỂN KHAI AIRGUARD MVP

## 1. Nhiệm vụ và kết quả cần đạt

Bạn là lập trình viên phát triển tiếp dự án AirGuard: website giám sát môi trường và khí gas kết nối thiết bị IoT. Hãy đọc mã nguồn hiện tại, triển khai bản đầu hoạt động từ giao diện đến API, database và worker, kiểm tra rồi bàn giao. Không chỉ dừng ở kế hoạch, giao diện mẫu hoặc các file chưa được nối vào ứng dụng.

Mục tiêu là bổ sung bốn nhóm: quản lý khu vực/phòng; thông báo môi trường và kết nối; tiếp nhận cảnh báo và lịch sử gửi; danh bạ và gọi hỗ trợ bằng `tel:`. Giữ thay đổi nhỏ, tách phần mới để dễ ghép với code của các thành viên khác.

Tài liệu này là yêu cầu triển khai, không phải tuyên bố rằng các chức năng đã chạy. Những ghi nhận về cấu trúc dưới đây dựa trên bản zip đã đọc; repository thực tế có thể mới hơn. Hãy kiểm tra lại trước khi sửa. Mọi đường dẫn trong tài liệu tính từ thư mục gốc repository.

## 2. Bối cảnh code cần đọc trước

| Thành phần | Vị trí/ghi nhận để đối chiếu |
| --- | --- |
| Frontend | `apps/web`: React, TypeScript, React Query, React Router, Recharts |
| Điều hướng chính | `apps/web/src/App.tsx`: menu, route, phiên đăng nhập và kết nối realtime |
| Backend | `apps/api`: Express, TypeScript, Socket.IO |
| Đăng ký API | `apps/api/src/app.ts`: đăng ký module và middleware xác thực/phân quyền |
| Worker và realtime | `apps/api/src/runtime.ts`; điểm khởi chạy là `server.ts` |
| Dữ liệu dùng chung | `packages/contracts/src/` |
| Database | PostgreSQL/Prisma; schema và migration trong `packages/database/prisma/` |
| Cảnh báo | `apps/api/src/modules/alerts.ts` |
| Telegram | `notifications.ts`, `telegram-client.ts` trong thư mục module API |
| Web Push | `web-push.ts`, `web-push-client.ts`, `push-subscriptions.ts` |
| Service worker | `apps/web/public/push-sw.js` |
| Trạng thái thiết bị | `presence.ts`, lịch sử `DeviceStatusHistory` |
| Sự cố trên web | `apps/web/src/pages/IncidentPage.tsx` |
| Cụm mở rộng đã có | `features/comparison-reporting/` |

Các nguyên tắc nghiệp vụ hiện có phải giữ:

- Role gồm `admin`, `operator`, `viewer`; dùng xác thực và quyền backend hiện có. Code hiện tại cho tài khoản đã đăng nhập xem chung thiết bị; không tự xây lại hệ thống tenant/phân quyền theo phòng trong MVP.
- MQ-2/MQ-7 là ADC thô, chưa phải ppm/AQI. Không suy diễn chỉ số chất lượng không khí, nồng độ CO hoặc ngưỡng gas an toàn.
- Cảnh báo dựa trên snapshot/sự kiện thiết bị gửi lên; không thay bằng cách so ADC với ngưỡng tùy ý ở backend.
- Xác nhận không đóng sự cố và không tắt còi. Mất mạng không được tự chuyển sự cố thành đã kết thúc.
- `Device.location` đang tồn tại; giữ để tương thích.
- Telegram đã có nội dung thiết bị, vị trí, thời gian, mức độ, hàng đợi và retry. Nâng cấp trên nền này, không làm lại phần đã có.
- Web Push đang gắn với phiên đăng nhập và có payload ít chi tiết để hạn chế lộ thông tin sau đăng xuất. Không tự chuyển sang đăng ký vĩnh viễn hoặc bỏ kiểm tra phiên.
- `AlertAcknowledgement` hiện lưu một xác nhận nghiệp vụ cho một sự cố, dành cho operator/admin. Không dùng nó làm xác nhận tiếp nhận riêng của mọi người dùng.
- README của cụm tiện ích có thể lỗi thời; đối chiếu import và route thật, không chỉ tin mô tả README.

## 3. Phạm vi bản đầu và phần không làm

### Phải hoàn thành

1. CRUD/lưu trữ khu vực và phòng, mô tả; gán thiết bị vào phòng là tùy chọn.
2. Cấu hình thông báo; bản tin nhiệt độ/độ ẩm theo lịch; thông báo biến động đáng chú ý; mất/kết nối lại; giờ yên lặng.
3. Nâng cấp luồng gửi hiện có; xác nhận tiếp nhận trên web theo người dùng; lịch sử gửi và lần thử gửi; chống tạo trùng.
4. Danh bạ hỗ trợ theo phạm vi; gọi nhanh `tel:` và sao chép số trên trang sự cố.
5. Giao diện dùng dữ liệu thật của API, có trạng thái tải/lỗi/rỗng; migration, kiểm tra và hai file bàn giao ở Mục 11.

### Không triển khai ở bản đầu

- Gọi tự động, dịch vụ thoại trả phí, tự động điều phối cứu hộ.
- Chuyển cấp tự động hoặc xác nhận trực tiếp bằng callback Telegram. Có thể mô tả hướng phát triển trong báo cáo, không dựng tính năng giả trên UI.
- Liên kết Telegram cá nhân với tài khoản web; bản đầu dùng đích Telegram chung được quản trị cấu hình.
- Vẽ lại toàn bộ sơ đồ, kéo thả mặt bằng, thay dashboard hoặc viết lại các cụm tiện ích/so sánh hiện có.
- AI, phân loại AQI, ppm, điều khiển còi/van gas từ xa, OTA firmware.
- Thay kiến trúc, ORM, thư viện frontend, cơ chế đăng nhập hoặc toàn bộ pipeline cảnh báo.

## 4. Quy định bắt buộc để giảm xung đột code

1. Đọc hướng dẫn repository và trạng thái thay đổi hiện tại trước khi sửa. Không ghi đè công việc chưa commit của người khác; không reset, clean hoặc xóa file không thuộc nhiệm vụ.
2. Ưu tiên tạo thư mục/module/component/hook/service/type/test mới. Toàn bộ logic mới và CSS nên nằm riêng; CSS có phạm vi hoặc tiền tố rõ, không thêm selector toàn cục làm đổi trang cũ.
3. Không di chuyển, đổi tên, xóa, refactor hoặc format hàng loạt file cũ. Không thay đổi cấu trúc thư mục chung chỉ để thuận tiện cho phần mới.
4. Được sửa tối thiểu file cũ khi cần tích hợp thật: import, route/menu, đăng ký API/worker, gọi helper mới, component chèn vào trang sự cố, export contract, schema và nội dung Push tương thích. Đây là phạm vi đã được cho phép, không cần dừng hỏi lại chỉ vì phải sửa một điểm tích hợp.
5. Các file có thể cần chạm: `App.tsx`, `IncidentPage.tsx`, `app.ts`, `runtime.ts`, `schema.prisma`, điểm export contract và các module gửi/service worker hiện có. Đây không phải danh sách phải sửa hết hoặc danh sách cấm sửa file khác. Mỗi file cũ thực sự sửa đều phải giải thích vì sao không thể chỉ thêm file mới.
6. Giữ API, kiểu dữ liệu và hành vi cũ tương thích; ưu tiên trường tùy chọn hoặc endpoint mới. Không đổi tên trường, role, route hoặc response envelope đang dùng.
7. Chỉ thêm migration mới; không sửa migration đã áp dụng, không reset database, không chạy lệnh xóa dữ liệu. Không đổi dữ liệu cũ thành có phòng bắt buộc. Bổ sung model Prisma trong schema chung nếu cần; không tách schema nhiều file nếu phải thay cấu hình dự án chỉ để đạt hình thức “file mới”.
8. Tận dụng dependency hiện có. Chỉ thêm dependency nếu cần thiết và ghi rõ lý do, package/lockfile thay đổi. Không nâng phiên bản hàng loạt.
9. Không tạo hệ gửi cảnh báo thứ hai chạy song song cùng sự kiện. Giữ một nơi chịu trách nhiệm tạo/gửi cho từng loại sự kiện, người nhận và kênh. Nếu có chuyển đổi hàng đợi, phải nêu cách tránh gửi lại và xử lý công việc đang chờ.
10. Không sửa `.env` thật, token, khóa VAPID hoặc credential của người dùng. Cung cấp mẫu cấu hình bổ sung không có bí mật. Không thực hiện gửi tin tới người thật khi kiểm thử; dùng transport giả trừ khi người dùng đã cho phép test với đích cụ thể.
11. Không sửa test cũ để che hồi quy, không tắt validation/phân quyền/CSRF, không dùng `any` hàng loạt để vượt typecheck.
12. Trước bàn giao rà soát diff để loại các thay đổi ngoài phạm vi. Báo riêng lỗi nền của repository và lỗi do phần mới, không tự nhận mọi lỗi cũ là đã sửa.

## 5. Chức năng 1 — Quản lý không gian giám sát

### Dữ liệu và hành vi

- Khu vực: mã định danh, tên, mô tả, trạng thái lưu trữ, thời gian tạo/cập nhật.
- Phòng: mã định danh, khu vực cha, tên, mô tả, trạng thái lưu trữ, thời gian tạo/cập nhật.
- Tên sau trim không rỗng; tránh tên khu vực trùng và tên phòng trùng trong cùng khu vực, không phân biệt hoa thường theo cách chuẩn hóa được tài liệu hóa.
- Một phòng thuộc một khu vực. Một thiết bị có tối đa một phòng đang gán trong MVP; có thể chưa được gán. Tạo bảng liên kết riêng thay vì buộc mọi thiết bị có `roomId` bắt buộc.
- Không ghi đè `Device.location` khi gán phòng. Các module cũ vẫn dùng dữ liệu cũ; phần mới dùng phòng khi có và fallback sang `Device.location` khi chưa có.
- Danh sách có tìm kiếm, lọc khu vực và xem trạng thái lưu trữ. Có form thêm/sửa và thao tác lưu trữ/khôi phục. Lưu database, không chỉ localStorage.
- Không xóa cứng không gian đang được tham chiếu. Với khu vực còn phòng đang hoạt động, yêu cầu xử lý phòng trước hoặc từ chối rõ ràng; không âm thầm bỏ liên kết. Không cho gán mới vào khu vực/phòng đã lưu trữ.
- Admin quản lý dữ liệu và gán thiết bị; operator/viewer chỉ xem.

### Tính độc lập

Chức năng này tạo dữ liệu nền phục vụ sơ đồ. Không bắt analytics, dashboard, telemetry, simulator hoặc các API cũ phải dùng khu vực/phòng. Không mở rộng bài toán sang tính toán sức khỏe/tổng hợp cả phòng khi chưa có định nghĩa.

## 6. Chức năng 2 — Thông báo môi trường và kết nối

### 6.1. Phạm vi cấu hình và người nhận

- Web Push: cấu hình cá nhân theo người dùng; sử dụng các subscription thuộc phiên còn hợp lệ và chủ tài khoản đang hoạt động. Nhiều trình duyệt có thể nhận, nhưng chỉ là một người dùng khi thống kê tiếp nhận.
- Telegram MVP: đích chung của workspace, lấy từ cấu hình backend hiện có. Admin cấu hình loại tin/lịch/giờ yên lặng ở cấp workspace. Không giả vờ rằng thay cấu hình cá nhân sẽ thay đổi tin gửi đến group chung.
- Cấu hình chọn thiết bị theo dõi, loại tin, lịch hoặc tần suất phù hợp, múi giờ, giờ yên lặng, quy tắc biến động, kênh gửi và có/không nhận dữ liệu simulator.
- Cài đặt nhạy cảm của Telegram vẫn ở server; UI không đọc/trả bot token hoặc khóa bí mật.
- Không có subscription/đích hợp lệ thì ghi nhận bỏ qua hoặc chưa sẵn sàng; không báo “đã gửi”.

### 6.2. Ba nhóm thông báo

**Bản tin định kỳ:** tổng hợp nhiệt độ và độ ẩm trong cửa sổ báo cáo đã định nghĩa, có khoảng thời gian, thiết bị, số mẫu hợp lệ và min/max/trung bình khi đủ dữ liệu. Bản đầu hỗ trợ một lịch hằng ngày hoặc khoảng lặp theo lựa chọn được validation; không cần cron expression tùy ý. Lưu thời gian ở UTC, tính lịch theo múi giờ, mặc định `Asia/Ho_Chi_Minh`.

**Biến động đáng chú ý:** so nhiệt độ/độ ẩm gần đây với cửa sổ tham chiếu trước đó. Người cấu hình chọn chênh lệch, thời gian duy trì và khoảng nghỉ giữa các lần gửi. Nêu chính xác thuật toán/cửa sổ và yêu cầu đủ mẫu trong hướng dẫn; không so với mẫu trước duy nhất rồi gửi liên tục. Ngưỡng độ ẩm dùng điểm phần trăm RH, không nhầm với phần trăm thay đổi tương đối. Đây là quy tắc thông báo biến động, không phải ngưỡng an toàn sức khỏe.

**Mất/kết nối lại:** dựa vào lần chuyển trạng thái đã lưu trong `DeviceStatusHistory` và tiêu chí online/offline hiện có. Không gửi mỗi lần polling; gộp chập chờn bằng khoảng chờ/khoảng nghỉ. Nếu đã thông báo mất kết nối thì cần có tin phục hồi tương ứng; cặp trạng thái ngắn bị gộp phải được mô tả rõ. Có thể dùng worker đọc lịch sử với cursor bền vững để tránh sửa sâu `presence.ts`.

### 6.3. Quy tắc xử lý nền

- Chạy ở backend; đóng tab không dừng lịch gửi. Không dùng timer frontend làm scheduler.
- Chỉ dùng mẫu hợp lệ và đủ mới. Thiếu, lỗi hoặc quá cũ phải biểu diễn đúng; không thay bằng 0, không suy ra “bình thường”.
- Giờ yên lặng hỗ trợ qua nửa đêm; thông báo thường được trì hoãn/gộp thành một bản phù hợp, không dồn toàn bộ tin cũ khi hết giờ. Kiểm tra lại chính sách trước mỗi lần gửi/retry.
- Có tùy chọn rõ ràng cho cảnh báo `critical` bỏ qua giờ yên lặng; không hiểu nhầm rằng điều này có thể vượt chế độ Không làm phiền của hệ điều hành. Không âm thầm thay hành vi gửi sự cố cũ khi chưa có cấu hình mới.
- Lưu trạng thái lịch/cursor, chống trùng ở database và xử lý worker khởi động lại. Khi quá nhiều lịch bị lỡ, chỉ xử lý/gộp theo cửa sổ còn giá trị; không gửi bù vô hạn.
- Có khóa/lease hoặc cơ chế tương đương để hai worker không cùng tạo/gửi một công việc; cursor chỉ tiến khi dữ liệu liên quan đã được ghi an toàn.
- Trong lần bật đầu tiên, không phát lại toàn bộ lịch sử kết nối/sự cố cũ. Định nghĩa mốc bắt đầu rõ ràng; giữ các job đang chờ hợp lệ của hệ cũ.
- Worker có cách dừng an toàn cùng runtime hiện có. Không thêm Redis/Kafka hoặc nền tảng lịch bên ngoài nếu PostgreSQL và worker hiện tại đủ dùng.

## 7. Chức năng 3 — Cảnh báo đẩy, tiếp nhận và lịch sử

### 7.1. Nội dung và điều hướng

- Nội dung chi tiết gồm: loại cảnh báo, mức độ, tên thiết bị, vị trí, thời gian sự kiện nếu có, thời gian server ghi nhận khi cần, mã sự cố và đường dẫn đến đúng sự cố.
- Phân biệt dữ liệu thật/mô phỏng và sự cố đã kết thúc. Không hiển thị “đang nguy hiểm” chỉ vì còn bản ghi chưa kết thúc nhưng thiết bị đã offline.
- Telegram: tận dụng formatter/transport/queue hiện có và thêm đường dẫn HTTPS hợp lệ vào sự cố trên web. Bản đầu xác nhận trên web sau đăng nhập, không cần webhook Telegram mới.
- Web Push: mặc định tiếp tục ẩn chi tiết nhạy cảm. Thêm lựa chọn cá nhân “Hiển thị chi tiết thông báo” với giải thích ngắn rằng tên/vị trí có thể xuất hiện trên màn hình khóa và tin đã gửi có thể đến muộn sau đăng xuất. Chỉ mở rộng payload khi người nhận đã bật lựa chọn đó; kiểm tra lại trước gửi.
- Service worker phải hiểu cả payload cũ và mới, fallback an toàn khi thiếu trường. Chỉ mở đường dẫn cùng origin được cho phép; hỗ trợ thông báo mới dẫn tới trung tâm thông báo hoặc trang sự cố. Không mở URL tùy ý do payload cung cấp.
- Không xem việc bấm mở thông báo hoặc gọi API gửi thành công là xác nhận tiếp nhận.

### 7.2. Xác nhận tiếp nhận riêng

- Tạo dữ liệu xác nhận tiếp nhận theo `(sự cố, người dùng)`, có unique constraint; lưu người xác nhận, thời gian và nguồn thao tác là web.
- User đã đăng nhập, còn hoạt động, có quyền xem sự cố và thuộc đối tượng nhận theo chính sách mới có thể xác nhận phần của mình. Với Telegram chung, kiểm tra quyền tài khoản web, không coi danh tính group là danh tính người xác nhận.
- Xác nhận idempotent: bấm lặp hoặc hai yêu cầu đồng thời không tạo trùng, không sửa thời gian xác nhận đầu tiên.
- Không đổi `AlertIncident.status`, không tạo sự kiện kết thúc, không gửi lệnh tắt còi; không ghi đè `AlertAcknowledgement` cũ. Đặt nhãn phân biệt “Tôi đã nhận cảnh báo” và “Xác nhận nghiệp vụ” hiện có.
- User xem xác nhận của mình; operator/admin được xem danh sách tiếp nhận theo sự cố để theo dõi ai đã nhận. Không mở toàn bộ lịch sử gửi cá nhân cho viewer khác.
- Sự cố đã kết thúc vẫn được xem lịch sử; xác nhận muộn, nếu hỗ trợ, phải hiển thị là tiếp nhận muộn và không làm thay đổi vòng đời sự cố.

### 7.3. Nhật ký và chống trùng

- Màn hình trung tâm thông báo/lịch sử: lọc loại, kênh, thiết bị, thời gian, trạng thái; có phân trang.
- Tách bản ghi thông báo logic, đích nhận/kênh và các lần thử gửi, hoặc mô hình tương đương đủ truy vết. Ghi nguyên nhân bỏ qua, lỗi, số lần thử và thời gian.
- Phân biệt rõ: chờ, đang thử, dịch vụ đã chấp nhận, lỗi/thử lại, hết hạn/bỏ qua; xác nhận người nhận là thông tin riêng. Không dùng nhãn “đã đọc” khi không có bằng chứng.
- Định danh chống trùng tối thiểu theo sự kiện gốc + đích nhận + kênh + lần nhắc/lịch. Đổi mức độ hợp lệ là sự kiện riêng; nhiều telemetry lặp của cùng sự cố không tạo một loạt cảnh báo mới.
- Tận dụng retry/backoff/lease và giới hạn tốc độ hiện có. Không hứa “exactly once” với dịch vụ ngoài: khi dịch vụ đã nhận nhưng kết nối đứt trước phản hồi vẫn có thể trùng. Giảm trùng bằng idempotency nội bộ, tag/topic phù hợp và ghi nhận trạng thái trung thực.
- Lịch sử phục vụ theo dõi phải tồn tại khi logout hoặc subscription bị xóa; không chỉ dùng bảng delivery có cascade theo subscription làm nhật ký duy nhất. Không giữ endpoint, khóa Push, token hoặc nội dung nhạy cảm không cần thiết trong nhật ký.
- Ưu tiên cảnh báo sự cố hơn bản tin định kỳ. Cấu hình/chức năng mới chưa bật không được vô hiệu hóa cảnh báo đang hoạt động trước đó.

## 8. Chức năng 4 — Danh bạ và liên hệ hỗ trợ

- Danh bạ gồm tên, vai trò/đơn vị, số điện thoại, mô tả, phạm vi chung/khu vực/phòng, mức ưu tiên và trạng thái hoạt động.
- Admin thêm/sửa/lưu trữ; người có quyền xem sự cố xem các liên hệ phù hợp. Chuẩn hóa và kiểm tra số điện thoại; không cho chèn URI/schema tùy ý.
- Trên trang sự cố chèn component mới, không viết lại trang: danh bạ phù hợp, nút “Gọi hỗ trợ”, “Sao chép số” và thông tin địa điểm để người dùng cung cấp khi liên hệ.
- Ưu tiên liên hệ của phòng, rồi khu vực, rồi liên hệ chung; không trả kết quả trùng. Nếu chưa gán phòng thì dùng `Device.location` làm thông tin mô tả và danh bạ chung.
- Nút gọi dùng `tel:` và số đã validation. Trên desktop không có ứng dụng gọi thì vẫn hiển thị số và cách sao chép.
- Nếu ghi nhật ký thao tác, chỉ ghi “đã bấm gọi/đã yêu cầu mở ứng dụng gọi”, không báo cuộc gọi đã kết nối hoặc đã có người đến hỗ trợ.
- Không đặt sẵn số cá nhân thật hoặc tự động gọi số khẩn cấp. Mẫu demo dùng placeholder và không phát sinh cuộc gọi thật khi test.
- Lưu snapshot vị trí dùng cho bản ghi thông báo mới để việc đổi tên/gán phòng sau này không làm lịch sử bị viết lại. Không bịa snapshot cho sự cố cũ; nếu chỉ có vị trí hiện tại thì ghi đúng nguồn.

## 9. Tổ chức code và tích hợp

Đề xuất dưới đây có thể điều chỉnh theo repository thật, nhưng phải giữ nguyên tinh thần tách biệt:

| Phần | Thư mục/file mới gợi ý |
| --- | --- |
| Khu vực/phòng | `apps/web/src/features/monitoring-spaces/` |
| Trung tâm và cài đặt thông báo | `apps/web/src/features/notification-center/` |
| Tiếp nhận và liên hệ trên sự cố | `apps/web/src/features/incident-response/` |
| API và logic không gian | `apps/api/src/modules/monitoring-spaces/` |
| Chính sách, lịch, nhật ký, worker | `apps/api/src/modules/notification-center/` |
| API tiếp nhận và danh bạ | `apps/api/src/modules/incident-response/` |
| Validation/DTO | File riêng trong `packages/contracts/src/` |
| Migration | Một hoặc nhiều thư mục migration mới, không sửa migration cũ |

Yêu cầu kỹ thuật:

- Dùng helper API, envelope response, middleware quyền, React Query và cách hiển thị lỗi đang có.
- Tất cả API ghi dữ liệu kiểm tra quyền ở backend; UI ẩn nút không thay thế authorization. Có validation giới hạn tên, mô tả, tần suất, độ dài danh sách thiết bị và lịch.
- API mới phải được đăng ký sau lớp xác thực phù hợp. Không dùng endpoint công khai để xác nhận tiếp nhận.
- Dữ liệu cá nhân thuộc người dùng được lọc ở truy vấn backend. Telegram cấp workspace chỉ admin được cấu hình/xem nhật ký quản trị.
- Giao diện tiếng Việt, responsive theo layout hiện tại; dùng trạng thái rỗng/tải/lỗi/thành công và khóa nút lúc lưu. Không thêm banner kỹ thuật dài vào luồng dùng sản phẩm.
- Migration chỉ bổ sung và có default an toàn. Giữ nguyên các dữ liệu, quan hệ và ràng buộc cũ; relation ngược Prisma cần bổ sung thì sửa tối thiểu.
- Có thể thêm mẫu cấu hình bổ sung riêng, ví dụ `.env.mvp.example`, với giải thích biến nào bắt buộc/tùy chọn. Không ghi secret vào source, log, response hoặc tài liệu.
- Chuẩn bị transport giả để test gửi, fake clock hoặc hàm xử lý một lượt worker để test lịch; không cần đợi hàng giờ hoặc gửi thật.

## 10. Trình tự thực hiện và tiêu chí nghiệm thu

### Cách thực hiện

1. Kiểm kê code/phiên bản/cấu hình/database; ghi nhận file đang có thay đổi và lỗi nền nếu thấy.
2. Lập sơ đồ ngắn các file mới và điểm phải sửa; sau đó triển khai ngay trong phạm vi này, không dừng ở kế hoạch để xin xác nhận lại.
3. Làm dữ liệu/API không gian và danh bạ; tiếp đến cấu hình, lịch/worker, nhật ký, tiếp nhận; cuối cùng nối UI và tương thích các kênh cũ.
4. Chạy kiểm tra phù hợp, sửa lỗi do phần mới, kiểm tra diff và viết hai file bàn giao.
5. Thiếu credential ngoài không được chặn toàn bộ công việc: hoàn thành code, kiểm thử bằng mock, chỉ rõ bước bật kênh thật còn thiếu. Chỉ hỏi khi có quyết định thực sự không suy ra được và ảnh hưởng đến dữ liệu/quyền nghiệp vụ.

### Kiểm tra tối thiểu

| Tình huống | Kết quả cần chứng minh |
| --- | --- |
| Thiết bị chưa có phòng | Trang/module cũ vẫn hoạt động; chức năng mới có fallback |
| Tên trùng, tham chiếu phòng lưu trữ | Validation/từ chối rõ; không mất liên kết âm thầm |
| Phân quyền | Viewer không sửa không gian/danh bạ/cài đặt workspace; không xem dữ liệu cá nhân của người khác |
| Giờ yên lặng qua nửa đêm | Gộp/trì hoãn đúng múi giờ, không gửi dồn hoặc lặp |
| Khởi động lại/hai worker | Không tạo lại cùng job; không phát toàn bộ lịch sử cũ |
| Biến động và mẫu lỗi/cũ | Đủ cửa sổ và cooldown mới gửi; không coi thiếu dữ liệu là 0 |
| Offline/online chập chờn | Không spam; phục hồi khớp chính sách đã mô tả |
| Retry và telemetry lặp | Không tạo trùng job; thể hiện đúng khi thất bại/hết hạn |
| Xác nhận đồng thời | Một receipt/người/sự cố, giữ thời gian đầu; không kết thúc sự cố hoặc tắt còi |
| Logout/hết phiên | Không gửi mới tới phiên mất hiệu lực; lịch sử theo dõi còn tồn tại |
| Push cũ/mới và quyền riêng tư | Payload cũ vẫn mở đúng; mặc định ẩn chi tiết; opt-in mới hiển thị chi tiết |
| Telegram tắt hoặc thiếu cấu hình | API/UI báo đúng, không làm hỏng phần khác; không giả gửi thành công |
| Liên hệ và gọi nhanh | Chọn đúng phạm vi; URL hợp lệ; không ghi đã kết nối chỉ từ click |
| Hồi quy | Đăng nhập, thiết bị, monitoring, incident, analytics và cụm mở rộng cũ vẫn hoạt động |

Đối chiếu script thật trong `package.json` trước khi chạy. Bản đã xem có `typecheck`, `lint`, `test`, `build`, `db:generate`, `db:migrate`, `dev`, `simulate`, `admin:create`, `webpush:keys`; Node khai báo `>=22.12.0`. Không mặc định script integration/e2e chạy được: bản zip có thể thiếu file runner hoặc cấu hình. Test database dùng database test riêng, không database của nhóm.

Chạy typecheck/build/lint và các test liên quan có thể chạy; thêm test cần thiết cho lịch, chống trùng, quyền và tiếp nhận. Phân biệt pass/fail/skipped/chưa chạy. Nếu thiếu PostgreSQL, thiếu dependency hoặc credential thì ghi đúng giới hạn; không tuyên bố đã kiểm tra đầy đủ.

## 11. Hai file bàn giao bắt buộc

Ngoài mã nguồn và test, tạo/cập nhật đúng hai tài liệu bàn giao dưới đây. Không tạo một loạt báo cáo rời rạc. Nếu đã có file cùng tên, giữ nội dung hữu ích và cập nhật theo kết quả thật. File yêu cầu này giữ nguyên, không tính là file bàn giao.

### A. `docs/BAO_CAO_THAY_DOI_MVP.md`

Phải có:

1. Tóm tắt kết quả và bảng bốn nhóm chức năng: hoàn thành/thiếu/chưa kiểm chứng; phần nào ngoài phạm vi.
2. Danh sách đầy đủ file mới, chức năng của từng file; nhóm theo module để dễ đọc.
3. Bảng mọi file cũ đã sửa: đường dẫn, thay đổi cụ thể, lý do không thể chỉ tạo file mới, ảnh hưởng/tương thích, nơi cần chú ý khi ghép code. Có số dòng thêm/xóa nếu xác định được đáng tin cậy.
4. API mới/cũ thay đổi, model/migration mới, cấu hình và dependency bổ sung.
5. Chính sách thực tế đã triển khai: đối tượng nhận, timezone, biến động, giờ yên lặng, offline/online, chống trùng/retry, tiếp nhận, snapshot vị trí, dữ liệu/log giữ sau logout.
6. Kết quả kiểm tra với lệnh thật và trạng thái pass/fail/skipped/chưa chạy; lỗi có sẵn tách khỏi lỗi mới. Không chỉ ghi “đã test”.
7. Hướng dẫn ghép phần thay đổi cho thành viên khác theo thứ tự, các điểm dễ conflict và các phần cấu trúc cũ được giữ tương thích. Không hướng dẫn chép đè toàn bộ repository.
8. Các hạn chế, credential/test ngoài chưa có, hướng mở rộng Telegram callback/chuyển cấp/gọi tự động; không mô tả chúng là đã làm.
9. Cách tắt tính năng/worker mới và rollback code an toàn; chỉ rõ rollback code có thể cần giữ migration thêm mới. Không hướng dẫn xóa dữ liệu hoặc rollback migration phá hủy theo thói quen.

### B. `docs/HUONG_DAN_SU_DUNG_MVP_A_Z.md`

Viết cho thành viên chưa biết phần mới, theo từng bước đủ để tự cài và demo. Không yêu cầu người đọc phải nhớ cuộc trò chuyện hoặc có tài liệu cũ chưa kèm theo. Phải có:

1. Yêu cầu Node/npm/PostgreSQL và công cụ; xác minh phiên bản từ project thật. Ưu tiên lệnh phù hợp Windows PowerShell, ghi rõ biến thể nếu cần.
2. Mở repository, cài dependency, chuẩn bị database local/test, biến môi trường bắt buộc/tùy chọn và ý nghĩa; chỉ dùng placeholder.
3. Thứ tự generate Prisma/migrate/tạo admin/chạy API và frontend; các lệnh phải đúng script thực tế và thư mục chạy. Không giả có sẵn `.env.example`, runner hoặc seed nếu repository không có.
4. Thiết lập Telegram bot/đích nhận chung, bật kênh, những gì cần người dùng tự cung cấp; không đưa token thật vào hướng dẫn. Phân biệt cấu hình workspace với cấu hình cá nhân.
5. Tạo VAPID, bật Web Push, HTTPS/localhost, cấp quyền trình duyệt, bật/tắt nhận simulator, bật/tắt hiển thị chi tiết; nêu rõ Push MVP gắn phiên đăng nhập nên hết phiên/đăng xuất có thể ngừng nhận.
6. Đăng nhập theo role; URL/menu thật của từng trang và quyền tương ứng.
7. Tạo khu vực, tạo phòng, gán/bỏ gán thiết bị, sửa/lưu trữ/khôi phục; minh họa dữ liệu mẫu không chứa thông tin thật.
8. Tạo lịch bản tin, quy tắc biến động, giờ yên lặng; mô tả cửa sổ báo cáo, tình huống thiếu dữ liệu, cách xem lần gửi tiếp theo nếu có.
9. Tạo/chọn thiết bị mô phỏng đúng cách, chạy simulator, tạo sự cố theo kịch bản có kiểm soát, xem tin và xác nhận tiếp nhận; nhấn mạnh tiếp nhận không kết thúc sự cố.
10. Thêm liên hệ, kiểm tra danh bạ theo phạm vi, dùng nút sao chép/gọi nhanh; giải thích chỉ mở ứng dụng gọi.
11. Một kịch bản demo xuyên suốt 5–10 phút: bước làm → dữ liệu chuẩn bị → kết quả mong đợi → màn hình cần quan sát. Dùng mock/fake clock hoặc cấu hình test có kiểm soát cho lịch và gửi; không bịa sự cố đã xảy ra.
12. Tra cứu lịch sử gửi/lỗi/retry và phân biệt dịch vụ nhận yêu cầu với người dùng đã tiếp nhận.
13. Bảng xử lý lỗi thường gặp: chưa có dữ liệu, thiếu migration, phiên hết hạn, Push bị chặn, VAPID không khớp, Telegram thiếu đích/quyền, đang giờ yên lặng, worker chưa bật, danh bạ rỗng.
14. Cách kiểm thử lại, tắt kênh/worker, dừng server và ghép code cho nhóm. Tham chiếu các mục thay đổi trong báo cáo A khi cần; các thay đổi ảnh hưởng cách chạy phải có hướng dẫn ngay trong file B.

## 12. Câu trả lời cuối của Codex

Sau khi thực hiện, trả lời ngắn bằng tiếng Việt: đã làm gì, có bao nhiêu file mới/file cũ sửa nếu xác định được, kiểm tra nào đã chạy và giới hạn còn lại. Dẫn đường dẫn tới hai file bàn giao. Không nói “hoàn tất toàn bộ” khi còn module giả, chưa nối API/route, migration chưa có hoặc test bị bỏ qua mà không giải thích.

Ưu tiên bản đầu chạy được, dễ hiểu, dễ ghép code và báo cáo trung thực hơn số lượng tính năng trình diễn. Các quyết định nhỏ có thể tự chọn trong phạm vi tài liệu, ghi rõ trong báo cáo, không dừng liên tục để hỏi lại.
