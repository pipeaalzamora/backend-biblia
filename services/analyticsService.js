import { Search } from "../models/Search.js";
import { Verse } from "../models/Verse.js";
import { logger } from "../utils/logger.js";
import crypto from "crypto";
import { isDBConnected } from "../config/database.js";

/**
 * Hash de IP para privacidad
 */
const hashIP = (ip) => {
  const salt = process.env.IP_SALT || "default-salt";
  return crypto.createHash("sha256").update(`${ip}${salt}`).digest("hex");
};

const normalizarLibro = (libro) => {
  return libro
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-");
};

const parseReferencia = (referencia) => {
  const limpia = referencia.replace(/\s+RV1960$/i, "").trim();
  const match = limpia.match(/^(.+?)\s+(\d+):([\d-]+)/);

  if (!match) {
    return {
      libro: "desconocido",
      capitulo: 0,
      versiculo: "0",
    };
  }

  return {
    libro: normalizarLibro(match[1]),
    capitulo: Number.parseInt(match[2], 10),
    versiculo: match[3],
  };
};

/**
 * Registra una búsqueda en analytics
 */
export const registrarBusqueda = async (datos) => {
  if (!isDBConnected()) return;

  try {
    const search = new Search({
      userInput: datos.userInput,
      temas: datos.temas || [],
      versiculosRetornados: datos.versiculos || [],
      timestamp: new Date(),
      ipHash: datos.ip ? hashIP(datos.ip) : null,
      success: datos.success,
      errorMessage: datos.error,
      responseTime: datos.responseTime,
    });

    await search.save();
  } catch (error) {
    logger.error("Error registrando búsqueda", { error: error.message });
  }
};

/**
 * Actualiza estadísticas de versículo
 */
export const actualizarEstadisticasVersiculo = async (referencia, texto, tipo = "consulta") => {
  if (!isDBConnected()) return;

  try {
    const referenciaParseada = parseReferencia(referencia);
    const update = {
      $set: {
        ...referenciaParseada,
        lastAccessed: new Date(),
        texto,
      },
    };

    if (tipo === "consulta") {
      update.$inc = { consultaCount: 1 };
    } else if (tipo === "compartido") {
      update.$inc = { compartidoCount: 1 };
    } else if (tipo === "favorito") {
      update.$inc = { favoritoCount: 1 };
    }

    await Verse.findOneAndUpdate(
      { referencia },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    logger.error("Error actualizando estadísticas de versículo", { error: error.message });
  }
};

/**
 * Obtiene versículos más populares
 */
export const obtenerVersiculosPopulares = async (limite = 10) => {
  if (!isDBConnected()) return [];

  try {
    return await Verse.find()
      .sort({ consultaCount: -1 })
      .limit(limite)
      .select("referencia texto consultaCount compartidoCount favoritoCount");
  } catch (error) {
    logger.error("Error obteniendo versículos populares", { error: error.message });
    return [];
  }
};

/**
 * Obtiene estadísticas generales
 */
export const obtenerEstadisticas = async () => {
  if (!isDBConnected()) return null;

  try {
    const [totalBusquedas, busquedasExitosas, busquedasHoy] = await Promise.all([
      Search.countDocuments(),
      Search.countDocuments({ success: true }),
      Search.countDocuments({
        timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }),
    ]);

    return {
      totalBusquedas,
      busquedasExitosas,
      busquedasHoy,
      tasaExito: totalBusquedas > 0 ? (busquedasExitosas / totalBusquedas * 100).toFixed(2) : 0,
    };
  } catch (error) {
    logger.error("Error obteniendo estadísticas", { error: error.message });
    return null;
  }
};
