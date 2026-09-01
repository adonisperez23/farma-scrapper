import { Moneda } from '../types';

export function parsePrecioVE(texto: string): number {
  const limpio = texto.replace(/[^0-9.,]/g, '');

  if (!limpio) return 0;

  const lastDot = limpio.lastIndexOf('.');
  const lastComma = limpio.lastIndexOf(',');
  const lastSep = Math.max(lastDot, lastComma);

  if (lastSep === -1) return parseFloat(limpio) || 0;

  const esComaDecimal = lastComma > lastDot;
  let numero = limpio;

  if (esComaDecimal) {
    numero = limpio.replace(/\./g, '').replace(',', '.');
  } else {
    numero = limpio.replace(/,/g, '');
  }

  return parseFloat(numero) || 0;
}

export function detectarMoneda(texto: string): Moneda {
  const limpio = texto.toLowerCase();

  if (/\bref\.?\b|\$|us\$|d[oó]lares?/.test(limpio)) return 'REF';
  if (/\bbs\.?\b|bol[ií]var(es)?/.test(limpio)) return 'Bs';

  return 'Bs';
}

export function convertirPrecio(ref: number, tasa: number): number {
  return Math.round(ref * tasa * 100) / 100;
}

export function precioUnitario(precio: number, cantidad: number): number {
  if (!cantidad || cantidad <= 0) return precio;
  return Math.round((precio / cantidad) * 100) / 100;
}

export function normalizarPresentacion(precio: number, cantidad: number, referencia: number): number {
  if (!cantidad || cantidad <= 0) return precio;
  return Math.round((precio / cantidad) * (referencia || 30) * 100) / 100;
}
