import { useState } from 'react';
import type { DeviceView } from '@iot/contracts';
import { Target, Lightbulb, CheckSquare, Sparkles, Activity, ShieldCheck } from 'lucide-react';
import EnvironmentalGoalsView from './EnvironmentalGoalsView.js';
import SmartRecommendationsView from './SmartRecommendationsView.js';
import TaskRemindersView from './TaskRemindersView.js';
import {
  calculateEcoScore,
  getDefaultTarget,
  generateSmartRecommendations,
  loadTasks,
  loadTargets,
} from './utils.js';
import './styles.css';

const TABS = [
  { id: 'goals', label: 'Mục tiêu Tiện nghi & Eco-Score', icon: Target },
  { id: 'recommendations', label: 'Khuyến nghị Vi khí hậu', icon: Lightbulb },
  { id: 'tasks', label: 'Kế hoạch Hành động (Kanban)', icon: CheckSquare },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function SmartMonitoringHub({ devices }: { devices: DeviceView[] }) {
  const [currentTab, setCurrentTab] = useState<TabId>('goals');
  const [taskRefreshKey, setTaskRefreshKey] = useState(0);

  // Tính toán nhanh số liệu tóm tắt trên header
  const targets = loadTargets(devices);
  const scores = devices.map((d) => calculateEcoScore(d, targets[d.id] ?? getDefaultTarget(d)).score);
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 80;

  const recommendations = generateSmartRecommendations(devices);
  const urgentCount = recommendations.filter((r) => r.priority === 'urgent').length;

  const tasks = loadTasks();
  const pendingTasksCount = tasks.filter((t) => t.status !== 'done').length;

  return (
    <div className="smart-hub">
      {/* Tiêu đề & Thẻ chỉ số tổng hợp */}
      <div className="smart-hub-header">
        <div>
          <span className="eyebrow">SMART HOME COMFORT & ECO-LIVING</span>
          <h1>Giám sát thông minh & Hành động</h1>
          <p className="muted">
            Cá nhân hóa mục tiêu tiện nghi, theo dõi điểm sức khỏe Eco-Score và điều phối kế hoạch hành động tối ưu vi khí hậu.
          </p>
        </div>

        {/* 3 chỉ số nhanh */}
        <div className="smart-stats-row">
          <div className="stat-pill">
            <span className="stat-pill-icon">
              <Sparkles size={18} />
            </span>
            <div className="stat-pill-text">
              <span>Eco-Score trung bình</span>
              <strong>{avgScore} / 100</strong>
            </div>
          </div>

          <div className="stat-pill">
            <span className="stat-pill-icon" style={{ color: urgentCount > 0 ? '#ef4444' : 'var(--accent)', background: urgentCount > 0 ? 'rgba(239, 68, 68, 0.12)' : undefined }}>
              <Lightbulb size={18} />
            </span>
            <div className="stat-pill-text">
              <span>Khuyến nghị</span>
              <strong>{recommendations.length} đề xuất {urgentCount > 0 ? `(${urgentCount} nguy cấp)` : ''}</strong>
            </div>
          </div>

          <div className="stat-pill">
            <span className="stat-pill-icon">
              <CheckSquare size={18} />
            </span>
            <div className="stat-pill-text">
              <span>Việc cần làm</span>
              <strong>{pendingTasksCount} nhiệm vụ</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs chuyển đổi chức năng */}
      <nav className="smart-tabs" aria-label="Các phân hệ giám sát thông minh">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={currentTab === id ? 'active' : ''}
            onClick={() => setCurrentTab(id)}
          >
            <Icon size={18} />
            <span>{label}</span>
            {id === 'recommendations' && recommendations.length > 0 && (
              <span className={`tab-badge ${urgentCount > 0 ? 'badge-urgent' : ''}`}>
                {recommendations.length}
              </span>
            )}
            {id === 'tasks' && pendingTasksCount > 0 && (
              <span className="tab-badge">{pendingTasksCount}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Nội dung từng tab */}
      {currentTab === 'goals' && <EnvironmentalGoalsView devices={devices} />}
      {currentTab === 'recommendations' && (
        <SmartRecommendationsView
          devices={devices}
          onTaskCreated={() => setTaskRefreshKey((k) => k + 1)}
        />
      )}
      {currentTab === 'tasks' && (
        <TaskRemindersView key={taskRefreshKey} devices={devices} />
      )}
    </div>
  );
}
