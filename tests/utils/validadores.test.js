import { describe, it, expect } from "vitest";
import { validarReferencia, validarVersiculos } from "../../utils/validadores.js";

describe("validadores bíblicos", () => {
  it("acepta referencias simples válidas", () => {
    expect(validarReferencia("juan", 3, "16")).toBe(true);
    expect(validarReferencia("1-corintios", 13, "4")).toBe(true);
  });

  it("acepta rangos válidos", () => {
    expect(validarReferencia("filipenses", 4, "6-7")).toBe(true);
  });

  it("rechaza libros, capítulos y rangos inválidos", () => {
    expect(validarReferencia("libro-falso", 1, "1")).toBe(false);
    expect(validarReferencia("juan", 0, "1")).toBe(false);
    expect(validarReferencia("juan", 3, "7-6")).toBe(false);
  });

  it("filtra arrays de referencias", () => {
    const resultado = validarVersiculos([
      { libro: "salmos", capitulo: 23, versiculo: "1" },
      { libro: "falso", capitulo: 1, versiculo: "1" },
      null,
    ]);

    expect(resultado).toEqual([
      { libro: "salmos", capitulo: 23, versiculo: "1" },
    ]);
  });
});
