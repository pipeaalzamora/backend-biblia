import mongoose from "mongoose";
import { logger } from "../utils/logger.js";

let isConnected = false;

export const connectDB = async () => {
  if (isConnected) {
    logger.info("MongoDB ya está conectado");
    return;
  }

  try {
    const mongoUri = process.env.MONGODB_URI;
    
    if (!mongoUri) {
      logger.warn("MONGODB_URI no configurado - funcionando sin base de datos");
      return;
    }

    const conn = await mongoose.connect(mongoUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    isConnected = true;
    logger.info("MongoDB conectado", {
      host: conn.connection.host,
      name: conn.connection.name,
    });
  } catch (error) {
    logger.error("Error conectando a MongoDB", {
      error: error.message,
    });
    // No lanzar error - la app puede funcionar sin DB
  }
};

export const disconnectDB = async () => {
  if (!isConnected) return;
  
  try {
    await mongoose.disconnect();
    isConnected = false;
    logger.info("MongoDB desconectado");
  } catch (error) {
    logger.error("Error desconectando MongoDB", {
      error: error.message,
    });
  }
};

export const isDBConnected = () => isConnected;
