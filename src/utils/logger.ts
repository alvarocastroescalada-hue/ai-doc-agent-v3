export function logInfo(msg: string, data?: unknown) {
  console.log(`[INFO] ${msg}`, data ? JSON.stringify(data, null, 2) : "");
}

export function logWarn(msg: string, data?: unknown) {
  console.warn(`[WARN] ${msg}`, data ? JSON.stringify(data, null, 2) : "");
}

export function logError(msg: string, data?: unknown) {
  console.error(`[ERROR] ${msg}`, data ? JSON.stringify(data, null, 2) : "");
}