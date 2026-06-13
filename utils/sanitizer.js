/**
 * Sanitiza y valida inputs del usuario
 */

/**
 * Sanitiza texto del usuario removiendo caracteres peligrosos
 */
export const sanitizeUserInput = (input) => {
  if (typeof input !== "string") {
    return "";
  }

  return input
    .trim()
    .replace(/[<>]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .substring(0, 1000);
};

/**
 * Valida que el input del usuario sea seguro
 */
export const validateUserInput = (input) => {
  if (!input || typeof input !== "string") {
    return {
      valid: false,
      error: "Entrada inválida",
    };
  }

  const sanitized = sanitizeUserInput(input);

  if (sanitized.length === 0) {
    return {
      valid: false,
      error: "El texto no puede estar vacío",
    };
  }

  if (sanitized.length < 3) {
    return {
      valid: false,
      error: "El texto es demasiado corto",
    };
  }

  if (sanitized.length > 1000) {
    return {
      valid: false,
      error: "El texto es demasiado largo. Máximo 1000 caracteres.",
    };
  }

  return {
    valid: true,
    sanitized,
  };
};
