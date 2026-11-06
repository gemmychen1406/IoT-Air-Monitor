import { z } from 'zod';
import {
  telemetrySchema,
  createDeviceSchema,
  patchDeviceSchema,
  credentialSchema,
  rotationSchema,
  updateConfigSchema,
  configAckSchema,
  heartbeatSchema,
  deviceEventsSchema,
  historyQuerySchema,
  analyticsQuerySchema,
  exportQuerySchema,
  incidentQuerySchema,
  createUserSchema,
  updateUserSchema,
  changePasswordSchema,
  changeEmailSchema,
  registerPushSchema,
} from '@iot/contracts';

const success = { description: 'Response envelope: data + meta(request_id, server_time).' };
const errors = {
  '401': { description: 'Không có phiên hoặc key hợp lệ.' },
  '403': { description: 'Không có quyền hoặc Origin không được phép.' },
  '404': { description: 'Không tìm thấy tài nguyên.' },
  '409': {
    description: 'Identity, boot, incident hoặc config version conflict; transaction rollback.',
  },
  '422': { description: 'Payload hoặc query không hợp lệ.' },
  '429': { description: 'Rate limit; tôn trọng Retry-After.' },
  '503': { description: 'Dependency không sẵn sàng; retry có backoff.' },
};
const operation = (
  summary: string,
  security: Record<string, string[]>[] = [{ UserSession: [] }],
) => ({
  summary,
  security,
  responses: { '200': success, ...errors },
});
const deviceId = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const keyId = {
  name: 'keyId',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{16}$' },
};
const requestBody = (schema: z.ZodType) => ({
  required: true,
  content: { 'application/json': { schema: z.toJSONSchema(schema, { io: 'input' }) } },
});
const queryParameters = (schema: z.ZodType) => {
  const json = z.toJSONSchema(schema, { io: 'input' });
  return Object.entries(json.properties ?? {}).map(([name, value]) => ({
    name,
    in: 'query',
    required: json.required?.includes(name) ?? false,
    schema: value,
  }));
};
const deviceOperation = (summary: string) => operation(summary, [{ DeviceKey: [] as string[] }]);

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'AirGuard Local API',
    version: '0.5.0',
    description:
      'Local: auth/RBAC, thiết bị/key/config, raw telemetry, incident/event/acknowledgement, analytics và CSV. Web dùng cookie HttpOnly; mọi request ghi của web (kể cả login) cần X-Requested-With: AirGuard và Origin thuộc allowlist. Chưa có firmware, calibrated PPM hoặc cloud. Khoảng lọc [from,to), tối đa 90 ngày; chi tiết semantic tại docs/api/monitoring.md.',
  },
  paths: {
    '/api/v1/push/config': {
      get: operation('Web Push enabled/public VAPID key; yêu cầu đăng nhập, không trả private key'),
    },
    '/api/v1/push/subscription': {
      get: operation(
        'Đăng ký phiên hiện tại: ID/hash/tùy chọn/expiry; không trả endpoint/auth keys',
      ),
      post: {
        ...operation(
          'Opt-in Web Push cho phiên hiện tại; simulator mặc định tắt, chỉ endpoint HTTPS trong allowlist',
        ),
        requestBody: requestBody(registerPushSchema),
      },
      delete: {
        ...operation('Hủy đăng ký của phiên hiện tại'),
        responses: { '204': success, ...errors },
      },
    },
    '/api/v1/users/me': {
      get: operation('Thông tin tài khoản hiện tại'),
      patch: {
        ...operation('Đổi email với mật khẩu hiện tại; thu hồi mọi session'),
        requestBody: requestBody(changeEmailSchema),
      },
    },
    '/api/v1/users/me/password': {
      put: {
        ...operation('Đổi mật khẩu, kiểm tra mật khẩu hiện tại, thu hồi mọi session/socket'),
        requestBody: requestBody(changePasswordSchema),
        responses: { '204': success, ...errors },
      },
    },
    '/api/v1/users': {
      get: {
        ...operation('Admin: danh sách tài khoản theo UUID, cursor + limit 1–100'),
        parameters: queryParameters(
          z.strictObject({
            cursor: z.uuid().optional(),
            limit: z.coerce.number().int().min(1).max(100).default(30),
          }),
        ),
      },
      post: {
        ...operation('Admin: tạo tài khoản, email chuẩn hóa, mật khẩu 12–128 ký tự'),
        requestBody: requestBody(createUserSchema),
        responses: { '201': success, ...errors },
      },
    },
    '/api/v1/users/{id}': {
      parameters: [deviceId],
      patch: {
        ...operation(
          'Admin: đổi role/active hoặc reset mật khẩu; thu hồi sessions, chặn tự khóa/hạ quyền và admin cuối cùng',
        ),
        requestBody: requestBody(updateUserSchema),
      },
    },
    '/api/v1/audit-logs': {
      get: {
        ...operation('Admin: nhật ký đã loại secrets; cursor theo ID giảm dần'),
        parameters: queryParameters(
          z.strictObject({
            cursor: z.string().optional(),
            limit: z.coerce.number().int().min(1).max(100).default(30),
            resource_type: z.enum(['user', 'device', 'maintenance']).optional(),
            resource_id: z.string().max(100).optional(),
            device_id: z.uuid().optional(),
            action: z.string().max(100).optional(),
          }),
        ),
      },
    },
    '/health/live': { get: { ...operation('Process health', []), responses: { '200': success } } },
    '/health/ready': { get: operation('PostgreSQL readiness', []) },
    '/api/v1/auth/login': {
      post: {
        ...operation('Đăng nhập, đặt cookie HttpOnly 8 giờ; JSON chỉ trả user và expires_at', []),
        parameters: [
          {
            name: 'X-Requested-With',
            in: 'header',
            required: true,
            schema: { type: 'string', const: 'AirGuard' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 1, maxLength: 128 },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/auth/session': { get: operation('Thông tin phiên hiện tại') },
    '/api/v1/auth/logout': {
      post: {
        ...operation('Thu hồi phiên và ngắt socket'),
        responses: { '204': { description: 'Đã đăng xuất.' }, ...errors },
      },
    },
    '/api/v1/devices': {
      get: operation('Tối đa 100 thiết bị của nhóm; kèm latest và source_kind do server quản lý'),
      post: {
        ...operation('Đăng ký thiết bị — chỉ admin'),
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateDevice' } },
          },
        },
        responses: { '201': success, ...errors },
      },
    },
    '/api/v1/devices/{id}/credentials': {
      parameters: [deviceId],
      get: {
        ...operation(
          'Metadata keys — chỉ admin; cursor=key_id, limit 1–100 (mặc định 30), không trả secret/hash',
        ),
        parameters: queryParameters(
          z.strictObject({
            limit: z.coerce.number().int().min(1).max(100).default(30),
            cursor: z.string().optional(),
          }),
        ),
      },
      post: {
        ...operation('Cấp key riêng — chỉ admin, secret trả một lần'),
        requestBody: requestBody(credentialSchema),
        responses: { '201': success, ...errors },
      },
    },
    '/api/v1/devices/{id}/credentials/{keyId}': {
      parameters: [
        deviceId,
        { name: 'keyId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      delete: { ...operation('Thu hồi key — chỉ admin'), responses: { '204': success, ...errors } },
    },
    '/api/v1/devices/{id}/readings/latest': {
      parameters: [deviceId],
      get: operation('Snapshot theo boot/sequence mới nhất; null nếu chưa có'),
    },
    '/api/v1/devices/{id}/readings': {
      parameters: [deviceId],
      get: {
        ...operation('History theo thứ tự nhận giảm dần; meta.next_cursor để tải tiếp'),
        parameters: queryParameters(historyQuerySchema),
      },
    },
    '/api/v1/device/telemetry': {
      post: {
        ...operation(
          'Nhận 1–20 mẫu raw, 64 KiB; ACK sau commit. Retry phải giữ nguyên record.',
          [],
        ),
        security: [{ DeviceKey: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Telemetry' } } },
        },
        responses: {
          ...errors,
          '200': { description: 'data.accepted[] gồm boot_id, seq, duplicate.' },
          '409': { description: 'Identity/boot conflict; toàn batch rollback.' },
          '413': { description: 'Payload quá lớn.' },
        },
      },
    },
    '/api/v1/devices/{id}': {
      parameters: [deviceId],
      get: operation('Chi tiết thiết bị, kể cả đã lưu trữ'),
      patch: {
        ...operation('Sửa metadata/lưu trữ/khôi phục — chỉ admin; source_kind bất biến'),
        requestBody: requestBody(patchDeviceSchema),
      },
    },
    '/api/v1/devices/{id}/credentials/{keyId}/rotate': {
      parameters: [deviceId, keyId],
      post: {
        ...operation('Rotation — admin; overlap 1–1440 phút, secret mới hiển thị một lần'),
        requestBody: requestBody(rotationSchema),
        responses: { '201': success, ...errors },
      },
    },
    '/api/v1/devices/{id}/config': {
      parameters: [deviceId],
      get: operation('Desired/applied version, 100 versions và 100 ACK gần nhất'),
      put: {
        ...operation(
          'Tạo version bất biến — admin, expected_version chống lost update; chỉ chu kỳ truyền',
        ),
        requestBody: requestBody(updateConfigSchema),
      },
    },
    '/api/v1/devices/{id}/status-history': {
      parameters: [deviceId],
      get: {
        ...operation('Lịch sử online/offline bền; limit 1–100, cursor=id'),
        parameters: queryParameters(
          z.strictObject({
            limit: z.coerce.number().int().min(1).max(100).default(30),
            cursor: z.string().optional(),
          }),
        ),
      },
    },
    '/api/v1/device/config': {
      get: {
        ...deviceOperation('Tải desired config/version/SHA-256; If-None-Match hỗ trợ ETag'),
        parameters: [{ name: 'If-None-Match', in: 'header', schema: { type: 'string' } }],
        responses: {
          '200': success,
          '304': { description: 'Không đổi, không có body.' },
          ...errors,
        },
      },
    },
    '/api/v1/device/config/ack': {
      post: {
        ...deviceOperation(
          'ACK applied/rejected, idempotent theo device/version/status; version/hash phải đúng',
        ),
        requestBody: requestBody(configAckSchema),
      },
    },
    '/api/v1/device/heartbeat': {
      post: {
        ...deviceOperation('Ghi nhận liên lạc, không tạo mẫu sensor; boot identity được kiểm tra'),
        requestBody: requestBody(heartbeatSchema),
      },
    },
    '/api/v1/device/events': {
      post: {
        ...deviceOperation(
          '1–50 durable events; retry giữ nguyên event_id/nội dung, hỗ trợ ended đến trước started',
        ),
        requestBody: requestBody(deviceEventsSchema),
      },
    },
    '/api/v1/alerts/states': {
      get: {
        ...operation('Trạng thái đã quan sát, unresolved incident không tự đóng khi offline'),
        parameters: [
          { name: 'device_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
      },
    },
    '/api/v1/alerts/incidents': {
      get: {
        ...operation('Lọc sự cố, thứ tự first-created giảm dần; meta.next_cursor'),
        parameters: queryParameters(incidentQuerySchema),
      },
    },
    '/api/v1/alerts/incidents/{id}': {
      parameters: [deviceId],
      get: operation('Chi tiết incident, acknowledgement và timeline theo boot/seq'),
    },
    '/api/v1/alerts/incidents/{id}/acknowledgements': {
      parameters: [deviceId],
      post: {
        ...operation(
          'Operator/admin xác nhận đã xem; lần đầu thắng, không tắt còi hoặc kết thúc incident',
        ),
        requestBody: requestBody(z.strictObject({ note: z.string().trim().max(500).default('') })),
      },
    },
    '/api/v1/alerts/events': {
      get: {
        ...operation(
          'Event log theo reception ID; from/to theo server nhận; lọc condition/severity/status',
        ),
        parameters: queryParameters(incidentQuerySchema),
      },
    },
    '/api/v1/devices/{id}/analytics': {
      parameters: [deviceId],
      get: {
        ...operation(
          'Min/max/average/count theo bucket UTC, tối đa 2000 điểm; ADC khác adc_bits không được gộp',
        ),
        parameters: queryParameters(analyticsQuerySchema),
      },
    },
    '/api/v1/devices/{id}/readings/export': {
      parameters: [deviceId],
      get: {
        ...operation(
          'CSV UTF-8 BOM, tối đa 100.000 dòng, chống formula injection, gồm quality/timestamps/source',
        ),
        parameters: queryParameters(exportQuerySchema),
        responses: {
          '200': {
            description: 'File CSV cùng bộ lọc thời gian; tất cả sensor.',
            content: { 'text/csv': { schema: { type: 'string' } } },
          },
          '413': { description: 'Vượt 100.000 dòng, cần thu hẹp khoảng thời gian.' },
          ...errors,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      UserSession: {
        type: 'apiKey',
        in: 'cookie',
        name: 'iot_session',
        description:
          'Cookie HttpOnly từ login, SameSite=Lax, hết hạn 8 giờ; Secure khi dùng HTTPS/production. JSON không trả token.',
      },
      DeviceKey: {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
        description: 'DeviceKey <key_id>.<secret>',
      },
    },
    schemas: {
      Telemetry: z.toJSONSchema(telemetrySchema),
      CreateDevice: z.toJSONSchema(createDeviceSchema),
    },
  },
};
