import axios from "axios";

const URL_BASE_API = "https://bible-api.deno.dev/api";
const VERSION_BIBLIA = "rv1960";
const TIMEOUT_API = 8000;

/**
 * Obtiene un versículo o rango de versículos desde la API de la Biblia
 */
export const obtenerVersiculo = async (libro, capitulo, versiculo) => {
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
export const formatearVersiculo = (respuestaApi, libro, capitulo) => {
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
 * Obtiene versículos completos de la API de la Biblia
 */
export const obtenerVersiculosCompletos = async (referencias) => {
  const versiculosCompletos = [];

  for (const ref of referencias) {
    try {
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
        versiculosCompletos.push(versiculoFormateado);
      }
    } catch (error) {
      continue;
    }
  }

  return versiculosCompletos;
};
