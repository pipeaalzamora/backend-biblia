import { connectDB, isDBConnected } from "../config/database.js";
import { User } from "../models/User.js";
import { logger } from "../utils/logger.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).json({});
  }

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    await connectDB();

    const deviceId =
      req.method === "GET" ? req.query.deviceId : req.body?.deviceId;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "deviceId es requerido",
      });
    }

    if (!isDBConnected()) {
      return res.status(200).json({
        success: true,
        data: {
          favorites: req.body?.favorites || [],
          searchHistory: req.body?.searchHistory || [],
          preferences: req.body?.preferences || {},
        },
        offline: true,
      });
    }

    if (req.method === "GET") {
      // Obtener datos del usuario
      const user = await User.findOne({ deviceId });
      
      return res.status(200).json({
        success: true,
        data: user || { favorites: [], searchHistory: [], preferences: {} },
      });
    }

    if (req.method === "POST") {
      const { favorites, searchHistory, preferences } = req.body || {};

      // Sincronizar datos del usuario
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

      return res.status(200).json({
        success: true,
        data: user,
      });
    }

    return res.status(405).json({ error: "Método no permitido" });
  } catch (error) {
    logger.error("Error en sync-favorites", { error: error.message });
    return res.status(500).json({
      success: false,
      error: "Error sincronizando datos",
    });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
