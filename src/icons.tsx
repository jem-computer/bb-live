import type { CSSProperties } from "react";
const paths: Record<string, string> = {
  ChevronDown: "m6 9 6 6 6-6",
  Mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
  MicOff:
    "m3 3 18 18M9 9v3a3 3 0 0 0 5 2M15 10V6a3 3 0 0 0-5-2M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3M8 22h8",
  Volume2: "M11 4 6 8H3v8h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14",
  VolumeX: "M11 4 6 8H3v8h3l5 4ZM16 9l6 6M22 9l-6 6",
  Square: "M5 5h14v14H5Z",
  MessageSquare:
    "M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8l-5 4V4a1 1 0 0 1 1-1Z",
  PhoneOff: "M3 15v-4a15 15 0 0 1 18 0v4l-5-1v-3a13 13 0 0 0-8 0v3ZM3 3l18 18",
  X: "m6 6 12 12M18 6 6 18",
  AlertCircle: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v6M12 16v1",
  GitBranch:
    "M6 3v12a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM18 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM18 8c0 6-12 2-12 7",
};
export function Icon({ name, style }: { name: string; style?: CSSProperties }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d={paths[name] ?? paths.Mic} />
    </svg>
  );
}
