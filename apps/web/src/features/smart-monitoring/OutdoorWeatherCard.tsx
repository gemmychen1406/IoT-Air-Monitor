import { useState, useEffect } from 'react';
import type { DeviceView } from '@iot/contracts';
import { CloudSun, ArrowRightLeft, RefreshCw, Radio, CheckCircle, ShieldAlert } from 'lucide-react';
import type { OutdoorWeatherData } from './types.js';
import { fetchOutdoorWeather } from './utils.js';

export default function OutdoorWeatherCard({ device }: { device?: DeviceView }) {
  const [weather, setWeather] = useState<OutdoorWeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadWeather() {
    setLoading(true);
    const data = await fetchOutdoorWeather();
    setWeather(data);
    setLoading(false);
  }

  useEffect(() => {
    void loadWeather();
  }, []);

  if (!weather) return null;

  const reading = device?.latest?.payload;
  const inTemp = reading?.sensors.dht11.temperature_c ?? 26;
  const inHum = reading?.sensors.dht11.humidity_pct ?? 65;

  const tempDiff = Math.round((inTemp - weather.temperature) * 10) / 10;
  const humDiff = inHum - weather.humidity;

  // Quyết định khuyến nghị thông minh dựa trên so sánh trong nhà vs ngoài trời
  let smartAdvice = '';
  let adviceType: 'good' | 'caution' | 'warning' = 'good';

  if (weather.humidity > inHum + 10) {
    adviceType = 'warning';
    smartAdvice = `Ngoài trời đang ẩm ướt hơn trong phòng (${weather.humidity}% vs ${inHum}%). TUYỆT ĐỐI KHÔNG mở cửa vì hơi ẩm sẽ tràn vào nhà gây nồm ẩm mốc!`;
  } else if (inTemp > 30 && weather.temperature < 27) {
    adviceType = 'good';
    smartAdvice = `Thời tiết ngoài trời mát mẻ hơn phòng (${weather.temperature}°C vs ${inTemp}°C). NÊN MỞ CỬA SỔ để đón gió mát tự nhiên, giảm tải điều hòa.`;
  } else {
    adviceType = 'good';
    smartAdvice = `Nhiệt ẩm trong và ngoài trời đang cân bằng tốt. Duy trì đóng cửa sổ và bật quạt lưu thông gió nhẹ.`;
  }

  return (
    <div className="panel outdoor-weather-card">
      <div className="weather-card-header">
        <div className="weather-title">
          <CloudSun size={20} color="var(--accent)" />
          <h4>So sánh Vi khí hậu Trong nhà & Ngoài trời</h4>
        </div>
        <div className="weather-right-meta">
          <span className="live-weather-badge">
            <Radio size={12} className="blink" /> {weather.isLive ? 'Dữ liệu thời tiết trực tiếp' : 'Dữ liệu tham khảo'}
          </span>
          <button className="btn-icon" onClick={loadWeather} disabled={loading} title="Làm mới thời tiết">
            <RefreshCw size={14} className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      <div className="weather-comparison-grid">
        {/* Cột 1: Trong nhà */}
        <div className="climate-box indoor-box">
          <span className="box-badge">Trong nhà ({device?.name ?? 'Trạm đo'})</span>
          <div className="climate-metric">
            <strong>{inTemp}°C</strong>
            <span>Độ ẩm: <b>{inHum}%</b></span>
          </div>
          <small className="muted">Cảm biến DHT11 tại chỗ</small>
        </div>

        {/* Mũi tên so sánh ở giữa */}
        <div className="climate-diff-arrow">
          <ArrowRightLeft size={20} color="var(--accent)" />
          <span className="diff-tag">
            {tempDiff > 0 ? `+${tempDiff}°C` : `${tempDiff}°C`}
          </span>
        </div>

        {/* Cột 2: Ngoài trời */}
        <div className="climate-box outdoor-box">
          <span className="box-badge box-outdoor">Ngoài trời ({weather.location})</span>
          <div className="climate-metric">
            <strong>{weather.temperature}°C</strong>
            <span>Độ ẩm: <b>{weather.humidity}%</b></span>
          </div>
          <small className="muted">{weather.conditionText} · Cập nhật {weather.updatedAt}</small>
        </div>
      </div>

      {/* Box lời khuyên chênh lệch thông minh */}
      <div className={`weather-advice-box advice-${adviceType}`}>
        {adviceType === 'warning' ? <ShieldAlert size={18} /> : <CheckCircle size={18} />}
        <div>
          <strong>Chiến lược đối lưu tối ưu:</strong>
          <p>{smartAdvice}</p>
        </div>
      </div>
    </div>
  );
}
