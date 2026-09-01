import axios from 'axios';
import * as cheerio from 'cheerio';
import { ProductoExtraido } from '../types';
import { detectarMoneda, parsePrecioVE } from '../utils/precio';

export async function buscarEnFarmadon(query: string): Promise<ProductoExtraido[]> {
  try {
    const url = `https://www.farmadon.com.ve/tienda/?per_page=100&s=${encodeURIComponent(query)}&post_type=product&dgwt_wcas=1`;

    const response = await axios.get<string>(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 12000
    });

    const $ = cheerio.load(response.data);
    const resultados: ProductoExtraido[] = [];

    $('.product-type-simple').each((_, element) => {
      const $el = $(element);
      const $titulo = $el.find('.heading-title.product-name a');
      const nombre = $titulo.text().trim();
      const urlProducto = $titulo.attr('href');
      const precioTexto = $el
        .find('.price .amount, .woocommerce-Price-amount')
        .first()
        .text()
        .trim();

      if (nombre && precioTexto) {
        const moneda = detectarMoneda(precioTexto);
        const precio = parsePrecioVE(precioTexto);

        resultados.push({
          farmacia: 'Farmadón',
          nombreOriginal: nombre,
          precio,
          moneda,
          disponibilidad: true,
          urlProducto: urlProducto || 'https://www.farmadon.com.ve'
        });
      }
    });

    return resultados;
  } catch (error) {
    const err = error as Error;
    console.error(`[Farmadón Error] Búsqueda "${query}":`, err.message);
    return [];
  }
}
