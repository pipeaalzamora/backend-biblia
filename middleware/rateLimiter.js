import { getRedisClient, isRedisConnected } from "../config/redis.js";
import { logger } from "../utils/logger.js";

const RATE_LIMITS = {
  anonymous: {
    windowMs: 60000, // 1 minuto
    maxRequests: 10,
  },
  registered: {
    windowMs: 60000,
    maxRequests: 60,
  },
};

// Fallback en memoria si Redis no está disponible
const memoryStore = new Map();

/**
 * Limpia entradas antiguas del store en memoria
 */
const cleanMemoryStore = () => {
  const now = Date.now();
  for (const [key, data] of memoryStore.entries()) {
    if (now - data.resetTime > RATE_LIMITS.anonymous.windowMs) {
      memoryStore.delete(key);
    }
  }
};

/**
 * Rate limiter con Redis o fallback en memoria
 */
export const rateLimiter = (tier = "anonymous") => {
  return async (req, res, next) => {
    try {
      const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress || "unknown";
      const key = `ratelimit:${tier}:${ip}`;
      const limit = RATE_LIMITS[tier] || RATE_LIMITS.anonymous;

      if (isRedisConnected()) {
        // Usar Redis
        const redis = getRedisClient();
        const current = await redis.incr(key);

        if (current === 1) {
          await redis.expire(key, Math.ceil(limit.windowMs / 1000));
        }

        const ttl = await redis.ttl(key);

        res.setHeader("X-RateLimit-Limit", limit.maxRequests);
        res.setHeader("X-RateLimit-Remaining", Math.max(0, limit.maxRequests - current));
        res.setHeader("X-RateLimit-Reset", Date.now() + (ttl * 1000));

        if (current > limit.maxRequests) {
          return res.status(429).json({
            success: false,
            error: "Demasiadas peticiones. Por favor, espera un momento.",
            retryAfter: ttl,
          });
        }
      } else {
        // Fallback en memoria
        cleanMemoryStore();
        
        const now = Date.now();
        const record = memoryStore.get(key) || {
          count: 0,
          resetTime: now + limit.windowMs,
        };

        if (now > record.resetTime) {
          record.count = 0;
          record.resetTime = now + limit.windowMs;
        }

        record.count++;
        memoryStore.set(key, record);

        const remaining = Math.max(0, limit.maxRequests - record.count);
        const resetIn = Math.ceil((record.resetTime - now) / 1000);

        res.setHeader("X-RateLimit-Limit", limit.maxRequests);
        res.setHeader("X-RateLimit-Remaining", remaining);
        res.setHeader("X-RateLimit-Reset", record.resetTime);

        if (record.count > limit.maxRequests) {
          return res.status(429).json({
            success: false,
            error: "Demasiadas peticiones. Por favor, espera un momento.",
            retryAfter: resetIn,
          });
        }
      }

      next();
    } catch (error) {
      logger.error("Error en rate limiter", { error: error.message });
      // En caso de error, permitir la petición
      next();
    }
  };
};
