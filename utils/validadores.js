// Libros válidos de la Biblia RV1960
const LIBROS_VALIDOS = new Set([
  "genesis", "exodo", "levitico", "numeros", "deuteronomio",
  "josue", "jueces", "rut", "1-samuel", "2-samuel",
  "1-reyes", "2-reyes", "1-cronicas", "2-cronicas",
  "esdras", "nehemias", "ester", "job", "salmos",
  "proverbios", "eclesiastes", "cantares", "isaias", "jeremias",
  "lamentaciones", "ezequiel", "daniel", "oseas", "joel",
  "amos", "abdias", "jonas", "miqueas", "nahum",
  "habacuc", "sofonias", "hageo", "zacarias", "malaquias",
  "mateo", "marcos", "lucas", "juan", "hechos",
  "romanos", "1-corintios", "2-corintios", "galatas", "efesios",
  "filipenses", "colosenses", "1-tesalonicenses", "2-tesalonicenses",
  "1-timoteo", "2-timoteo", "tito", "filemon", "hebreos",
  "santiago", "1-pedro", "2-pedro", "1-juan", "2-juan",
  "3-juan", "judas", "apocalipsis"
]);

/**
 * Valida que una referencia bíblica sea válida
 * @param {string} libro - Nombre del libro
 * @param {number} capitulo - Número del capítulo
 * @param {string|number} versiculo - Número del versículo o rango
 * @returns {boolean} - true si es válida
 */
export const validarReferencia = (libro, capitulo, versiculo) => {
  if (!libro || !LIBROS_VALIDOS.has(libro.toLowerCase())) {
    return false;
  }

  const cap = parseInt(capitulo);
  if (isNaN(cap) || cap < 1) {
    return false;
  }

  // Validar versículo (puede ser número o rango como "6-7")
  const versiculoStr = String(versiculo);
  if (versiculoStr.includes("-")) {
    const [inicio, fin] = versiculoStr.split("-").map(v => parseInt(v));
    return !isNaN(inicio) && !isNaN(fin) && inicio > 0 && fin > 0 && inicio <= fin;
  }

  const vers = parseInt(versiculoStr);
  return !isNaN(vers) && vers > 0;
};

/**
 * Valida un array de versículos sugeridos
 * @param {Array} versiculos - Array de objetos {libro, capitulo, versiculo}
 * @returns {Array} - Array filtrado con solo versículos válidos
 */
export const validarVersiculos = (versiculos) => {
  if (!Array.isArray(versiculos)) {
    return [];
  }

  return versiculos.filter(v => 
    v && 
    typeof v === "object" && 
    validarReferencia(v.libro, v.capitulo, v.versiculo)
  );
};
