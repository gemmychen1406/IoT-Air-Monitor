import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import webpush from 'web-push';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { createDatabase } from '@iot/database';
import { createApp } from '../src/app.js';
import { featureFixture } from './helpers.js';
import { webPushNotifier, deliverWebPush } from '../src/modules/web-push.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'authenticated Web Push subscriptions and outbox',
  () => {
    const db = createDatabase(process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/iot_test');
    const pair = webpush.generateVAPIDKeys();
    const config = { ...pair, subject: 'mailto:admin@example.com' };
    const options = {
      db,
      origin: 'http://localhost:5173',
      webPush: config,
      notify: webPushNotifier(),
    };
    const app = createApp(options);
    let f: Awaited<ReturnType<typeof featureFixture>>;
    const curve = createECDH('prime256v1');
    curve.generateKeys();
    const subscription = {
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      keys: {
        p256dh: curve.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
      expirationTime: null,
    };
    const input = {
      subscription,
      application_server_key: pair.publicKey,
      include_simulators: true,
    };
    beforeAll(async () => {
      f = await featureFixture(db, app, 'webpush');
    });
    afterAll(() => db.$disconnect());
    it('requires authentication, only exposes the public VAPID key and scopes subscription ownership', async () => {
      expect((await request(app).get('/api/v1/push/config')).status).toBe(401);
      const publicConfig = await request(app).get('/api/v1/push/config').set(f.headers.viewer!);
      expect(publicConfig.status).toBe(200);
      expect(publicConfig.body.data).toMatchObject({ enabled: true, public_key: pair.publicKey });
      expect(JSON.stringify(publicConfig.body)).not.toContain(pair.privateKey);
      const registered = await request(app)
        .post('/api/v1/push/subscription')
        .set(f.headers.viewer!)
        .send(input);
      expect(registered.status).toBe(200);
      expect(JSON.stringify(registered.body)).not.toContain(subscription.endpoint);
      expect(JSON.stringify(registered.body)).not.toContain(subscription.keys.auth);
      expect(
        (await request(app).post('/api/v1/push/subscription').set(f.headers.viewer!).send(input))
          .status,
      ).toBe(200);
      expect(
        await db.webPushSubscription.count({ where: { endpoint: subscription.endpoint } }),
      ).toBe(1);
      expect(
        (await request(app).post('/api/v1/push/subscription').set(f.headers.operator!).send(input))
          .status,
      ).toBe(409);
    });
    it('rejects arbitrary/private endpoint URLs and bad subscription keys or mismatched VAPID keys', async () => {
      for (const endpoint of [
        'http://127.0.0.1:4000/admin',
        'https://127.0.0.1/push',
        'https://fcm.googleapis.com.evil.example/send',
        'https://fcm.googleapis.com:8443/send',
        'https://user:secret@fcm.googleapis.com/fcm/send/token',
      ]) {
        expect(
          (
            await request(app)
              .post('/api/v1/push/subscription')
              .set(f.headers.viewer!)
              .send({ ...input, subscription: { ...subscription, endpoint } })
          ).status,
        ).toBe(422);
      }
      expect(
        (
          await request(app)
            .post('/api/v1/push/subscription')
            .set(f.headers.viewer!)
            .send({
              ...input,
              subscription: { ...subscription, keys: { p256dh: 'bad', auth: 'bad' } },
            })
        ).status,
      ).toBe(422);
      expect(
        (
          await request(app)
            .post('/api/v1/push/subscription')
            .set(f.headers.viewer!)
            .send({ ...input, application_server_key: webpush.generateVAPIDKeys().publicKey })
        ).status,
      ).toBe(409);
    });
    it('fans out a warning/critical once per opted-in subscription and leaves other browsers private', async () => {
      const p = f.payload(1);
      Object.assign(p.readings[0]!.alert_snapshot, {
        gas: 'active',
        co: 'active',
        flame: 'active',
      });
      const send = () => request(app).post('/api/v1/device/telemetry').set(f.deviceHeaders).send(p);
      expect((await send()).status).toBe(200);
      expect((await send()).status).toBe(200);
      expect(
        await db.webPushDelivery.count({ where: { incident: { deviceId: f.deviceId } } }),
      ).toBe(3);
      const bodies: string[] = [];
      const results = await Promise.all([
        deliverWebPush(db, config, async (_target, payload) => {
          bodies.push(JSON.stringify(payload));
          return { ok: true };
        }),
        deliverWebPush(db, config, async (_target, payload) => {
          bodies.push(JSON.stringify(payload));
          return { ok: true };
        }),
      ]);
      expect(results.every((r) => r.processed)).toBe(true);
      expect(bodies).toHaveLength(2);
      expect(
        bodies.every(
          (b) =>
            !b.includes(f.deviceId) &&
            !b.includes('password') &&
            !b.includes(subscription.endpoint),
        ),
      ).toBe(true);
      expect(await db.webPushDelivery.count({ where: { status: 'sent' } })).toBe(2);
    });
    it('backs off transient failures, then removes endpoints that the push provider reports as gone', async () => {
      const now = new Date();
      await deliverWebPush(
        db,
        config,
        async () => ({
          ok: false,
          retryable: true,
          code: 'WEB_PUSH_RATE_LIMITED',
          retryAfterSeconds: 30,
        }),
        now,
      );
      const retry = await db.webPushDelivery.findFirstOrThrow({ where: { status: 'pending' } });
      expect(retry.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(now.getTime() + 30000);
      await deliverWebPush(
        db,
        config,
        async () => ({ ok: false, retryable: false, gone: true, code: 'WEB_PUSH_GONE' }),
        new Date(now.getTime() + 31000),
      );
      expect(
        await db.webPushSubscription.count({ where: { endpoint: subscription.endpoint } }),
      ).toBe(0);
    });
    it('defaults simulator opt-in off, enqueues atomically, and revokes subscriptions on logout', async () => {
      const fresh = { subscription, application_server_key: pair.publicKey };
      expect(
        (await request(app).post('/api/v1/push/subscription').set(f.headers.viewer!).send(fresh))
          .status,
      ).toBe(200);
      const p = f.payload(2);
      p.readings[0]!.alert_snapshot.flame = 'normal';
      expect(
        (await request(app).post('/api/v1/device/telemetry').set(f.deviceHeaders).send(p)).status,
      ).toBe(200);
      const next = f.payload(3);
      next.readings[0]!.alert_snapshot.flame = 'active';
      expect(
        (await request(app).post('/api/v1/device/telemetry').set(f.deviceHeaders).send(next))
          .status,
      ).toBe(200);
      expect(await db.webPushDelivery.count()).toBe(0);
      await request(app).post('/api/v1/push/subscription').set(f.headers.viewer!).send(input);
      const conflict = {
        ...next,
        readings: [
          next.readings[0],
          {
            ...next.readings[0],
            sensors: {
              ...next.readings[0]!.sensors,
              dht11: { ...next.readings[0]!.sensors.dht11, temperature_c: 99 },
            },
          },
        ],
      };
      expect(
        (await request(app).post('/api/v1/device/telemetry').set(f.deviceHeaders).send(conflict))
          .status,
      ).toBe(409);
      expect(await db.webPushDelivery.count()).toBe(0);
      expect((await request(app).post('/api/v1/auth/logout').set(f.headers.viewer!)).status).toBe(
        204,
      );
      expect(await db.webPushSubscription.count()).toBe(0);
    });
    it('returns disabled configuration without exposing any secret when not enabled', async () => {
      const disabled = createApp({ db, origin: 'http://localhost:5173' });
      const result = await request(disabled).get('/api/v1/push/config').set(f.headers.admin!);
      expect(result.status).toBe(200);
      expect(result.body.data).toMatchObject({ enabled: false, public_key: null });
      expect(
        (
          await request(disabled)
            .post('/api/v1/push/subscription')
            .set(f.headers.admin!)
            .send(input)
        ).status,
      ).toBe(409);
    });
    it('does not send queued notifications once the owning session has expired', async () => {
      expect(
        (await request(app).post('/api/v1/push/subscription').set(f.headers.admin!).send(input))
          .status,
      ).toBe(200);
      const sub = await db.webPushSubscription.findUniqueOrThrow({
        where: {
          endpointHash: (await request(app).get('/api/v1/push/subscription').set(f.headers.admin!))
            .body.data.endpoint_hash,
        },
      });
      const incident = await db.alertIncident.findFirstOrThrow({ where: { deviceId: f.deviceId } });
      await db.webPushDelivery.create({
        data: {
          incidentId: incident.id,
          subscriptionId: sub.id,
          severity: 'warning',
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      await db.session.update({
        where: { id: sub.sessionId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      let sent = 0;
      await deliverWebPush(db, config, async () => {
        sent++;
        return { ok: true };
      });
      expect(sent).toBe(0);
      expect(
        (await db.webPushDelivery.findFirstOrThrow({ where: { subscriptionId: sub.id } })).status,
      ).toBe('skipped');
    });
  },
);
