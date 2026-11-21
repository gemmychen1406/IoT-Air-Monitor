import { useQuery } from '@tanstack/react-query';
import type { IncidentSupportView } from '@iot/contracts';
import { api } from '../../lib/api.js';

export function useIncidentSupport(incidentId: string, refresh = true) {
  return useQuery({
    queryKey: ['incident-support', incidentId],
    queryFn: ({ signal }) => api<IncidentSupportView>(`/alerts/incidents/${incidentId}/support`, { signal }),
    refetchInterval: refresh ? 10000 : false,
  });
}

export function incidentLocationText(location: IncidentSupportView['location']) {
  return location.source === 'assignment'
    ? `${location.area_name} / ${location.room_name}${location.archived ? ' · Đã lưu trữ' : ''}`
    : location.description || 'Chưa có thông tin vị trí';
}
