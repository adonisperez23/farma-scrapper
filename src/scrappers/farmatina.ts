import axios from 'axios';
import * as cheerio from 'cheerio';
import { ProductoExtraido } from '../types';
import { detectarMoneda, parsePrecioVE } from '../utils/precio';

const BASE_URL = 'https://farmatina.com';

export async function buscarEnFarmatina(query: string): Promise<ProductoExtraido[]> {
  try {
    const url = `${BASE_URL}/shop?search=${encodeURIComponent(query)}`;

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

    $('form.zenith-product-card').each((_, element) => {
      const $el = $(element);
      const nombre = $el.find('a[itemprop="name"]').text().trim();
      const href = $el.find('a[itemprop="url"]').attr('href');
      const $precio = $el.find('.product_price');
      const precioTexto = $precio.find('.oe_currency_value').last().text().trim();

      if (nombre && href && precioTexto) {
        resultados.push({
          farmacia: 'Farmatina',
          nombreOriginal: nombre,
          precio: parsePrecioVE(precioTexto),
          moneda: detectarMoneda($precio.text()),
          disponibilidad: true,
          urlProducto: new URL(href, BASE_URL).href
        });
      }
    });

    return resultados;
  } catch (error) {
    const err = error as Error;
    console.error(`[Farmatina Error] Búsqueda "${query}":`, err.message);
    return [];
  }
}