/**
 * Implementa backoff exponencial para reintentos de peticiones
 * @param {Function} funcion - Función a ejecutar con reintentos
 * @param {number} maxReintentos - Número máximo de reintentos
 * @returns {Promise<any>} - Resultado de la función
 */
export const backoffExponencial = async (funcion, maxReintentos = 3) => {
  let ultimoError;

  for (let i = 0; i < maxReintentos; i++) {
    try {
      return await funcion();
    } catch (error) {
      ultimoError = error;
      const mensajeError = error.message || "";

      if (
        mensajeError.includes("429") ||
        mensajeError.includes("503") ||
        mensajeError.includes("RESOURCE_EXHAUSTED")
      ) {
        const tiempoEspera = Math.pow(2, i) * 1000;
        await new Promise((resolve) => setTimeout(resolve, tiempoEspera));
        continue;
      }

      throw error;
    }
  }

  throw ultimoError;
};
