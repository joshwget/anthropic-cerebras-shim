export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  // Foreground colors
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.gray,
  info: COLORS.cyan,
  warn: COLORS.yellow,
  error: COLORS.red,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
};

function getLogLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && env in LOG_LEVELS) {
    return env as LogLevel;
  }
  return "info";
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[getLogLevel()];
}

function formatTimestamp(): string {
  const now = new Date();
  return now.toISOString();
}

function formatValue(value: unknown, indent = 0): string {
  if (value === null) return `${COLORS.dim}null${COLORS.reset}`;
  if (value === undefined) return `${COLORS.dim}undefined${COLORS.reset}`;

  if (typeof value === "string") {
    // Truncate long strings
    const maxLen = 200;
    if (value.length > maxLen) {
      return `"${value.slice(0, maxLen)}${COLORS.dim}... (${value.length} chars)${COLORS.reset}"`;
    }
    return `"${value}"`;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return `${COLORS.yellow}${value}${COLORS.reset}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.length > 5) {
      return `[${COLORS.dim}${value.length} items${COLORS.reset}]`;
    }
    return `[${value.map(v => formatValue(v, indent)).join(", ")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    if (entries.length > 8) {
      const shown = entries.slice(0, 8);
      const formatted = shown.map(([k, v]) => `${k}: ${formatValue(v, indent + 1)}`).join(", ");
      return `{ ${formatted}${COLORS.dim}, ... +${entries.length - 8} more${COLORS.reset} }`;
    }
    const formatted = entries.map(([k, v]) => `${k}: ${formatValue(v, indent + 1)}`).join(", ");
    return `{ ${formatted} }`;
  }

  return String(value);
}

function log(level: LogLevel, category: string, message: string, data?: Record<string, unknown>) {
  if (!shouldLog(level)) return;

  const timestamp = formatTimestamp();
  const color = LEVEL_COLORS[level];
  const label = LEVEL_LABELS[level];

  let output = `${COLORS.dim}${timestamp}${COLORS.reset} ${color}${label}${COLORS.reset} ${COLORS.magenta}[${category}]${COLORS.reset} ${message}`;

  if (data && Object.keys(data).length > 0) {
    const dataStr = Object.entries(data)
      .map(([key, value]) => `${COLORS.dim}${key}=${COLORS.reset}${formatValue(value)}`)
      .join(" ");
    output += ` ${dataStr}`;
  }

  if (level === "error") {
    console.error(output);
  } else {
    console.log(output);
  }
}

// Logger factory for creating category-specific loggers
export function createLogger(category: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) => log("debug", category, message, data),
    info: (message: string, data?: Record<string, unknown>) => log("info", category, message, data),
    warn: (message: string, data?: Record<string, unknown>) => log("warn", category, message, data),
    error: (message: string, data?: Record<string, unknown>) => log("error", category, message, data),
  };
}

// Pre-configured loggers for common categories
export const serverLog = createLogger("server");
export const clientLog = createLogger("cerebras");
export const requestLog = createLogger("request");
export const responseLog = createLogger("response");
export const streamLog = createLogger("stream");
