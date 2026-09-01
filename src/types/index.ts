export interface MedicamentoBase {
  id: string;
  patologia: 'Hipertensión' | 'Diabetes Tipo 2' | 'General';
  principioActivo: string;
  dosis: string;
  alias?: string[];
  presentacionReferencia: number;
}

export type NombreFarmacia = 'Farmatodo' | 'Farmadón'| 'Farmapaz'| 'Farmatina';

export type Moneda = 'Bs' | 'REF';

export interface ProductoExtraido {
  farmacia: NombreFarmacia;
  nombreOriginal: string;
  precio: number;
  moneda: Moneda;
  disponibilidad: boolean;
  urlProducto: string;
  marca?: string;
}

export interface ProductoNormalizado extends ProductoExtraido {
  principiosActivos: string[];
  dosis: string[];
  laboratorio: string;
  cantidadUnidades: number;
  formaFarmaceutica: string;
  esCombo: boolean;
}

export interface TasaDolar {
  usd: number;
  fuente: string;
  fechaActualizacion: string;
}

export interface RegistroPreparadoDB {
  medicamento_base_id: string;
  patologia: string;
  farmacia: NombreFarmacia;
  nombre_producto_farmacia: string;
  principio_activo: string;
  dosis: string;
  laboratorio: string;
  es_combo: boolean;
  presentacion: string;
  cantidad_unidades: number;
  forma_farmaceutica: string;
  clave_comparacion: string;
  precio_original: number;
  moneda: Moneda;
  precio: number;
  precio_unitario: number;
  precio_normalizado: number;
  disponibilidad: boolean;
  url_producto: string;
  score_similitud: number;
  tasa_bcv_usd: number | null;
  fuente_tasa: string | null;
  fecha_actualizacion: string;
  tiene_componentes_mixtos: boolean;
}

export interface ResultadoMatch {
  esMatch: boolean;
  score: number;
}
