import { supabase } from './supabase';
import { RegistroPreparadoDB, MedicamentoBase } from '../types';

export async function sincronizarMedicamentosBase(medicamentos: MedicamentoBase[]): Promise<void> {
  const payload = medicamentos.map(m => ({
    id: m.id,
    patologia: m.patologia,
    principio_activo: m.principioActivo,
    dosis: m.dosis,
    alias: m.alias ?? [],
    presentacion_referencia: m.presentacionReferencia
  }));

  const { error } = await supabase
    .from('medicamentos_base')
    .upsert(payload, { onConflict: 'id' });

  if (error) {
    throw new Error(`Error upsert medicamentos_base: ${error.message}`);
  }
  
  console.log(`📋 Medicamentos base sincronizados: ${payload.length}`);
}

export async function upsertPreciosFarmacia(registros: RegistroPreparadoDB[]): Promise<number> {
  if (registros.length === 0) {
    console.log('📭 No hay registros para subir a Supabase');
    return 0;
  }

  const payload = registros.map(r => ({
    medicamento_base_id: r.medicamento_base_id,
    farmacia: r.farmacia,
    nombre_producto_farmacia: r.nombre_producto_farmacia,
    principio_activo: r.principio_activo,
    dosis: r.dosis,
    laboratorio: r.laboratorio,
    es_combo: r.es_combo,
    presentacion: r.presentacion,
    cantidad_unidades: r.cantidad_unidades,
    forma_farmaceutica: r.forma_farmaceutica,
    clave_comparacion: r.clave_comparacion,
    precio_original: r.precio_original,
    moneda: r.moneda,
    precio_bs: r.precio,
    precio_unitario: r.precio_unitario,
    precio_normalizado: r.precio_normalizado,
    disponibilidad: r.disponibilidad,
    url_producto: r.url_producto,
    score_similitud: r.score_similitud,
    tasa_bcv_usd: r.tasa_bcv_usd,
    fuente_tasa: r.fuente_tasa,
    fecha_actualizacion: r.fecha_actualizacion,
    tiene_componentes_mixtos: r.tiene_componentes_mixtos
  }));

  const { data, error } = await supabase
    .from('precios_farmacia')
    .upsert(payload, { 
      onConflict: 'medicamento_base_id,farmacia,nombre_producto_farmacia',
      ignoreDuplicates: false 
    })
    .select('id');

  if (error) {
    throw new Error(`Error upsert precios_farmacia: ${error.message}`);
  }

  const count = data?.length ?? 0;
  console.log(`📤 Supabase: ${count} precios procesados (insert/upsert)`);
  return count;
}