const PREFIX = "[lightweight-selector]";

export function logInfo(message: string, meta?: Record<string, unknown>): void {
  if (meta && Object.keys(meta).length > 0) {
    console.log(PREFIX, message, meta);
  } else {
    console.log(PREFIX, message);
  }
}

export function logWarn(message: string, meta?: Record<string, unknown>): void {
  console.warn(PREFIX, message, meta ?? "");
}

export function logError(message: string, err?: unknown): void {
  console.error(PREFIX, message, err ?? "");
}
