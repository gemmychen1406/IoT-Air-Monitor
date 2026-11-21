# Bật cảnh báo cho một gia đình

Mỗi gia đình dùng một website HTTPS, một API, một database và một nhóm Telegram riêng. Trước khi cấp tài khoản cho thành viên, kiểm tra hai rewrite `/api` và `/socket.io` trong `vercel.json` trỏ tới đúng API Railway của gia đình. Trên Railway, `WEB_ORIGIN` phải là origin Vercel của gia đình và `DATABASE_URL` phải thuộc database tương ứng.

## Web Push

1. Quản trị viên chạy `npm run webpush:keys` ở máy riêng một lần. Lưu cặp khóa được in ra vào biến Railway `WEB_PUSH_VAPID_PUBLIC_KEY` và `WEB_PUSH_VAPID_PRIVATE_KEY`. Đặt `WEB_PUSH_VAPID_SUBJECT=mailto:dia-chi-lien-he@example.org` bằng địa chỉ liên hệ thực và `WEB_PUSH_ENABLED=true`. Giữ nguyên cặp khóa khi phát hành phiên bản mới.
2. Khởi động lại API. Mỗi người đăng nhập bằng trình duyệt muốn dùng, mở **Cài đặt → Thông báo → Bật Web Push**, chọn **Cho phép** và kiểm tra trạng thái **Đang nhận thông báo trên trình duyệt này**. Khi dùng điện thoại hoặc trình duyệt khác, lặp lại bước này. Trên iPhone/iPad từ 16.4, thêm web vào Màn hình chính rồi mở bằng biểu tượng AirGuard. Nếu đã chặn thông báo, mở quyền của website trong trình duyệt để bật lại. [WebKit hướng dẫn Web Push trên iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
3. Thành viên có thể chọn thiết bị nhận cảnh báo. Mặc định nhận các thiết bị thật của gia đình. Đóng tab vẫn có thể nhận tùy hệ điều hành. Đăng xuất hoặc bấm **Tắt Web Push** sẽ ngắt đăng ký trên trình duyệt đó.

## Telegram

1. Tạo bot bằng `/newbot` với **@BotFather**, lưu token vào `TELEGRAM_BOT_TOKEN` trên backend của gia đình. Tạo nhóm riêng, thêm bot vào đúng nhóm và cho phép bot gửi tin. Quản trị viên nhóm có thể tự tạo link mời. [Telegram hướng dẫn tạo bot](https://core.telegram.org/bots/faq)
2. Lấy **chat ID dạng số** của nhóm và đặt vào `TELEGRAM_CHAT_ID`, giữ nguyên dấu âm. Với bot mới, gửi `/start@TenBotCuaBan` trong nhóm rồi gọi phương thức `getUpdates`. Đọc trường `message.chat.id` ở bản ghi có đúng tên nhóm. Nếu token đã nằm trong `.env` cục bộ, có thể dùng lệnh sau từ gốc repo. Lệnh chỉ in tên và ID nhóm nhận được, không in token hay tin nhắn. Bot đang dùng webhook sẽ không hỗ trợ `getUpdates`. [Telegram Bot API](https://core.telegram.org/bots/api#getupdates)

   ```sh
   node --env-file=.env --input-type=module -e "const r=await fetch('https://api.telegram.org/bot'+process.env.TELEGRAM_BOT_TOKEN+'/getUpdates'); const d=await r.json(); if(d.ok!==true) throw Error('getUpdates HTTP '+r.status); for(const u of d.result){const c=u.message?.chat; if(['group','supergroup'].includes(c?.type)) console.log(c.title,c.id)}"
   ```

3. Trong cài đặt **của cùng nhóm Telegram**, tạo link mời riêng dạng `https://t.me/+…`. Có thể bật duyệt người tham gia. Đặt link vào `TELEGRAM_GROUP_INVITE_URL` trên Railway, đặt `TELEGRAM_ENABLED=true`, rồi khởi động lại API. Chat ID chọn nơi bot gửi tin, link mời chọn nơi thành viên tham gia. Hãy mở thử link để xác nhận cả hai thuộc cùng nhóm.
4. Cấp tài khoản AirGuard của gia đình cho người mới. Sau khi đăng nhập, họ mở **Cài đặt → Thông báo → Mở nhóm Telegram gia đình**, rồi bấm **Tham gia** hoặc gửi yêu cầu để quản trị viên duyệt. Khi chưa cấu hình link, trang sẽ hướng dẫn liên hệ quản trị viên. Thành viên đã vào nhóm tiếp tục nhận tin khi link hết hạn. Để thu hồi quyền của người đã vào nhóm, quản trị viên cần xử lý cả tài khoản web và thành viên trong Telegram. [Quản lý link mời Telegram](https://core.telegram.org/api/invites)

## Kiểm tra lần đầu

Dùng bản staging của gia đình với nhóm Telegram và điện thoại thử. Đăng ký Web Push trên điện thoại, chọn **Nhận cả cảnh báo mô phỏng** rồi lưu. Đặt `TELEGRAM_INCLUDE_SIMULATORS=true` trên API staging và khởi động lại. Với trạm simulator đã cấp key, chạy `npm run simulate -- --scenario gas --duration 60 --repeat false`. Dùng API đang chạy với cấu hình kênh thật; `diagnostics:local` chủ động tắt kênh bên ngoài.

Đối chiếu cùng sự cố ở **Cảnh báo & sự cố**, **Lịch sử gửi**, nhóm Telegram và màn hình thông báo của điện thoại. Trạng thái **Dịch vụ đã chấp nhận** ghi nhận phản hồi từ nhà cung cấp. Xác nhận nhận thực tế bằng cách mở tin trên thiết bị. Sau buổi thử, tắt nhận mô phỏng nếu gia đình chỉ muốn nhận cảnh báo từ phần cứng.
