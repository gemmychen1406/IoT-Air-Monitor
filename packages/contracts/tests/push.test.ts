import { it, expect } from 'vitest';
import { pushEndpointSchema } from '../src/push.js';

it('supports the Chrome, Firefox, Safari and Windows/Edge push providers without accepting arbitrary URLs', () => {
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/example-only',
    'https://updates.push.services.mozilla.com/wpush/v2/example-only',
    'https://web.push.apple.com/Q/example-only',
    'https://wns2-example.notify.windows.com/w/?token=example-only',
  ])
    expect(pushEndpointSchema.safeParse(endpoint).success).toBe(true);
  for (const endpoint of [
    'https://evil.example/send',
    'https://fcm.googleapis.com.evil.example/fcm/send/token',
    'https://notify.windows.com.evil.example/w/?token=x',
    'https://127.0.0.1/w/?token=x',
    'http://fcm.googleapis.com/fcm/send/x',
    'https://user:secret@fcm.googleapis.com/fcm/send/x',
    'https://fcm.googleapis.com/fcm/send/x#fragment',
  ])
    expect(pushEndpointSchema.safeParse(endpoint).success).toBe(false);
});
