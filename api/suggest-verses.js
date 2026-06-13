import { GoogleGenerativeAI } from "@google/generative-ai";
import { backoffExponencial } from "../utils/backoff.js";
import { validarVersiculos } from "../utils/validadores.js";
import { logger } from "../utils/logger.js";
import { validateUserInput } from "../utils/sanitizer.js";
import { obtenerVersiculosCompletos } from "../utils/bibleApi.js";
import { connectDB } from "../config/database.js";
import { registrarBusqueda, actualizarEstadisticasVersiculo } from "../services/analyticsService.js";
import { getCache, setCache } from "../services/cacheService.js";

const CONTROL_CHARS_REGEX = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}-${String.fromCharCode(159)}]`,
  "g"
);

// Inicializar cliente de Gemini con la API key del servidor
const iaGenerativa = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const modelo = iaGenerativa.getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 2048,
    topP: 0.95,
  },
});

// Configuración de rate limiting
const LIMITE_PETICIONES_POR_MINUTO = 60;
const contadorPeticiones = new Map();

// Caché de respuestas en memoria
const cacheRespuestas = new Map();
const TIEMPO_CACHE = 3600000; // 1 hora en milisegundos
const MAX_ENTRADAS_CACHE = 100;

/**
 * Genera una clave de caché normalizada
 * @param {string} texto - Texto del usuario
 * @returns {string} - Clave de caché
 */
const generarClaveCache = (texto) => {
  return texto.toLowerCase().trim().replace(/\s+/g, " ").substring(0, 200);
};

/**
 * Obtiene respuesta del caché si existe y es válida
 * @param {string} clave - Clave de caché
 * @returns {Object|null} - Respuesta cacheada o null
 */
const obtenerDelCache = (clave) => {
  const entrada = cacheRespuestas.get(clave);
  if (!entrada) return null;

  const ahora = Date.now();
  if (ahora - entrada.timestamp > TIEMPO_CACHE) {
    cacheRespuestas.delete(clave);
    return null;
  }

  return entrada.datos;
};

/**
 * Guarda respuesta en el caché
 * @param {string} clave - Clave de caché
 * @param {Object} datos - Datos a cachear
 */
const guardarEnCache = (clave, datos) => {
  // Limpiar caché si está lleno
  if (cacheRespuestas.size >= MAX_ENTRADAS_CACHE) {
    const primeraKey = cacheRespuestas.keys().next().value;
    cacheRespuestas.delete(primeraKey);
  }

  cacheRespuestas.set(clave, {
    datos,
    timestamp: Date.now(),
  });
};

/**
 * Verifica si se ha excedido el límite de peticiones
 * @param {string} ip - Dirección IP del cliente
 * @returns {boolean} - true si se excedió el límite
 */
const verificarLimiteRatePorIp = (ip) => {
  const ahora = Date.now();
  const ventanaTiempo = 60000; // 1 minuto

  if (!contadorPeticiones.has(ip)) {
    contadorPeticiones.set(ip, []);
  }

  const peticiones = contadorPeticiones.get(ip);
  const peticionesRecientes = peticiones.filter(
    (tiempo) => ahora - tiempo < ventanaTiempo
  );

  if (peticionesRecientes.length >= LIMITE_PETICIONES_POR_MINUTO) {
    return true;
  }

  peticionesRecientes.push(ahora);
  contadorPeticiones.set(ip, peticionesRecientes);

  return false;
};



export default async function manejador(peticion, respuesta) {
  const startTime = Date.now();
  const ipCliente = peticion.headers["x-forwarded-for"] || peticion.connection?.remoteAddress || "desconocida";
  
  // Manejar preflight CORS
  if (peticion.method === "OPTIONS") {
    return respuesta.status(200).json({});
  }

  // Solo permitir POST
  if (peticion.method !== "POST") {
    return respuesta.status(405).json({ error: "Método no permitido" });
  }

  try {
    // Conectar a MongoDB si está disponible
    await connectDB();
    // Verificar que la API key esté configurada
    if (!process.env.GEMINI_API_KEY) {
      logger.error("GEMINI_API_KEY no está configurada");
      return respuesta.status(500).json({
        success: false,
        error: "Configuración del servidor incompleta",
        versiculos: [],
      });
    }

    // Verificar rate limiting por IP
    const ipCliente =
      peticion.headers["x-forwarded-for"] ||
      peticion.connection.remoteAddress ||
      "desconocida";

    if (verificarLimiteRatePorIp(ipCliente)) {
      await registrarBusqueda({
        userInput: peticion.body.userInput || "",
        success: false,
        error: "Rate limit excedido",
        ip: ipCliente,
        responseTime: Date.now() - startTime,
      });
      
      return respuesta.status(429).json({
        success: false,
        error: "Demasiadas peticiones. Por favor, espera un momento.",
        versiculos: [],
      });
    }

    const { userInput } = peticion.body;

    // Validar y sanitizar input
    const validacion = validateUserInput(userInput);
    
    if (!validacion.valid) {
      await registrarBusqueda({
        userInput: userInput || "",
        success: false,
        error: validacion.error,
        ip: ipCliente,
        responseTime: Date.now() - startTime,
      });
      
      return respuesta.status(400).json({
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
      return respuesta.status(200).json({
        ...cachedResponse,
        fromCache: true,
      });
    }

    // Verificar caché en memoria (fallback)
    const claveCache = generarClaveCache(inputSanitizado);
    const respuestaCache = obtenerDelCache(claveCache);

    if (respuestaCache) {
      return respuesta.status(200).json({
        ...respuestaCache,
        fromCache: true,
      });
    }

    // Usar backoff exponencial con timeout
    const resultado = await Promise.race([
      backoffExponencial(async () => {
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

        const respuesta = await modelo.generateContent(prompt);
        return respuesta;
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Timeout: La respuesta tardó demasiado")),
          45000
        )
      ),
    ]);

    // Verificar que la respuesta existe
    if (!resultado || !resultado.response) {
      throw new Error("El modelo no devolvió una respuesta válida");
    }

    let textoRespuesta = resultado.response.text().trim();

    if (!textoRespuesta) {
      throw new Error("El modelo devolvió una respuesta vacía");
    }

    // Extraer JSON de la respuesta
    let textoJson = textoRespuesta;
    
    // Intentar extraer JSON de bloques de código
    if (textoRespuesta.includes("```json")) {
      textoJson = textoRespuesta.split("```json")[1].split("```")[0].trim();
    } else if (textoRespuesta.includes("```")) {
      textoJson = textoRespuesta.split("```")[1].split("```")[0].trim();
    }

    // Limpiar caracteres de control
    textoJson = textoJson
      .replace(CONTROL_CHARS_REGEX, "")
      .trim();

    // Si no hay JSON válido, intentar encontrarlo con regex
    if (!textoJson.startsWith("{")) {
      const jsonMatch = textoJson.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        textoJson = jsonMatch[0];
      }
    }

    // Verificar si el JSON está incompleto y intentar repararlo
    if (textoJson && !textoJson.endsWith("}")) {
      logger.warn("JSON incompleto detectado, intentando reparar", {
        original: textoJson.substring(0, 200)
      });
      
      // Contar llaves abiertas vs cerradas
      const openBraces = (textoJson.match(/\{/g) || []).length;
      const closeBraces = (textoJson.match(/\}/g) || []).length;
      const openBrackets = (textoJson.match(/\[/g) || []).length;
      const closeBrackets = (textoJson.match(/\]/g) || []).length;
      
      // Cerrar strings abiertas
      const quotes = (textoJson.match(/"/g) || []).length;
      if (quotes % 2 !== 0) {
        textoJson += "\"";
      }
      
      // Cerrar arrays abiertos
      for (let i = 0; i < openBrackets - closeBrackets; i++) {
        textoJson += "]";
      }
      
      // Cerrar objetos abiertos
      for (let i = 0; i < openBraces - closeBraces; i++) {
        textoJson += "}";
      }
      
      logger.info("JSON reparado", {
        reparado: textoJson.substring(0, 200)
      });
    }

    if (!textoJson) {
      throw new Error("No se pudo extraer JSON de la respuesta del modelo");
    }

    let datos;
    try {
      datos = JSON.parse(textoJson);
    } catch (parseError) {
      logger.error("Error parseando JSON", {
        error: parseError.message,
        textoJson: textoJson.substring(0, 300),
        textoOriginal: textoRespuesta.substring(0, 300),
      });
      
      // Fallback: devolver respuesta genérica
      const versiculosFallback = await obtenerVersiculosCompletos([
        { libro: "salmos", capitulo: 23, versiculo: "4" },
        { libro: "filipenses", capitulo: 4, versiculo: "6-7" },
        { libro: "isaias", capitulo: 41, versiculo: "10" }
      ]);
      
      const respuestaFallback = {
        success: true,
        mensaje: "Dios está contigo en este momento. Él conoce tu situación y tiene un plan perfecto para ti. Confía en Su amor incondicional.",
        versiculos: versiculosFallback,
        fallback: true
      };
      
      // Guardar en caché
      guardarEnCache(claveCache, respuestaFallback);
      await setCache(cacheKey, respuestaFallback);
      
      return respuesta.status(200).json(respuestaFallback);
    }

    // Validar estructura de datos
    if (!datos.mensaje && !datos.versiculos) {
      throw new Error("Respuesta del modelo no tiene el formato esperado");
    }

    // Validar y filtrar versículos
    const versiculosValidos = validarVersiculos(datos.versiculos);

    // Obtener versículos completos de la API de la Biblia
    const versiculosCompletos = await obtenerVersiculosCompletos(versiculosValidos);

    const respuestaFinal = {
      success: true,
      mensaje: datos.mensaje || "",
      versiculos: versiculosCompletos,
    };

    // Guardar en caché en memoria
    guardarEnCache(claveCache, respuestaFinal);

    // Guardar en caché Redis
    await setCache(cacheKey, respuestaFinal);

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

    return respuesta.status(200).json(respuestaFinal);
  } catch (error) {
    logger.error("Error en suggest-verses", {
      error: error.message,
    });

    let mensajeError = error.message || "Error desconocido";
    let codigoEstado = 500;

    if (mensajeError.includes("API_KEY_INVALID")) {
      mensajeError = "API key inválida";
      codigoEstado = 401;
    } else if (mensajeError.includes("RESOURCE_EXHAUSTED")) {
      mensajeError = "Límite de Gemini alcanzado";
      codigoEstado = 429;
    } else if (mensajeError.includes("503")) {
      mensajeError = "Servicio no disponible temporalmente";
      codigoEstado = 503;
    } else if (mensajeError.includes("Timeout")) {
      mensajeError = "La petición tardó demasiado. Intenta de nuevo.";
      codigoEstado = 504;
    } else if (
      mensajeError.includes("parsear") ||
      mensajeError.includes("JSON")
    ) {
      mensajeError =
        "Error procesando respuesta del modelo. Intenta reformular tu consulta.";
      codigoEstado = 500;
    }

    // Registrar error en analytics
    await registrarBusqueda({
      userInput: peticion.body.userInput || "",
      success: false,
      error: mensajeError,
      ip: ipCliente,
      responseTime: Date.now() - startTime,
    });

    return respuesta.status(codigoEstado).json({
      success: false,
      error: mensajeError,
      versiculos: [],
      debug: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}

// Configuración de la API
export const config = {
  api: {
    bodyParser: true,
  },
};
