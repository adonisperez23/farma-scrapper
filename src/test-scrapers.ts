import { buscarEnFarmatodo } from './scrappers/farmatodo';
import { buscarEnFarmadon } from './scrappers/farmadon';
import { buscarEnFarmapaz } from './scrappers/farmapaz';
import { buscarEnFarmatina } from './scrappers/farmatina';
import { obtenerTasaDolar } from './scrappers/dolar';
import { convertirPrecio, precioUnitario, normalizarPresentacion } from './utils/precio';
import { normalizarProducto } from './parsers/normalizar';
import { calcularCoincidencia } from './utils/matcher';
import { medicamentosBase } from './data/medicamentos';
import { ProductoExtraido } from './types';
import { construirComparacion, imprimirComparacion } from './comparator';
import { RegistroPreparadoDB } from './types';

function imprimirResultados(farmacia: string, productos: ProductoExtraido[], tasaUsd: number | null): void {
  console.log(`\n===== ${farmacia} (${productos.length} resultados crudos) =====`);

  if (productos.length === 0) {
    console.log('  (sin resultados)');
    return;
  }

  productos.forEach((p, i) => {
    const n = normalizarProducto(p);
    const precioBs = p.moneda === 'REF' && tasaUsd ? convertirPrecio(p.precio, tasaUsd) : p.precio;
    const unit = precioUnitario(precioBs, n.cantidadUnidades);

    console.log(`  ${i + 1}. ${p.nombreOriginal}`);
    console.log(`     → principio: [${n.principiosActivos.join(', ') || '?'}] | dosis: [${n.dosis.join(', ') || '?'}] | lab: ${n.laboratorio || '?'} | presentación: ${n.cantidadUnidades ? `x${n.cantidadUnidades}` : '?'} ${n.formaFarmaceutica || ''}${n.esCombo ? ' [COMBO]' : ''}`);
    console.log(`     Precio: ${p.precio} ${p.moneda} → Bs ${precioBs} (Bs/und: ${unit})`);
  });
}

async function testScrapers(): Promise<void> {
  console.log('🧪 Probando scrapers, normalización y matching...\n');

  const tasaDolar = await obtenerTasaDolar();
  if (tasaDolar) {
    console.log(`💵 Tasa del dólar oficial: Bs ${tasaDolar.usd} (fuente: ${tasaDolar.fuente}, actualización: ${tasaDolar.fechaActualizacion})`);
  } else {
    console.warn('⚠️ No se pudo obtener la tasa del dólar.');
  }
  const tasaUsd = tasaDolar?.usd ?? null;

  const query = 'amlodipina';

  const [farmatodo, farmadon, farmapaz, farmatina] = await Promise.all([
    buscarEnFarmatodo(query),
    buscarEnFarmadon(query),
    buscarEnFarmapaz(query),
    buscarEnFarmatina(query)
  ]);

  imprimirResultados('Farmatodo', farmatodo, tasaUsd);
  imprimirResultados('Farmadón', farmadon, tasaUsd);
  imprimirResultados('Farmapaz', farmapaz, tasaUsd);
  imprimirResultados('Farmatina', farmatina, tasaUsd);

  console.log('\n===== VALIDACIÓN DE MATCHING =====\n');
  const todos = [...farmatodo, ...farmadon, ...farmapaz, ...farmatina];
  const base = medicamentosBase[0];

  const registrosParaGuardar: RegistroPreparadoDB[] = [];

  todos.forEach((p) => {
    const n = normalizarProducto(p);
    const r = calcularCoincidencia(n, base);
    if (r.esMatch) {
      const precioBs = p.moneda === 'REF' && tasaUsd ? convertirPrecio(p.precio, tasaUsd) : p.precio;
      const unit = precioUnitario(precioBs, n.cantidadUnidades);

      console.log(`  ✔ ${n.farmacia} | ${p.nombreOriginal}`);
      console.log(`    score=${r.score} lab=${n.laboratorio} dosis=[${n.dosis.join(', ') || '?'}] combo=${n.esCombo}`);
      console.log(`    Precio: ${p.precio} ${p.moneda} → Bs ${precioBs} (Bs/und: ${unit})`);

      const precioPorUnidad = precioUnitario(precioBs, n.cantidadUnidades);
      const normalizado30 = normalizarPresentacion(precioBs, n.cantidadUnidades, base.presentacionReferencia);
      const presentacion = `${n.cantidadUnidades ? `x${n.cantidadUnidades}` : 'x?'} ${n.formaFarmaceutica || 'unidad'}`.trim();
      const tieneComponentesMixtos = n.esCombo || n.principiosActivos.length > 1;

      registrosParaGuardar.push({
        medicamento_base_id: base.id,
        patologia: base.patologia,
        farmacia: n.farmacia,
        nombre_producto_farmacia: n.nombreOriginal,
        principio_activo: base.principioActivo,
        dosis: base.dosis,
        laboratorio: n.laboratorio,
        es_combo: n.esCombo,
        presentacion,
        cantidad_unidades: n.cantidadUnidades,
        forma_farmaceutica: n.formaFarmaceutica,
        clave_comparacion: `${base.id}-${String(base.dosis)}`,
        precio_original: n.precio,
        moneda: n.moneda,
        precio: Math.round(precioBs * 100) / 100,
        precio_unitario: precioPorUnidad,
        precio_normalizado: normalizado30,
        disponibilidad: n.disponibilidad,
        url_producto: n.urlProducto,
        score_similitud: r.score,
        tasa_bcv_usd: n.moneda === 'REF' ? tasaUsd : null,
        fuente_tasa: n.moneda === 'REF' ? (tasaDolar?.fuente ?? null) : null,
        fecha_actualizacion: new Date().toISOString(),
        tiene_componentes_mixtos: tieneComponentesMixtos
      });
    }
  });

  console.log('\n===== TABLA DE COMPARACIÓN FINAL =====\n');
  const comparacion = construirComparacion(registrosParaGuardar);
  imprimirComparacion(comparacion, tasaUsd);
}

testScrapers();