/**
 * Logger estructurado para el backend
 */

const LOG_LEVELS = {
  ERROR: "ERROR",
  WARN: "WARN",
  INFO: "INFO",
  DEBUG: "DEBUG",
};

const shouldLog = (level) => {
  const env = process.env.NODE_ENV || "development";
  
  if (env === "production") {
    return level === LOG_LEVELS.ERROR || level === LOG_LEVELS.WARN;
  }
  
  return true;
};

const formatLog = (level, message, metadata = {}) => {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...metadata,
  });
};

export const logger = {
  error: (message, metadata = {}) => {
    if (shouldLog(LOG_LEVELS.ERROR)) {
      // eslint-disable-next-line no-console
      console.error(formatLog(LOG_LEVELS.ERROR, message, metadata));
    }
  },

  warn: (message, metadata = {}) => {
    if (shouldLog(LOG_LEVELS.WARN)) {
      // eslint-disable-next-line no-console
      console.warn(formatLog(LOG_LEVELS.WARN, message, metadata));
    }
  },

  info: (message, metadata = {}) => {
    if (shouldLog(LOG_LEVELS.INFO)) {
      // eslint-disable-next-line no-console
      console.info(formatLog(LOG_LEVELS.INFO, message, metadata));
    }
  },

  debug: (message, metadata = {}) => {
    if (shouldLog(LOG_LEVELS.DEBUG)) {
      // eslint-disable-next-line no-console
      console.debug(formatLog(LOG_LEVELS.DEBUG, message, metadata));
    }
  },
};
