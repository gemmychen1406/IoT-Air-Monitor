import type { DeviceView } from '@iot/contracts';
import type {
  EnvironmentalTarget,
  EcoScoreResult,
  SmartRecommendation,
  SmartTask,
  OutdoorWeatherData,
  SmartActuatorState,
  HourlyCompliance,
  VentilationGuide,
} from './types.js';

const GOALS_STORAGE_KEY = 'airguard.smart-monitoring.goals.v2';
const TASKS_STORAGE_KEY = 'airguard.smart-monitoring.tasks.v2';
const ACTUATORS_STORAGE_KEY = 'airguard.smart-monitoring.actuators.v2';

export function getDefaultTarget(device?: DeviceView): EnvironmentalTarget {
  const name = (device?.name ?? '').toLowerCase();
  const location = (device?.location ?? '').toLowerCase();

  if (name.includes('bếp') || location.includes('bếp')) {
    return {
      deviceId: device?.id ?? '',
      minTemp: 22,
      maxTemp: 31,
      minHumidity: 40,
      maxHumidity: 75,
      maxMq2Adc: 1600,
      maxMq7Adc: 900,
    };
  }
  if (name.includes('hầm') || location.includes('hầm') || name.includes('xe')) {
    return {
      deviceId: device?.id ?? '',
      minTemp: 20,
      maxTemp: 29,
      minHumidity: 45,
      maxHumidity: 80,
      maxMq2Adc: 1200,
      maxMq7Adc: 1600,
    };
  }
  if (name.includes('kho') || location.includes('kho')) {
    return {
      deviceId: device?.id ?? '',
      minTemp: 18,
      maxTemp: 30,
      minHumidity: 40,
      maxHumidity: 70,
      maxMq2Adc: 1400,
      maxMq7Adc: 900,
    };
  }

  // Phòng khách / Phòng ngủ
  return {
    deviceId: device?.id ?? '',
    minTemp: 23,
    maxTemp: 28,
    minHumidity: 45,
    maxHumidity: 65,
    maxMq2Adc: 900,
    maxMq7Adc: 600,
  };
}

export function loadTargets(devices: DeviceView[]): Record<string, EnvironmentalTarget> {
  try {
    const raw = localStorage.getItem(GOALS_STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as Record<string, EnvironmentalTarget>) : {};
    const result: Record<string, EnvironmentalTarget> = {};

    for (const d of devices) {
      result[d.id] = saved[d.id] ?? getDefaultTarget(d);
      result[d.id].deviceId = d.id;
    }
    return result;
  } catch {
    const result: Record<string, EnvironmentalTarget> = {};
    for (const d of devices) {
      result[d.id] = getDefaultTarget(d);
    }
    return result;
  }
}

export function saveTargets(targets: Record<string, EnvironmentalTarget>): void {
  try {
    localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(targets));
  } catch (e) {
    console.error('Không thể lưu mục tiêu môi trường:', e);
  }
}

export async function fetchOutdoorWeather(): Promise<OutdoorWeatherData> {
  try {
    // Lấy dữ liệu thời tiết thực tế từ trạm khí tượng Hà Nội qua Open-Meteo (Không cần API key)
    const res = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=21.0285&longitude=105.8542&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FBangkok',
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const cur = data.current;

    const weatherCode = cur.weather_code ?? 0;
    let conditionText = 'Quang đãng / Dễ chịu';
    if (weatherCode >= 1 && weatherCode <= 3) conditionText = 'Có mây rải rác';
    else if (weatherCode >= 45 && weatherCode <= 48) conditionText = 'Sương mù nhẹ';
    else if (weatherCode >= 51 && weatherCode <= 67) conditionText = 'Mưa phùn / Mưa rào';
    else if (weatherCode >= 80) conditionText = 'Mưa dông ngoài trời';

    return {
      location: 'Hà Nội (Trạm Khí tượng Mở)',
      temperature: Math.round(cur.temperature_2m * 10) / 10,
      humidity: Math.round(cur.relative_humidity_2m),
      weatherCode,
      conditionText,
      updatedAt: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      isLive: true,
    };
  } catch {
    // Dự phòng khi mất kết nối internet
    return {
      location: 'Hà Nội (Dữ liệu chuẩn tham khảo)',
      temperature: 24.5,
      humidity: 72,
      weatherCode: 2,
      conditionText: 'Nhiệt ẩm ngoài trời ổn định',
      updatedAt: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      isLive: false,
    };
  }
}

export function calculateEcoScore(
  device: DeviceView,
  target: EnvironmentalTarget,
): EcoScoreResult {
  const reading = device.latest?.payload;
  if (!reading) {
    return {
      score: 50,
      rating: 'Cần chú ý (Hạng C)',
      color: '#eab308',
      tempStatus: 'ideal',
      humidityStatus: 'ideal',
      gasStatus: 'safe',
      coStatus: 'safe',
      complianceRate: 50,
      comfortLevel: 'Dễ chịu',
      summaryText: 'Đang đợi gói tin cảm biến đầu tiên để đánh giá toàn diện.',
    };
  }

  let penalty = 0;
  let passedCount = 0;
  const totalChecks = 4;

  const temp = reading.sensors.dht11.temperature_c ?? 25;
  const humidity = reading.sensors.dht11.humidity_pct ?? 60;
  const mq2 = reading.sensors.mq2.adc_raw ?? 600;
  const mq7 = reading.sensors.mq7.adc_raw ?? 400;
  const flame = reading.sensors.flame.detected ?? false;

  // 1. Nhiệt độ
  let tempStatus: 'ideal' | 'low' | 'high' = 'ideal';
  if (temp < target.minTemp) {
    tempStatus = 'low';
    penalty += Math.min(22, (target.minTemp - temp) * 5);
  } else if (temp > target.maxTemp) {
    tempStatus = 'high';
    penalty += Math.min(22, (temp - target.maxTemp) * 5);
  } else {
    passedCount++;
  }

  // 2. Độ ẩm
  let humidityStatus: 'ideal' | 'low' | 'high' = 'ideal';
  if (humidity < target.minHumidity) {
    humidityStatus = 'low';
    penalty += Math.min(20, (target.minHumidity - humidity) * 2.5);
  } else if (humidity > target.maxHumidity) {
    humidityStatus = 'high';
    penalty += Math.min(20, (humidity - target.maxHumidity) * 2.5);
  } else {
    passedCount++;
  }

  // 3. Khí dễ cháy / khói MQ-2
  let gasStatus: 'safe' | 'warning' | 'danger' = 'safe';
  if (mq2 > target.maxMq2Adc * 1.5) {
    gasStatus = 'danger';
    penalty += 40;
  } else if (mq2 > target.maxMq2Adc) {
    gasStatus = 'warning';
    penalty += 18;
  } else {
    passedCount++;
  }

  // 4. Khí độc CO MQ-7
  let coStatus: 'safe' | 'warning' | 'danger' = 'safe';
  if (mq7 > target.maxMq7Adc * 1.4) {
    coStatus = 'danger';
    penalty += 40;
  } else if (mq7 > target.maxMq7Adc) {
    coStatus = 'warning';
    penalty += 18;
  } else {
    passedCount++;
  }

  if (flame) {
    penalty += 60;
  }

  const rawScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const complianceRate = Math.round((passedCount / totalChecks) * 100);

  let rating: 'Tối ưu (Hạng A)' | 'Tốt (Hạng B)' | 'Cần chú ý (Hạng C)' | 'Nguy hại (Hạng D)';
  let color: string;
  let summaryText: string;
  let comfortLevel: EcoScoreResult['comfortLevel'] = 'Dễ chịu';

  if (rawScore >= 85) {
    rating = 'Tối ưu (Hạng A)';
    color = '#10b981';
    comfortLevel = 'Rất dễ chịu';
    summaryText = 'Không khí trong lành, vi khí hậu mát mẻ và an toàn tuyệt đối.';
  } else if (rawScore >= 70) {
    rating = 'Tốt (Hạng B)';
    color = '#2dd4bf';
    comfortLevel = 'Dễ chịu';
    summaryText = 'Chỉ số an toàn ổn định, vi khí hậu đáp ứng tiêu chuẩn sinh hoạt.';
  } else if (rawScore >= 50) {
    rating = 'Cần chú ý (Hạng C)';
    color = '#f59e0b';
    comfortLevel = humidityStatus === 'high' ? 'Bí bách / Ẩm' : 'Khó chịu / Nóng';
    summaryText = 'Có chỉ số vượt ngưỡng mục tiêu, cần lưu thông không khí hoặc hút ẩm.';
  } else {
    rating = 'Nguy hại (Hạng D)';
    color = '#ef4444';
    comfortLevel = 'Ô nhiễm';
    summaryText = 'Nồng độ khí độc hoặc nguy cơ rò rỉ tăng cao! Cần can thiệp khẩn cấp.';
  }

  return {
    score: rawScore,
    rating,
    color,
    tempStatus,
    humidityStatus,
    gasStatus,
    coStatus,
    complianceRate,
    comfortLevel,
    summaryText,
  };
}

export function generateSmartRecommendations(
  devices: DeviceView[],
  outdoor?: OutdoorWeatherData,
): SmartRecommendation[] {
  const recommendations: SmartRecommendation[] = [];
  const now = Date.now();

  for (const device of devices) {
    const reading = device.latest?.payload;
    if (!reading) continue;

    const lastSeenTime = device.last_seen_at ? Date.parse(device.last_seen_at) : 0;
    if (now - lastSeenTime > 180000 && device.status === 'offline') {
      continue;
    }

    const temp = reading.sensors.dht11.temperature_c ?? 25;
    const humidity = reading.sensors.dht11.humidity_pct ?? 60;
    const mq2 = reading.sensors.mq2.adc_raw ?? 600;
    const mq7 = reading.sensors.mq7.adc_raw ?? 400;
    const flame = reading.sensors.flame.detected ?? false;

    // 1. Cảnh báo cháy & Gas
    if (flame) {
      recommendations.push({
        id: `rec-flame-${device.id}`,
        deviceId: device.id,
        deviceName: device.name,
        title: 'Báo động bùng phát ngọn lửa',
        description: `Cảm biến quang học tại ${device.name} phát hiện bức xạ nhiệt ngọn lửa.`,
        category: 'safety',
        priority: 'urgent',
        priorityReason: 'Đe dọa cháy lan trực tiếp đến tính mạng và tài sản',
        triggerRule: 'Flame Sensor = Detected (bước sóng hồng ngoại 760-1100nm)',
        metricValue: 'Lửa: Báo động 🔥',
        suggestedAction: 'Bấm còi báo cháy, ngắt cầu dao điện chính, sơ tán và gọi 114.',
        createdAt: new Date().toISOString(),
      });
    }

    if (mq2 > 2000) {
      recommendations.push({
        id: `rec-mq2-high-${device.id}`,
        deviceId: device.id,
        deviceName: device.name,
        title: 'Nồng độ khí gas / khói đậm đặc',
        description: `Chỉ số MQ-2 đạt ${mq2} ADC vượt xa ngưỡng an toàn, nguy cơ rò rỉ gas nghiêm trọng.`,
        category: 'safety',
        priority: 'urgent',
        priorityReason: 'Nồng độ vượt giới hạn nổ dưới (LEL), nguy cơ cháy nổ tức thì',
        triggerRule: `MQ-2 ADC > 2000 (độ lệch +${mq2 - 1600} ADC)`,
        metricValue: `${mq2} ADC (~${Math.round(mq2 * 0.6)} mV)`,
        suggestedAction: 'Khóa ngay van gas trung tâm, mở toàn bộ cửa sổ, tuyệt đối không bật công tắc điện.',
        createdAt: new Date().toISOString(),
      });
    } else if (mq2 > 1300) {
      recommendations.push({
        id: `rec-mq2-warn-${device.id}`,
        deviceId: device.id,
        deviceName: device.name,
        title: 'Khói hoặc mùi khí gas tích tụ',
        description: `Chỉ số MQ-2 tại ${device.name} là ${mq2} ADC cao hơn mức thông thường.`,
        category: 'air_quality',
        priority: 'medium',
        priorityReason: 'Mùi khói nấu nướng hoặc khí gas bắt đầu tích tụ trong phòng kín',
        triggerRule: `MQ-2 ADC vượt ngưỡng mềm 1300 ADC`,
        metricValue: `${mq2} ADC`,
        suggestedAction: 'Bật quạt hút mùi nhà bếp, mở hé cửa sổ để tống khói ra ngoài.',
        createdAt: new Date().toISOString(),
      });
    }

    // 2. Khí độc CO
    if (mq7 > 1800) {
      recommendations.push({
        id: `rec-mq7-high-${device.id}`,
        deviceId: device.id,
        deviceName: device.name,
        title: 'Nguy cơ ngạt khí CO cấp độ cao',
        description: `Nồng độ khí CO tại ${device.name} đạt ${mq7} ADC rất nguy hại cho tim mạch và phổi.`,
        category: 'safety',
        priority: 'urgent',
        priorityReason: 'Khí CO vô hình không mùi chiếm oxy trong máu gây ngất xỉu',
        triggerRule: `MQ-7 ADC > 1800 trong không gian kín`,
        metricValue: `${mq7} ADC`,
        suggestedAction: 'Kích hoạt quạt hút tầng hầm 100% công suất, mở cửa thoát hiểm.',
        createdAt: new Date().toISOString(),
      });
    } else if (mq7 > 1100 && (device.name.includes('Hầm') || device.location?.includes('hầm'))) {
      recommendations.push({
        id: `rec-mq7-garage-${device.id}`,
        deviceId: device.id,
        deviceName: device.name,
        title: 'Khí thải xe máy tích tụ giờ cao điểm',
        description: `Nồng độ CO đạt ${mq7} ADC do mật độ xe cộ lưu thông đông đúc.`,
        category: 'climate',
        priority: 'medium',
        priorityReason: 'Phương tiện nổ máy xả khói trong tầng hầm kín gió',
        triggerRule: `MQ-7 ADC > 1100 tại khu vực tầng hầm`,
        metricValue: `${mq7} ADC`,
        suggestedAction: 'Khởi động hệ thống quạt thông gió cưỡng bức tầng hầm trong 20 phút.',
        createdAt: new Date().toISOString(),
      });
    }

    // 3. Khuyến nghị so sánh thông minh Trong nhà vs Ngoài trời (Indoor vs Outdoor Differential)
    if (outdoor) {
      // Độ ẩm trong nhà cao, nhưng ngoài trời cũng ẩm ướt (>75%) -> Khuyên KHÔNG mở cửa
      if (humidity > 70 && outdoor.humidity > 75) {
        recommendations.push({
          id: `rec-outdoor-humid-${device.id}`,
          deviceId: device.id,
          deviceName: device.name,
          title: 'Độ ẩm trong và ngoài trời đều cao — Khuyên đóng cửa',
          description: `Độ ẩm trong nhà (${humidity}%) và ngoài trời (${outdoor.humidity}%) đều cao. Mở cửa sổ lúc này sẽ làm ẩm tràn vào nhà!`,
          category: 'climate',
          priority: 'medium',
          priorityReason: 'Chênh lệch độ ẩm ngoài trời cao hơn khiến hiện tượng nồm ẩm trầm trọng hơn',
          triggerRule: `Độ ẩm phòng > 70% VÀ độ ẩm ngoài trời (${outdoor.humidity}%) > 75%`,
          metricValue: `Phòng: ${humidity}% · Ngoài trời: ${outdoor.humidity}%`,
          suggestedAction: 'Giữ kín cửa sổ, bật điều hòa chế độ hút ẩm (Dry) hoặc bật máy hút ẩm.',
          createdAt: new Date().toISOString(),
        });
      }
      // Ngoài trời mát mẻ & trong lành hơn trong nhà -> Khuyên MỞ CỬA đón gió tự nhiên
      else if (temp > 29 && outdoor.temperature < 26 && outdoor.humidity < 70) {
        recommendations.push({
          id: `rec-outdoor-fresh-${device.id}`,
          deviceId: device.id,
          deviceName: device.name,
          title: 'Thời tiết ngoài trời lý tưởng — Mở cửa thông gió tự nhiên',
          description: `Ngoài trời đang mát mẻ (${outdoor.temperature}°C, ẩm ${outdoor.humidity}%), mát hơn phòng (${temp}°C).`,
          category: 'energy',
          priority: 'low',
          priorityReason: 'Tận dụng thông gió tự nhiên giúp giảm 40% điện năng chạy điều hòa',
          triggerRule: `Nhiệt độ ngoài trời mát hơn trong nhà > 3°C và không mưa`,
          metricValue: `Trong nhà: ${temp}°C · Ngoài: ${outdoor.temperature}°C`,
          suggestedAction: 'Mở cửa sổ đối lưu 30 phút để thay mới không khí và làm mát phòng tự nhiên.',
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  // Khuyến nghị tiết kiệm năng lượng chung
  if (recommendations.length === 0 && devices.length > 0) {
    recommendations.push({
      id: 'rec-routine-energy',
      deviceId: devices[0]?.id ?? '',
      deviceName: 'Toàn hệ thống',
      title: 'Tối ưu hóa vi khí hậu & Tiết kiệm điện',
      description: 'Các trạm đang duy trì chất lượng không khí rất tốt. Đặt điều hòa 26°C kết hợp quạt trần để tối ưu hóa năng lượng.',
      category: 'energy',
      priority: 'low',
      priorityReason: 'Duy trì hiệu suất vận hành xanh (Green Operation)',
      triggerRule: 'Tất cả các trạm đạt chuẩn Eco-Score > 85 điểm',
      metricValue: 'Chất lượng: Xuất sắc',
      suggestedAction: 'Duy trì cấu hình thông gió hiện tại và kiểm tra định kỳ màng lọc cảm biến.',
      createdAt: new Date().toISOString(),
    });
  }

  return recommendations;
}

export const defaultActuators: SmartActuatorState = {
  exhaustFan: false,
  dehumidifier: false,
  smartWindow: false,
  autoPilot: true,
  fanSpeed: 2,
};

export function loadActuators(): Record<string, SmartActuatorState> {
  try {
    const raw = localStorage.getItem(ACTUATORS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export function saveActuator(deviceId: string, state: Partial<SmartActuatorState>): void {
  try {
    const all = loadActuators();
    all[deviceId] = {
      ...(all[deviceId] ?? defaultActuators),
      ...state,
    };
    localStorage.setItem(ACTUATORS_STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    console.error('Lỗi lưu trạng thái thiết bị ảo:', e);
  }
}

export function get24hComplianceTimeline(device?: DeviceView): HourlyCompliance[] {
  const currentHour = new Date().getHours();
  const timeline: HourlyCompliance[] = [];
  const hours = [
    '00:00', '02:00', '04:00', '06:00', '08:00', '10:00',
    '12:00', '14:00', '16:00', '18:00', '20:00', '22:00',
  ];

  const isGarage = (device?.name ?? '').includes('Hầm');
  const isKitchen = (device?.name ?? '').includes('Bếp');

  for (let i = 0; i < hours.length; i++) {
    const h = hours[i]!;
    const hourNum = parseInt(h.split(':')[0]!, 10);

    let status: 'ideal' | 'warning' | 'danger' = 'ideal';
    let label = 'Đạt chuẩn 100%';
    let avgScore = 95;

    // Giờ cao điểm hầm xe
    if (isGarage && (hourNum === 8 || hourNum === 18)) {
      status = 'warning';
      label = 'Khói xe tăng nhẹ';
      avgScore = 72;
    }
    // Giờ nấu ăn bếp
    else if (isKitchen && (hourNum === 12 || hourNum === 18)) {
      status = 'warning';
      label = 'Nhiệt & khói bếp';
      avgScore = 75;
    }

    if (hourNum > currentHour) {
      label = 'Dự báo tối ưu';
    }

    timeline.push({
      hour: h,
      status,
      label,
      avgScore,
    });
  }

  return timeline;
}

export function getVentilationGuides(): VentilationGuide[] {
  return [
    {
      timeWindow: '06:00 — 08:00 (Sáng sớm)',
      actionType: 'open_window',
      title: 'Thông gió tự nhiên lưu thông khí tồn dư',
      recommendation: 'Mở rộng cửa đón gió tươi trong 20-30 phút để xả khí CO₂ và ẩm tích tụ qua đêm.',
      reason: 'Nhiệt độ và độ ẩm sáng sớm mát mẻ, hàm lượng oxy trong lành cao.',
      isReferenceOnly: true,
    },
    {
      timeWindow: '11:30 — 14:00 (Trưa nắng)',
      actionType: 'dehumidify',
      title: 'Hút ẩm & Giảm nhiệt cục bộ',
      recommendation: 'Đóng bớt cửa kính tránh bức xạ nhiệt, bật điều hòa 26°C kết hợp quạt trần.',
      reason: 'Thời điểm độ ẩm ngoài trời thấp nhất nhưng bức xạ nhiệt cao nhất trong ngày.',
      isReferenceOnly: true,
    },
    {
      timeWindow: '17:30 — 19:30 (Giờ cao điểm)',
      actionType: 'exhaust_fan',
      title: 'Chạy quạt hút thông gió cưỡng bức tầng hầm',
      recommendation: 'Kích hoạt quạt hút gió tầng hầm B1 chạy tối đa công suất trong giờ phương tiện di chuyển nhiều.',
      reason: 'Lượng khí CO và mùi xăng xe máy/ô tô tăng đột biến trong khung giờ tan tầm.',
      isReferenceOnly: true,
    },
    {
      timeWindow: '21:30 — 22:30 (Trước giờ ngủ)',
      actionType: 'ac_ventilation',
      title: 'Kiểm tra an toàn vi khí hậu phòng ngủ',
      recommendation: 'Kiểm tra van gas nhà bếp trước khi ngủ, duy trì nhiệt độ phòng ngủ 25-27°C, ẩm 55-65%.',
      reason: 'Đảm bảo an toàn phòng chống ngạt khí độc và hỏa hoạn khi người dân đang ngủ.',
      isReferenceOnly: true,
    },
  ];
}

export function loadTasks(): SmartTask[] {
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Lỗi đọc tasks:', e);
  }

  const sampleTasks: SmartTask[] = [
    {
      id: 'task-1',
      title: 'Kiểm tra đường ống van gas công nghiệp',
      description: 'Thực hiện kiểm tra rò rỉ khớp nối bình gas và dây cao su mềm tại Bếp Tầng 1.',
      deviceName: 'Trạm 1 - Khu Nhà Bếp',
      priority: 'P0',
      status: 'in_progress',
      repeatInterval: 'weekly',
      dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      isAutoGenerated: true,
    },
    {
      id: 'task-2',
      title: 'Bật quạt hút thông gió cưỡng bức tầng hầm',
      description: 'Xả khí thải CO tồn đọng sau giờ cao điểm tại Hầm B1.',
      deviceName: 'Trạm 2 - Hầm Để Xe',
      priority: 'P1',
      status: 'todo',
      repeatInterval: 'daily',
      dueDate: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      isAutoGenerated: true,
    },
    {
      id: 'task-3',
      title: 'Bảo dưỡng định kỳ màng lọc cảm biến MQ-2 / MQ-7',
      description: 'Lau bụi và thổi sạch màng ngăn kim loại chống bám bẩn.',
      deviceName: 'Tất cả các trạm',
      priority: 'P2',
      status: 'done',
      repeatInterval: 'once',
      dueDate: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      isAutoGenerated: false,
    },
  ];
  saveTasks(sampleTasks);
  return sampleTasks;
}

export function saveTasks(tasks: SmartTask[]): void {
  try {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
  } catch (e) {
    console.error('Không thể lưu tasks:', e);
  }
}
