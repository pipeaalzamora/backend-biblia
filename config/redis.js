import Redis from "ioredis";
import { logger } from "../utils/logger.js";

let redisClient = null;
let isConnected = false;

export const connectRedis = () => {
  try {
    const redisUrl = process.env.REDIS_URL;
    
    if (!redisUrl) {
      logger.warn("REDIS_URL no configurado - funcionando sin caché Redis");
      return null;
    }

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.error("Redis: máximo de reintentos alcanzado");
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      reconnectOnError: (err) => {
        logger.error("Redis error", { error: err.message });
        return true;
      },
    });

    redisClient.on("connect", () => {
      isConnected = true;
      logger.info("Redis conectado");
    });

    redisClient.on("error", (err) => {
      isConnected = false;
      logger.error("Redis error", { error: err.message });
    });

    redisClient.on("close", () => {
      isConnected = false;
      logger.warn("Redis desconectado");
    });

    return redisClient;
  } catch (error) {
    logger.error("Error inicializando Redis", { error: error.message });
    return null;
  }
};

export const getRedisClient = () => redisClient;

export const isRedisConnected = () => isConnected;

export const disconnectRedis = async () => {
  if (redisClient) {
    await redisClient.quit();
    isConnected = false;
    logger.info("Redis desconectado");
  }
};
