import { logger } from "../utils/logger.js";

export const errorHandler = (err, req, res, next) => {
  void next;

  logger.error("Error no manejado", {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
  });

  if (err.message === "No permitido por CORS") {
    return res.status(403).json({
      success: false,
      error: "Acceso no permitido",
    });
  }

  res.status(500).json({
    success: false,
    error: "Error interno del servidor",
  });
};
