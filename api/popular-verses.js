import { connectDB } from "../config/database.js";
import { obtenerVersiculosPopulares } from "../services/analyticsService.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).json({});
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    await connectDB();

    const limit = parseInt(req.query.limit) || 20;
    const versiculos = await obtenerVersiculosPopulares(limit);

    return res.status(200).json({
      success: true,
      versiculos,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Error obteniendo versículos populares",
    });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
