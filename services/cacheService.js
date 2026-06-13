import { getRedisClient, isRedisConnected } from "../config/redis.js";
import { logger } from "../utils/logger.js";

const CACHE_TTL = 3600; // 1 hora en segundos
const CACHE_PREFIX = "bibliahelp:";

/**
 * Obtiene un valor del caché
 */
export const getCache = async (key) => {
  if (!isRedisConnected()) return null;

  try {
    const redis = getRedisClient();
    const value = await redis.get(`${CACHE_PREFIX}${key}`);
    
    if (value) {
      return JSON.parse(value);
    }
    return null;
  } catch (error) {
    logger.error("Error obteniendo del caché", { error: error.message, key });
    return null;
  }
};

/**
 * Guarda un valor en el caché
 */
export const setCache = async (key, value, ttl = CACHE_TTL) => {
  if (!isRedisConnected()) return false;

  try {
    const redis = getRedisClient();
    await redis.setex(
      `${CACHE_PREFIX}${key}`,
      ttl,
      JSON.stringify(value)
    );
    return true;
  } catch (error) {
    logger.error("Error guardando en caché", { error: error.message, key });
    return false;
  }
};

/**
 * Elimina un valor del caché
 */
export const deleteCache = async (key) => {
  if (!isRedisConnected()) return false;

  try {
    const redis = getRedisClient();
    await redis.del(`${CACHE_PREFIX}${key}`);
    return true;
  } catch (error) {
    logger.error("Error eliminando del caché", { error: error.message, key });
    return false;
  }
};

/**
 * Limpia todo el caché
 */
export const clearCache = async () => {
  if (!isRedisConnected()) return false;

  try {
    const redis = getRedisClient();
    const keys = await redis.keys(`${CACHE_PREFIX}*`);
    
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    logger.info("Caché limpiado", { keysDeleted: keys.length });
    return true;
  } catch (error) {
    logger.error("Error limpiando caché", { error: error.message });
    return false;
  }
};
