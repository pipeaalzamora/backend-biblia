import { GoogleGenerativeAI } from "@google/generative-ai";
import { backoffExponencial } from "../utils/backoff.js";
import { validarVersiculos } from "../utils/validadores.js";
import { obtenerVersiculosCompletos } from "../utils/bibleApi.js";
import { logger } from "../utils/logger.js";

const CONTROL_CHARS_REGEX = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}-${String.fromCharCode(159)}]`,
  "g"
);

// La IA es OPCIONAL: solo está activa si existe GEMINI_API_KEY.
export const iaConfigurada = () => Boolean(process.env.GEMINI_API_KEY);

// Inicialización perezosa: el modelo se crea una sola vez, y solo si hay clave.
let modeloCache = null;
const obtenerModelo = () => {
  if (!iaConfigurada()) return null;
  if (modeloCache) return modeloCache;

  const cliente = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  modeloCache = cliente.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048, topP: 0.95 },
  });
  return modeloCache;
};

// Validación mínima del input del usuario.
const validarInput = (texto) => {
  if (!texto || typeof texto !== "string") {
    return { valid: false, error: "Texto requerido" };
  }
  const limpio = texto.replace(CONTROL_CHARS_REGEX, "").trim();
  if (limpio.length < 2) return { valid: false, error: "Texto demasiado corto" };
  if (limpio.length > 500) return { valid: false, error: "Texto demasiado largo" };
  return { valid: true, sanitized: limpio.substring(0, 500) };
};

const extraerJson = (texto) => {
  let jsonText = texto;
  if (texto.includes("```json")) {
    jsonText = texto.split("```json")[1].split("```")[0].trim();
  } else if (texto.includes("```")) {
    jsonText = texto.split("```")[1].split("```")[0].trim();
  }
  jsonText = jsonText.replace(CONTROL_CHARS_REGEX, "").trim();
  if (!jsonText.startsWith("{")) {
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (match) jsonText = match[0];
  }
  return jsonText;
};

/**
 * Sugiere versículos a partir del texto libre del usuario.
 * Devuelve { success, mensaje, versiculos } siempre con forma estable.
 * Si la IA no está configurada o falla, devuelve success:false para que el
 * cliente caiga a su búsqueda local sin romperse.
 */
export const sugerirVersiculos = async (userInput) => {
  if (!iaConfigurada()) {
    return { success: false, error: "IA no configurada", versiculos: [] };
  }

  const validacion = validarInput(userInput);
  if (!validacion.valid) {
    return { success: false, error: validacion.error, versiculos: [] };
  }

  const modelo = obtenerModelo();
  const prompt = `Eres un pastor espiritual experto en la Biblia RV1960. Analiza la situación del usuario y encuentra versículos ESPECÍFICOS que hablen directamente a su necesidad.

Situación: ${validacion.sanitized}

Responde SOLO con este JSON (sin markdown):
{
  "mensaje": "Mensaje pastoral breve (80-100 palabras).",
  "versiculos": [
    {"libro": "nombre-libro", "capitulo": numero, "versiculo": "numero"}
  ]
}

CRÍTICO:
- 3 a 5 versículos relevantes a la situación.
- Libros en minúsculas sin acentos (ej: "salmos", "1-corintios").
- Cierra todas las comillas y llaves.`;

  const resultado = await backoffExponencial(() => modelo.generateContent(prompt));
  const texto = resultado?.response?.text?.().trim();

  if (!texto) {
    return { success: false, error: "Respuesta vacía del modelo", versiculos: [] };
  }

  let datos;
  try {
    datos = JSON.parse(extraerJson(texto));
  } catch (parseError) {
    logger.warn("IA: JSON inválido", { error: parseError.message });
    return { success: false, error: "Respuesta no parseable", versiculos: [] };
  }

  const versiculosValidos = validarVersiculos(datos.versiculos);
  const versiculosCompletos = await obtenerVersiculosCompletos(versiculosValidos);

  if (versiculosCompletos.length === 0) {
    return { success: false, error: "Sin versículos válidos", versiculos: [] };
  }

  return {
    success: true,
    mensaje: datos.mensaje || "",
    versiculos: versiculosCompletos,
  };
};
