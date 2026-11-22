import { Armchair, Bed, Box, Car, Home, Utensils } from "lucide-react";

// Match the room symbols used in Smart Monitoring's environmental goals.
const rooms = [
  { match: /bếp|kitchen|nấu/i, icon: Utensils, color: "#cc823c" },
  { match: /hầm|xe|garage/i, icon: Car, color: "#5088a0" },
  { match: /khách|living/i, icon: Armchair, color: "#269981" },
  { match: /ngủ|bed/i, icon: Bed, color: "#9673cc" },
  { match: /kho|kỹ thuật/i, icon: Box, color: "#8d8764" },
];

export function RoomSymbol({ name }: { name?: string | null }) {
  const room = rooms.find(({ match }) => match.test(name ?? ""));
  const Icon = room?.icon ?? Home;
  return (
    <span
      className="dd-room-symbol"
      style={{
        backgroundColor: `color-mix(in srgb, ${room?.color ?? "var(--accent)"} 22%, var(--panel))`,
      }}
      aria-hidden="true"
    >
      <Icon size={17} />
    </span>
  );
}
