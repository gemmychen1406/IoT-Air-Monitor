import webpush from 'web-push';
const pair = webpush.generateVAPIDKeys();
console.log(
  'Tạo khóa mới. Giữ nguyên cặp khóa qua các lần restart; thay khóa sẽ cần đăng ký lại trình duyệt. Không commit/chia sẻ private key hoặc ảnh terminal này.',
);
console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${pair.publicKey}`);
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY=${pair.privateKey}`);
console.log(
  'Lưu vào .env ignored. Điền WEB_PUSH_VAPID_SUBJECT=mailto:email-lien-he-cua-ban và WEB_PUSH_ENABLED=true để bật.',
);
