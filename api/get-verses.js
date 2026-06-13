import axios from "axios";

const URL_BASE_API = "https://bible-api.deno.dev/api";
const VERSION_BIBLIA = "rv1960";
const TIMEOUT_API = 8000;

/**
 * Obtiene un versículo o rango de versículos desde la API de la Biblia
 */
const obtenerVersiculo = async (libro, capitulo, versiculo) => {
  try {
    if (!libro || !capitulo || !versiculo) {
      return {
        success: false,
        error: "Parámetros inválidos para obtener versículo",
      };
    }

    const url = `${URL_BASE_API}/read/${VERSION_BIBLIA}/${libro}/${capitulo}/${versiculo}`;
    const respuesta = await axios.get(url, { timeout: TIMEOUT_API });
    
    return {
      success: true,
      data: respuesta.data,
    };
  } catch (error) {
    let mensajeError = "Error al obtener el versículo";
    
    if (error.response?.status === 404) {
      mensajeError = "Versículo no encontrado";
    } else if (error.code === "ECONNABORTED") {
      mensajeError = "Tiempo de espera agotado";
    }
    
    return {
      success: false,
      error: mensajeError,
    };
  }
};

/**
 * Formatea la respuesta de la API para mostrarla en la interfaz
 */
const formatearVersiculo = (respuestaApi, libro, capitulo) => {
  const capitalizarPrimeraLetra = (texto) => {
    return texto
      .split("-")
      .map(palabra => palabra.charAt(0).toUpperCase() + palabra.slice(1))
      .join(" ");
  };

  if (Array.isArray(respuestaApi)) {
    const textoVersiculos = respuestaApi.map(v => v.verse).join(" ");
    const numerosVersiculos = respuestaApi.map(v => v.number);
    const referencia = numerosVersiculos.length > 1 
      ? `${capitalizarPrimeraLetra(libro)} ${capitulo}:${numerosVersiculos[0]}-${numerosVersiculos[numerosVersiculos.length - 1]}`
      : `${capitalizarPrimeraLetra(libro)} ${capitulo}:${numerosVersiculos[0]}`;
    
    return {
      referencia: `${referencia} RV1960`,
      texto: textoVersiculos,
    };
  }
  
  return {
    referencia: `${capitalizarPrimeraLetra(libro)} ${capitulo}:${respuestaApi.number} RV1960`,
    texto: respuestaApi.verse,
  };
};

/**
 * Endpoint para obtener versículos completos
 */
export default async function manejador(peticion, respuesta) {
  if (peticion.method === "OPTIONS") {
    return respuesta.status(200).json({});
  }

  if (peticion.method !== "POST") {
    return respuesta.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { referencias } = peticion.body;

    if (!Array.isArray(referencias) || referencias.length === 0) {
      return respuesta.status(400).json({
        success: false,
        error: "Se requiere un array de referencias",
      });
    }

    if (referencias.length > 10) {
      return respuesta.status(400).json({
        success: false,
        error: "Máximo 10 versículos por petición",
      });
    }

    const versiculosObtenidos = [];

    for (const ref of referencias) {
      const resultado = await obtenerVersiculo(
        ref.libro,
        ref.capitulo,
        ref.versiculo
      );

      if (resultado.success) {
        const versiculoFormateado = formatearVersiculo(
          resultado.data,
          ref.libro,
          ref.capitulo
        );
        versiculosObtenidos.push(versiculoFormateado);
      }
    }

    return respuesta.status(200).json({
      success: true,
      versiculos: versiculosObtenidos,
    });
  } catch (error) {
    return respuesta.status(500).json({
      success: false,
      error: "Error al obtener versículos",
    });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
