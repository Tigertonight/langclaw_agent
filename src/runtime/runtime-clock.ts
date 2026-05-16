export interface RuntimeClockSnapshot {
  current_time: string;
  current_date: string;
  timezone: string;
}

export function createRuntimeClockSnapshot(date = new Date()): RuntimeClockSnapshot {
  return {
    current_time: formatRuntimeTimestamp(date),
    current_date: formatRuntimeDate(date),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"
  };
}

function formatRuntimeTimestamp(date: Date): string {
  return `${formatRuntimeDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatRuntimeDate(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
