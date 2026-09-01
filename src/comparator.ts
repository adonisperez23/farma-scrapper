import { RegistroPreparadoDB } from './types';

export interface FilaComparacion {
  medicamento_base_id: string;
  farmacia: string;
  laboratorio: string;
  nombre: string;
  presentacion: string;
  cantidad_unidades: number;
  precio_caja: number;
  precio_unitario: number;
  precio_normalizado: number;
  disponibilidad: boolean;
  url: string;
  tieneComponentesMixtos: boolean;
}

export interface ComparacionMedicamento {
  medicamento_base_id: string;
  patologia: string;
  principio_activo: string;
  dosis: string;
  filas: FilaComparacion[];
}

function presentacionLegible(cantidad: number, forma: string): string {
  const unidad = forma || 'unidad';
  return `x${cantidad || '?'} ${unidad}`;
}

export function construirComparacion(registros: RegistroPreparadoDB[]): ComparacionMedicamento[] {
  const agrupado = new Map<string, RegistroPreparadoDB[]>();

  for (const r of registros) {
    const lista = agrupado.get(r.medicamento_base_id) ?? [];
    lista.push(r);
    agrupado.set(r.medicamento_base_id, lista);
  }

  const resultado: ComparacionMedicamento[] = [];

  for (const [id, lista] of agrupado) {
    const primero = lista[0];
    const filas: FilaComparacion[] = lista.map((r) => ({
      medicamento_base_id: r.medicamento_base_id,
      farmacia: r.farmacia,
      laboratorio: r.laboratorio || '—',
      nombre: r.nombre_producto_farmacia,
      presentacion: presentacionLegible(r.cantidad_unidades, r.forma_farmaceutica),
      cantidad_unidades: r.cantidad_unidades,
      precio_caja: r.precio,
      precio_unitario: r.precio_unitario,
      precio_normalizado: r.precio_normalizado,
      disponibilidad: r.disponibilidad,
      url: r.url_producto,
      tieneComponentesMixtos: r.tiene_componentes_mixtos
    }));

    filas.sort((a, b) => {
      if (a.tieneComponentesMixtos !== b.tieneComponentesMixtos) {
        return a.tieneComponentesMixtos ? 1 : -1;
      }
      return a.precio_unitario - b.precio_unitario;
    });

    resultado.push({
      medicamento_base_id: id,
      patologia: primero.patologia,
      principio_activo: primero.principio_activo,
      dosis: primero.dosis,
      filas
    });
  }

  resultado.sort((a, b) => a.medicamento_base_id.localeCompare(b.medicamento_base_id));
  return resultado;
}

export function imprimirComparacion(comparaciones: ComparacionMedicamento[], tasaUsd: number | null): void {
  for (const comp of comparaciones) {
    console.log(`\n${'='.repeat(96)}`);
    console.log(`💊 ${comp.principio_activo} ${comp.dosis} (${comp.medicamento_base_id}) — ${comp.patologia}`);
    console.log(`${'='.repeat(96)}`);
    console.log(
      `${'Farmacia'.padEnd(11)} ${'Laboratorio'.padEnd(12)} ${'Presentación'.padEnd(13)} ${'Precio caja'.padStart(11)} ${'Bs/unidad'.padStart(10)} ${'Bs x30 (equiv)'.padStart(13)}  Disp.`
    );
    console.log('-'.repeat(96));

    comp.filas.forEach((f) => {
      console.log(
        `${f.farmacia.padEnd(11)} ${f.laboratorio.padEnd(12)} ${f.presentacion.padEnd(13)} ${f.precio_caja.toFixed(2).padStart(11)} ${f.precio_unitario.toFixed(2).padStart(10)} ${f.precio_normalizado.toFixed(2).padStart(13)}  ${f.disponibilidad ? 'sí' : 'no'}  ${f.url}`
      );
    });
  }

  if (comparaciones.length === 0) return;
  console.log(`\n💵 Tasa de referencia: ${tasaUsd ? `Bs ${tasaUsd}` : 'no disponible'}. Precios en Bs.`);
}