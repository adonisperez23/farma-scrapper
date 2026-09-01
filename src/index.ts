import { medicamentosBase } from './data/medicamentos';
import { buscarEnFarmatodo } from './scrappers/farmatodo';
import { buscarEnFarmadon } from './scrappers/farmadon';
import { buscarEnFarmapaz } from './scrappers/farmapaz';
import { buscarEnFarmatina } from './scrappers/farmatina';
import { obtenerTasaDolar } from './scrappers/dolar';
import { calcularCoincidencia } from './utils/matcher';
import { convertirPrecio, normalizarPresentacion, precioUnitario } from './utils/precio';
import { normalizarProducto } from './parsers/normalizar';
import { construirComparacion, imprimirComparacion } from './comparator';
import { RegistroPreparadoDB } from './types';
import { sincronizarMedicamentosBase, upsertPreciosFarmacia } from './lib/upsert-precios';

export async function ejecutarFlujoExtraccionDiaria(): Promise<RegistroPreparadoDB[]> {
  console.log("🚀 Iniciando Flujo Diario de Extracción de Datos (TypeScript)...\n");

  const tasaDolar = await obtenerTasaDolar();
  if (tasaDolar) {
    console.log(`💵 Tasa del dólar oficial: Bs ${tasaDolar.usd} (fuente: ${tasaDolar.fuente})\n`);
  } else {
    console.warn('⚠️ No se pudo obtener la tasa del dólar; los precios en REF quedarán sin convertir.\n');
  }

  const registrosParaGuardar: RegistroPreparadoDB[] = [];

  for (const medBase of medicamentosBase) {
    console.log(`🔍 Procesando: ${medBase.principioActivo} (${medBase.dosis}) [Patología: ${medBase.patologia}]`);

    const [resultadosFarmatodo, resultadosFarmadon, resultadosFarmapaz, resultadosFarmatina] = await Promise.all([
      buscarEnFarmatodo(medBase.principioActivo),
      buscarEnFarmadon(medBase.principioActivo),
      buscarEnFarmapaz(medBase.principioActivo),
      buscarEnFarmatina(medBase.principioActivo)
    ]);

    const todosLosResultados = [...resultadosFarmatodo, ...resultadosFarmadon, ...resultadosFarmapaz, ...resultadosFarmatina];

    todosLosResultados.forEach(prod => {
      const normalizado = normalizarProducto(prod);
      const { esMatch, score } = calcularCoincidencia(normalizado, medBase);

      if (esMatch) {
        const precioEnBs =
          normalizado.moneda === 'REF' && tasaDolar
            ? convertirPrecio(normalizado.precio, tasaDolar.usd)
            : normalizado.precio;

        const precioPorUnidad = precioUnitario(precioEnBs, normalizado.cantidadUnidades);
        const normalizado30 = normalizarPresentacion(
          precioEnBs,
          normalizado.cantidadUnidades,
          medBase.presentacionReferencia
        );

        const presentacion =
          `${normalizado.cantidadUnidades ? `x${normalizado.cantidadUnidades}` : 'x?'} ${normalizado.formaFarmaceutica || 'unidad'}`.trim();

        const tieneComponentesMixtos = normalizado.esCombo || normalizado.principiosActivos.length > 1;

        registrosParaGuardar.push({
          medicamento_base_id: medBase.id,
          patologia: medBase.patologia,
          farmacia: normalizado.farmacia,
          nombre_producto_farmacia: normalizado.nombreOriginal,
          principio_activo: medBase.principioActivo,
          dosis: medBase.dosis,
          laboratorio: normalizado.laboratorio,
          es_combo: normalizado.esCombo,
          presentacion,
          cantidad_unidades: normalizado.cantidadUnidades,
          forma_farmaceutica: normalizado.formaFarmaceutica,
          clave_comparacion: `${medBase.id}-${String(medBase.dosis)}`,
          precio_original: normalizado.precio,
          moneda: normalizado.moneda,
          precio: Math.round(precioEnBs * 100) / 100,
          precio_unitario: precioPorUnidad,
          precio_normalizado: normalizado30,
          disponibilidad: normalizado.disponibilidad,
          url_producto: normalizado.urlProducto,
          score_similitud: score,
          tasa_bcv_usd: normalizado.moneda === 'REF' ? (tasaDolar?.usd ?? null) : null,
          fuente_tasa: normalizado.moneda === 'REF' ? (tasaDolar?.fuente ?? null) : null,
          fecha_actualizacion: new Date().toISOString(),
          tiene_componentes_mixtos: tieneComponentesMixtos
        });
      }
    });
  }

  console.log("\n✅ Flujo de extracción finalizado con éxito.");
  console.log(`📊 Total de coincidencias listas para la base de datos: ${registrosParaGuardar.length}`);
  console.log(JSON.stringify(registrosParaGuardar, null, 2));

  const comparacion = construirComparacion(registrosParaGuardar);
  imprimirComparacion(comparacion, tasaDolar?.usd ?? null);

  await sincronizarMedicamentosBase(medicamentosBase);
  await upsertPreciosFarmacia(registrosParaGuardar);

  return registrosParaGuardar;
}

ejecutarFlujoExtraccionDiaria();