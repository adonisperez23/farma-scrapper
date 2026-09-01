import { MedicamentoBase, ProductoNormalizado, ResultadoMatch } from '../types';
import { limpiarTexto, extraerDosis } from '../parsers/normalizar';

function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const bigrams = (s: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
  };

  const ba = bigrams(a);
  const bb = bigrams(b);

  let inter = 0;
  for (const [bg, count] of ba) {
    inter += Math.min(count, bb.get(bg) || 0);
  }

  return (2 * inter) / (ba.size + bb.size);
}

export function normalizarTexto(texto: string): string {
  return limpiarTexto(texto);
}

function normalizarPrincipio(p: string): string {
  return limpiarTexto(p);
}

function principiosCoinciden(prodPrincipios: string[], basePrincipio: string): boolean {
  const base = normalizarPrincipio(basePrincipio);
  const baseTokens = base.split(' ').filter((t) => t.length >= 3);
  if (baseTokens.length === 0) return false;
  const key = baseTokens[0];
  const prefijoClave = key.slice(0, 6);

  return prodPrincipios.some((p) => {
    const pp = normalizarPrincipio(p);
    if (!pp) return false;
    if (pp === base) return true;
    if (pp.includes(key) || base.includes(pp)) return true;
    if (pp.startsWith(prefijoClave)) return true;
    if (pp.slice(0, 6) === prefijoClave) return true;
    return diceCoefficient(pp, key) >= 0.6;
  });
}

function numeroDosis(d: string): number {
  return parseFloat(d.split('/')[0].replace(/[^0-9.,]/g, '').replace(',', '.'));
}

function dosisCoinciden(prodDosis: string[], baseDosis: string): boolean {
  const numBase = numeroDosis(baseDosis);
  if (Number.isNaN(numBase)) return false;

  return prodDosis.some((d) => {
    const num = numeroDosis(d);
    return !Number.isNaN(num) && Math.abs(num - numBase) < 1e-6;
  });
}

function puntajeNombre(nombre: string, base: MedicamentoBase): number {
  const objetivo = normalizarTexto(`${base.principioActivo} ${base.dosis}`);
  const limpio = normalizarTexto(nombre);
  return parseFloat(diceCoefficient(limpio, objetivo).toFixed(2));
}

export function calcularCoincidencia(
  producto: ProductoNormalizado,
  medBase: MedicamentoBase
): ResultadoMatch {
  if (producto.esCombo) {
    return { esMatch: false, score: 0 };
  }

  const dosisBase = normalizarTexto(medBase.dosis).replace(/\s+/g, '');

  const parseoCompleto = producto.principiosActivos.length > 0 && producto.dosis.length > 0;

  if (parseoCompleto) {
    const principioOK = principiosCoinciden(producto.principiosActivos, medBase.principioActivo);
    const dosisOK = dosisCoinciden(producto.dosis, medBase.dosis);

    if (principioOK && dosisOK) {
      return {
        esMatch: true,
        score: Math.max(puntajeNombre(producto.nombreOriginal, medBase), 0.5)
      };
    }
    return { esMatch: false, score: puntajeNombre(producto.nombreOriginal, medBase) };
  }

  const nombreLimpio = normalizarTexto(producto.nombreOriginal);
  const tieneDosis = nombreLimpio.includes(dosisBase);
  const puntaje = diceCoefficient(nombreLimpio, normalizarTexto(`${medBase.principioActivo} ${medBase.dosis}`));

  if (puntaje >= 0.7 || (puntaje >= 0.5 && tieneDosis)) {
    return { esMatch: true, score: parseFloat(puntaje.toFixed(2)) };
  }

  return { esMatch: false, score: parseFloat(puntaje.toFixed(2)) };
}

export { extraerDosis };
