export function createRuntimeClockSnapshot(date = new Date()) {
  return {
    current_time: formatRuntimeTimestamp(date),
    current_date: formatRuntimeDate(date),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"
  };
}

function formatRuntimeTimestamp(date) {
  return `${formatRuntimeDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatRuntimeDate(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
