import axios from 'axios';
import * as cheerio from 'cheerio';
import { ProductoExtraido } from '../types';
import { detectarMoneda, parsePrecioVE } from '../utils/precio';

export async function buscarEnFarmapaz(query: string): Promise<ProductoExtraido[]> {
  try {
    const url = `https://farmapazvenezuela.com/?s=${encodeURIComponent(query)}`;

    const response = await axios.get<string>(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const resultados: ProductoExtraido[] = [];

    $('.sp-card').each((_, element) => {
      const $el = $(element);
      const $titulo = $el.find('.sp-card-title a');
      const nombre = $titulo.text().trim();
      const urlProducto = $titulo.attr('href');

      const precioTexto = $el
        .find('.sp-card-price-sale .woocommerce-Price-amount bdi, .sp-card-price-normal .woocommerce-Price-amount bdi')
        .first()
        .text()
        .trim();
      const sinStock = $el.find('.sp-card-badge-low').length > 0;

      if (nombre && urlProducto && precioTexto) {
        const moneda = detectarMoneda(precioTexto);
        const precio = parsePrecioVE(precioTexto);

        resultados.push({
          farmacia: 'Farmapaz',
          nombreOriginal: nombre,
          precio,
          moneda,
          disponibilidad: !sinStock,
          urlProducto
        });
      }
    });

    return resultados;
  } catch (error) {
    const err = error as Error;
    console.error(`[Farmapaz Error] Búsqueda "${query}":`, err.message);
    return [];
  }
}
