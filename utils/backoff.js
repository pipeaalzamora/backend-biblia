/**
 * Backoff exponencial para reintentos ante errores transitorios del modelo.
 * @param {Function} funcion - Función async a ejecutar con reintentos.
 * @param {number} maxReintentos - Número máximo de reintentos.
 */
export const backoffExponencial = async (funcion, maxReintentos = 3) => {
  let ultimoError;

  for (let i = 0; i < maxReintentos; i++) {
    try {
      return await funcion();
    } catch (error) {
      ultimoError = error;
      const mensaje = error.message || "";

      if (
        mensaje.includes("429") ||
        mensaje.includes("503") ||
        mensaje.includes("RESOURCE_EXHAUSTED")
      ) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** i * 1000));
        continue;
      }

      throw error;
    }
  }

  throw ultimoError;
};
