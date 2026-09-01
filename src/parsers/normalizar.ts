import { NombreFarmacia, ProductoExtraido, ProductoNormalizado } from '../types';

const RE_DOSIS_COMPLETA =
  /(\d+(?:[.,]\d+)?(?:mg|mcg|g|gr|ml|mmeq|ui|iu))(?:\s*[/-]\s*\d+(?:[.,]\d+)?(?:mg|mcg|g|gr|ml|mmeq|ui|iu))?/gi;
const RE_DOSIS_TOKEN = /(\d+(?:[.,]\d+)?(?:mg|mcg|g|gr|ml|mmeq|ui|iu))/gi;

export function limpiarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s+/,.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expandirPresentaciones(t: string): string {
  return t.replace(
    /\bx?\s*(\d+)\s*(tab|tablet|tabletes?|comp|comprimidos?|cap|caps|capsulas?)\b/gi,
    ' x $1 $2 '
  );
}

export function extraerDosis(texto: string): string[] {
  const t = texto.replace(/(\d)\s+(mg|mcg|g|gr|ml|mmeq|ui|iu)\b/g, '$1$2');
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = RE_DOSIS_TOKEN.exec(t)) !== null) {
    set.add(m[1].toLowerCase());
  }
  return [...set];
}

function quitarDosis(t: string): string {
  return t
    .replace(RE_DOSIS_COMPLETA, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*[/-]\s*\d+(?:[.,]\d+)?(?:\s*(?:mg|mcg|g|gr|ml|mmeq|ui|iu))?\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*[/-]/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\b(?=\s*mg\b)/g, ' ');
}

export function extraerCantidad(texto: string): number {
  const m = texto.match(/\bx\s*(\d+)\b/i);
  return m ? parseInt(m[1], 10) : 0;
}

const RE_FORMAS: Array<[string, RegExp]> = [
  ['comprimido', /\bcomp(?:rimido|rimidos)?\b/],
  ['tableta', /\b(?:tabletas?|tabletes?|tablet|tabl|tabs?)\b/],
  ['capsula', /\b(?:capsulas?|capsules?|capsul|caps?)\b/],
  ['jarabe', /\b(?:jarabe|jbe|susp(?:ension)?)\b/],
  ['gotas', /\bgotas?\b/],
  ['crema', /\b(?:crema|cream)\b/],
  ['inyectable', /\b(?:inyectable|ampolla|amp)\b/],
];

export function extraerForma(texto: string): string {
  for (const [forma, re] of RE_FORMAS) {
    if (re.test(texto)) return forma;
  }
  return '';
}

const RE_PALABRAS_FORMA =
  /\b(?:tabletas?|tabletes?|tablet|comprimidos?|capsulas?|capsules?|capsul|caps?|tabs?|tabl|jarabe|jbe|susp|suspension|gotas|crema|cream|inyectable|ampolla)\b/g;

const LABORATORIOS_CONOCIDOS = [
  'la sante',
  'neo quimica',
  'blue medical',
  'lab farma',
  'laboratorios farma',
  'genven',
  'calox',
  'dac',
  'alpharma',
  'angelus',
  'rowe',
  'kimiceg',
  'spefar',
  'valmorca',
  'plusandex',
  'capsuven',
  'biumak',
  'drotafarma',
  'laproff',
  'distrilab',
  'coaspharma',
  'aranda',
  'saval',
  'leti',
  'lagar',
  'casanor',
  'lattan medic',
  'megalabs',
];

const RE_FORMAS_CORTAS = /^(tab|tabletas|tablets|tabs|comprimidos|capsulas|caps|tabl)$/;

function extraerLaboratorio(textoOriginal: string, farmacia: NombreFarmacia, marca?: string): string {
  const t = limpiarTexto(textoOriginal);

  if (farmacia === 'Farmapaz') {
    const crudo = textoOriginal.toLowerCase();
    const parens = [...crudo.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean);
    const candidato = parens.find((p) => p.length > 1 && !RE_FORMAS_CORTAS.test(p));
    if (candidato) return candidato;
  }

  const conocido = LABORATORIOS_CONOCIDOS.find((l) => t.includes(l));
  if (conocido) return conocido;

  if (marca) {
    const limpiaMarca = limpiarTexto(marca)
      .replace(/\b(medicamentos|laboratorios|labs?)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (limpiaMarca) return limpiaMarca;
  }

  if (farmacia === 'Farmadón') {
    const partes = textoOriginal.split(/\s*-\s*/);
    if (partes.length > 1) {
      const lab = limpiarTexto(partes[partes.length - 1]);
      if (lab) return lab;
    }
  }

  if (farmacia === 'Farmatina' || farmacia === 'Farmadón') {
    const palabras = t.split(' ').filter(Boolean);
    const ultima = palabras[palabras.length - 1] ?? '';
    if (/^[a-z]{3,}$/.test(ultima)) return ultima;
  }

  return '';
}

export function normalizarProducto(producto: ProductoExtraido): ProductoNormalizado {
  let t = limpiarTexto(producto.nombreOriginal);
  t = t.replace(/(\d)\s+(mg|mcg|g|gr|ml|mmeq|ui|iu)\b/g, '$1$2');
  t = expandirPresentaciones(t);

  const dosis = extraerDosis(t);
  const cantidad = extraerCantidad(t);
  const forma = extraerForma(t);

  let resto = quitarDosis(t);
  resto = resto.replace(RE_PALABRAS_FORMA, ' ');
  resto = resto.replace(/\b(?:caja|blister|caja\s*x|presentacion|unidad|unidades)\b/g, ' ');
  resto = resto.replace(/\bx\s*\d+\b/g, ' ');

  const laboratorio = extraerLaboratorio(producto.nombreOriginal, producto.farmacia, producto.marca);
  if (laboratorio) {
    resto = resto.replace(new RegExp(`\\b${escaparRegex(laboratorio)}\\b`, 'g'), ' ');
  }

  const principioLimpio = resto.replace(/\s+/g, ' ').trim();
  const principiosActivos = principioLimpio
    ? principioLimpio
        .split(/[+/]/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    : [];

  const tLimpio = limpiarTexto(producto.nombreOriginal);
  const esCombo =
    dosis.length > 1 ||
    /\+/.test(tLimpio) ||
    /\/[a-z]/.test(tLimpio) ||
    /\b\d+(?:[.,]\d+)?\s*[/-]\s*\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|gr|ml|mmeq|ui|iu)\b/.test(tLimpio);

  return {
    ...producto,
    principiosActivos,
    dosis,
    laboratorio,
    cantidadUnidades: cantidad,
    formaFarmaceutica: forma,
    esCombo,
  };
}
