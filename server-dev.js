// Servidor de desarrollo simple
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import compression from "compression";
import mongoose from "mongoose";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { backoffExponencial } from "./utils/backoff.js";
import { validarVersiculos } from "./utils/validadores.js";
import { validateUserInput } from "./utils/sanitizer.js";
import { logger } from "./utils/logger.js";
import { obtenerVersiculosCompletos } from "./utils/bibleApi.js";
import { connectDB, isDBConnected } from "./config/database.js";
import { connectRedis } from "./config/redis.js";
import { registrarBusqueda, actualizarEstadisticasVersiculo } from "./services/analyticsService.js";
import { getCache, setCache } from "./services/cacheService.js";
import { rateLimiter } from "./middleware/rateLimiter.js";

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const CONTROL_CHARS_REGEX = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}-${String.fromCharCode(159)}]`,
  "g"
);

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

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.5-flash",
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 2048,
    topP: 0.95,
  },
});

// Endpoint
app.post("/api/suggest-verses", rateLimiter("anonymous"), async (req, res) => {
  const startTime = Date.now();
  const ipCliente = req.headers["x-forwarded-for"] || req.connection.remoteAddress || "desconocida";
  
  try {
    const { userInput } = req.body;

    const validacion = validateUserInput(userInput);
    
    if (!validacion.valid) {
      await registrarBusqueda({
        userInput: userInput || "",
        success: false,
        error: validacion.error,
        ip: ipCliente,
        responseTime: Date.now() - startTime,
      });
      
      return res.status(400).json({
        success: false,
        error: validacion.error,
        versiculos: [],
      });
    }

    const inputSanitizado = validacion.sanitized;

    // Verificar caché Redis primero
    const cacheKey = `suggest:${inputSanitizado.toLowerCase().trim().substring(0, 100)}`;
    const cachedResponse = await getCache(cacheKey);
    
    if (cachedResponse) {
      logger.info("Respuesta desde caché Redis");
      return res.json({
        ...cachedResponse,
        fromCache: true,
      });
    }

    const result = await backoffExponencial(async () => {
      const prompt = `Eres un pastor espiritual experto en la Biblia RV1960. Analiza la situación del usuario y encuentra versículos ESPECÍFICOS que hablen directamente a su necesidad.

Situación: ${inputSanitizado}

Responde SOLO con este JSON COMPLETO (sin markdown, sin texto adicional):
{
  "mensaje": "Mensaje pastoral breve (80-100 palabras) que conecte la situación específica del usuario con la Palabra de Dios.",
  "versiculos": [
    {"libro": "nombre-libro", "capitulo": numero, "versiculo": "numero"},
    {"libro": "nombre-libro", "capitulo": numero, "versiculo": "numero"}
  ]
}

CRÍTICO:
- Busca 3-5 versículos que hablen DIRECTAMENTE a esta situación específica
- Los versículos deben ser relevantes y aplicables al problema del usuario
- Libros en minúsculas sin acentos (ej: "salmos", "1-corintios", "proverbios")
- Mensaje BREVE (80-100 palabras) que explique cómo estos versículos aplican
- Cierra TODAS las comillas y llaves`;

      return await model.generateContent(prompt);
    });

    let respuesta = result.response.text().trim();

    if (!respuesta) {
      throw new Error("El modelo devolvió una respuesta vacía");
    }

    // Extraer JSON de la respuesta
    let jsonText = respuesta;
    
    // Intentar extraer JSON de bloques de código
    if (respuesta.includes("```json")) {
      jsonText = respuesta.split("```json")[1].split("```")[0].trim();
    } else if (respuesta.includes("```")) {
      jsonText = respuesta.split("```")[1].split("```")[0].trim();
    }

    // Limpiar caracteres de control
    jsonText = jsonText
      .replace(CONTROL_CHARS_REGEX, "")
      .trim();

    // Si no hay JSON válido, intentar encontrarlo con regex
    if (!jsonText.startsWith("{")) {
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }
    }

    // Verificar si el JSON está incompleto y intentar repararlo
    if (jsonText && !jsonText.endsWith("}")) {
      logger.warn("JSON incompleto detectado, intentando reparar", {
        original: jsonText.substring(0, 200)
      });
      
      // Intentar cerrar el JSON incompleto
      // Contar llaves abiertas vs cerradas
      const openBraces = (jsonText.match(/\{/g) || []).length;
      const closeBraces = (jsonText.match(/\}/g) || []).length;
      const openBrackets = (jsonText.match(/\[/g) || []).length;
      const closeBrackets = (jsonText.match(/\]/g) || []).length;
      
      // Cerrar strings abiertas
      const quotes = (jsonText.match(/"/g) || []).length;
      if (quotes % 2 !== 0) {
        jsonText += "\"";
      }
      
      // Cerrar arrays abiertos
      for (let i = 0; i < openBrackets - closeBrackets; i++) {
        jsonText += "]";
      }
      
      // Cerrar objetos abiertos
      for (let i = 0; i < openBraces - closeBraces; i++) {
        jsonText += "}";
      }
      
      logger.info("JSON reparado", {
        reparado: jsonText.substring(0, 200)
      });
    }

    if (!jsonText) {
      throw new Error("No se pudo extraer JSON de la respuesta");
    }

    let datos;
    try {
      datos = JSON.parse(jsonText);
    } catch (parseError) {
      logger.error("Error parseando JSON", {
        error: parseError.message,
        jsonText: jsonText.substring(0, 300),
        respuestaOriginal: respuesta.substring(0, 300),
      });
      
      // Fallback: devolver respuesta genérica
      return res.json({
        success: true,
        mensaje: "Dios está contigo en este momento. Él conoce tu situación y tiene un plan perfecto para ti. Confía en Su amor incondicional.",
        versiculos: await obtenerVersiculosCompletos([
          { libro: "salmos", capitulo: 23, versiculo: "4" },
          { libro: "filipenses", capitulo: 4, versiculo: "6-7" },
          { libro: "isaias", capitulo: 41, versiculo: "10" }
        ]),
        fallback: true
      });
    }

    // Validar y filtrar versículos
    const versiculosValidos = validarVersiculos(datos.versiculos);

    // Obtener versículos completos
    const versiculosCompletos = await obtenerVersiculosCompletos(versiculosValidos);

    // Registrar analytics
    await registrarBusqueda({
      userInput: inputSanitizado,
      versiculos: versiculosValidos,
      success: true,
      ip: ipCliente,
      responseTime: Date.now() - startTime,
    });

    // Actualizar estadísticas de versículos
    for (const versiculo of versiculosCompletos) {
      await actualizarEstadisticasVersiculo(versiculo.referencia, versiculo.texto, "consulta");
    }

    // Guardar en caché Redis
    await setCache(cacheKey, {
      success: true,
      mensaje: datos.mensaje || "",
      versiculos: versiculosCompletos,
    });

    return res.json({
      success: true,
      mensaje: datos.mensaje || "",
      versiculos: versiculosCompletos,
    });
  } catch (error) {
    logger.error("Error en suggest-verses", {
      error: error.message,
    });

    let errorMessage = error.message;
    let statusCode = 500;

    if (errorMessage.includes("API_KEY_INVALID")) {
      errorMessage = "API key inválida";
      statusCode = 401;
    } else if (errorMessage.includes("RESOURCE_EXHAUSTED")) {
      errorMessage = "Límite de Gemini alcanzado";
      statusCode = 429;
    } else if (errorMessage.includes("503")) {
      errorMessage = "Servicio no disponible temporalmente";
      statusCode = 503;
    }

    // Registrar error en analytics
    await registrarBusqueda({
      userInput: req.body.userInput || "",
      success: false,
      error: errorMessage,
      ip: ipCliente,
      responseTime: Date.now() - startTime,
    });

    return res.status(statusCode).json({
      success: false,
      error: errorMessage,
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
