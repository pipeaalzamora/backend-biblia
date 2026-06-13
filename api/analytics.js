import { connectDB } from "../config/database.js";
import { obtenerEstadisticas, obtenerVersiculosPopulares } from "../services/analyticsService.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).json({});
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    await connectDB();

    const [estadisticas, versiculosPopulares] = await Promise.all([
      obtenerEstadisticas(),
      obtenerVersiculosPopulares(10),
    ]);

    return res.status(200).json({
      success: true,
      estadisticas,
      versiculosPopulares,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Error obteniendo analytics",
    });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
