// Servidor de desarrollo simple
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import compression from "compression";
import mongoose from "mongoose";
import { validarVersiculos } from "./utils/validadores.js";
import { logger } from "./utils/logger.js";
import { obtenerVersiculosCompletos } from "./utils/bibleApi.js";
import { connectDB, isDBConnected } from "./config/database.js";
import { connectRedis } from "./config/redis.js";
import { registrarBusqueda } from "./services/analyticsService.js";
import { getCache, setCache } from "./services/cacheService.js";
import { rateLimiter } from "./middleware/rateLimiter.js";

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Conectar a MongoDB y Redis
connectDB();
connectRedis();

// Middleware de seguridad
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// Compresión
app.use(compression());

// CORS mejorado
const allowedOrigins = [
  "http://localhost:8081",
  "http://192.168.1.6:8081",
  "exp://192.168.1.6:8081",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (mobile apps, Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin) || origin.startsWith("exp://")) {
      callback(null, true);
    } else {
      callback(new Error("No permitido por CORS"));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: "10kb" }));

// Endpoint de IA OPCIONAL. Si GEMINI_API_KEY no está configurada, responde
// success:false y el cliente cae a su búsqueda local. Nunca tumba el servidor.
app.post("/api/suggest-verses", rateLimiter("anonymous"), async (req, res) => {
  const startTime = Date.now();
  const ipCliente =
    req.headers["x-forwarded-for"] || req.connection?.remoteAddress || "desconocida";

  try {
    const { sugerirVersiculos, iaConfigurada } = await import("./services/iaService.js");

    if (!iaConfigurada()) {
      return res.status(200).json({
        success: false,
        error: "IA no configurada en el servidor",
        versiculos: [],
      });
    }

    const { userInput } = req.body;

    // Caché Redis: evita llamar al modelo para consultas repetidas.
    const cacheKey = `suggest:${String(userInput || "").toLowerCase().trim().substring(0, 100)}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.status(200).json({ ...cached, fromCache: true });
    }

    const resultado = await sugerirVersiculos(userInput);

    if (resultado.success) {
      await setCache(cacheKey, resultado);
      registrarBusqueda({
        userInput,
        versiculos: resultado.versiculos,
        success: true,
        ip: ipCliente,
        responseTime: Date.now() - startTime,
      }).catch(() => {});
    }

    return res.status(200).json(resultado);
  } catch (error) {
    logger.error("Error en suggest-verses", { error: error.message });
    return res.status(200).json({
      success: false,
      error: "No se pudo generar la sugerencia",
      versiculos: [],
    });
  }
});

// Endpoint para obtener versículos completos por referencia
app.post("/api/get-verses", rateLimiter("anonymous"), async (req, res) => {
  try {
    const { referencias } = req.body;

    if (!Array.isArray(referencias) || referencias.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Se requiere un array de referencias",
      });
    }

    if (referencias.length > 10) {
      return res.status(400).json({
        success: false,
        error: "Máximo 10 versículos por petición",
      });
    }

    const referenciasValidas = validarVersiculos(referencias);

    if (referenciasValidas.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No hay referencias válidas para consultar",
      });
    }

    const versiculos = await obtenerVersiculosCompletos(referenciasValidas);

    return res.json({
      success: true,
      versiculos,
    });
  } catch (error) {
    logger.error("Error en get-verses", { error: error.message });
    return res.status(500).json({
      success: false,
      error: "Error al obtener versículos",
    });
  }
});

// Ruta de prueba
app.get("/", (req, res) => {
  res.json({ message: "Backend Biblia Help funcionando ✅" });
});

// Ruta de health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

// Endpoint de analytics
app.get("/api/analytics", async (req, res) => {
  try {
    const { obtenerEstadisticas, obtenerVersiculosPopulares } = await import("./services/analyticsService.js");
    
    const [estadisticas, versiculosPopulares] = await Promise.all([
      obtenerEstadisticas(),
      obtenerVersiculosPopulares(10),
    ]);

    return res.json({
      success: true,
      estadisticas,
      versiculosPopulares,
    });
  } catch (error) {
    logger.error("Error en analytics", { error: error.message });
    return res.status(500).json({
      success: false,
      error: "Error obteniendo analytics",
    });
  }
});

// Endpoint de versículos populares
app.get("/api/popular-verses", async (req, res) => {
  try {
    const { obtenerVersiculosPopulares } = await import("./services/analyticsService.js");
    const limit = parseInt(req.query.limit, 10) || 20;
    const versiculos = await obtenerVersiculosPopulares(limit);

    return res.json({
      success: true,
      versiculos,
    });
  } catch (error) {
    logger.error("Error en popular-verses", { error: error.message });
    return res.status(500).json({
      success: false,
      error: "Error obteniendo versículos populares",
    });
  }
});

// Endpoint de sincronización
app.post("/api/sync-favorites", async (req, res) => {
  try {
    const { User } = await import("./models/User.js");
    const { deviceId, favorites, searchHistory, preferences } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "deviceId es requerido",
      });
    }

    if (!isDBConnected()) {
      return res.json({
        success: true,
        data: {
          favorites: favorites || [],
          searchHistory: searchHistory || [],
          preferences: preferences || {},
        },
        offline: true,
      });
    }

    const user = await User.findOneAndUpdate(
      { deviceId },
      {
        $set: {
          favorites: favorites || [],
          searchHistory: searchHistory || [],
          preferences: preferences || {},
          lastActive: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    return res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    logger.error("Error en sync-favorites", { error: error.message });
    return res.status(500).json({
      success: false,
      error: "Error sincronizando datos",
    });
  }
});

app.get("/api/sync-favorites", async (req, res) => {
  try {
    const { User } = await import("./models/User.js");
    const { deviceId } = req.query;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "deviceId es requerido",
      });
    }

    if (!isDBConnected()) {
      return res.json({
        success: true,
        data: { favorites: [], searchHistory: [], preferences: {} },
        offline: true,
      });
    }

    const user = await User.findOne({ deviceId });

    return res.json({
      success: true,
      data: user || { favorites: [], searchHistory: [], preferences: {} },
    });
  } catch (error) {
    logger.error("Error obteniendo datos sincronizados", { error: error.message });
    return res.status(500).json({
      success: false,
      error: "Error obteniendo datos",
    });
  }
});

// Middleware de manejo de errores
import { errorHandler } from "./middleware/errorHandler.js";
app.use(errorHandler);

app.listen(PORT, "0.0.0.0", () => {
  logger.info("Backend corriendo", {
    port: PORT,
    endpoints: [
      `http://localhost:${PORT}`,
      `http://192.168.1.6:${PORT}`,
    ],
  });
});
