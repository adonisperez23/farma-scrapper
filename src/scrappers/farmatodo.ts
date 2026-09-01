import axios from 'axios';
import { ProductoExtraido } from '../types';

const ALGOLIA_APP_ID = 'VCOJEYD2PO';
const ALGOLIA_API_KEY = '869a91e98550dd668b8b1dc04bca9011';
const ALGOLIA_INDEX = 'products-venezuela';
const ALGOLIA_URL = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`;

interface FarmatodoAlgoliaHit {
  objectID: string | number;
  mediaDescription?: string;
  marca?: string;
  brand?: string;
  activePrinciple?: string;
  unitPrice?: number;
  offerPrice?: number;
  offerStartDate?: number;
  offerEndDate?: number;
  stores_with_stock?: unknown[];
  url?: string;
  barcode?: string | number;
}

interface FarmatodoAlgoliaResponse {
  hits?: FarmatodoAlgoliaHit[];
}

function ofertaActiva(hit: FarmatodoAlgoliaHit): number | null {
  const { offerPrice, offerStartDate, offerEndDate } = hit;

  if (!offerPrice || offerPrice <= 0) return null;

  const now = Date.now();
  if (offerStartDate && now < offerStartDate) return null;
  if (offerEndDate && now > offerEndDate) return null;

  return offerPrice;
}

export async function buscarEnFarmatodo(query: string): Promise<ProductoExtraido[]> {
  try {
    const response = await axios.post<FarmatodoAlgoliaResponse>(
      ALGOLIA_URL,
      { query, hitsPerPage: 24 },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-algolia-application-id': ALGOLIA_APP_ID,
          'x-algolia-api-key': ALGOLIA_API_KEY,
          'x-algolia-agent': 'Algolia for JavaScript (4.5.1); Browser',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 8000
      }
    );

    const hits = response.data.hits ?? [];

    return hits
      .map((item): ProductoExtraido | null => {
        const nombre =
          item.mediaDescription ||
          [item.marca || item.brand, item.activePrinciple].filter(Boolean).join(' ') ||
          'Producto sin nombre';

        const precioOferta = ofertaActiva(item);
        const precio = precioOferta ?? item.unitPrice ?? 0;

        const precioValido = precio >= 1 || (precioOferta === null && (item.unitPrice ?? 0) >= 1);

        if (!precioValido) return null;

        const marca = (item.marca || item.brand || '').trim();

        return {
          farmacia: 'Farmatodo',
          nombreOriginal: nombre,
          precio,
          moneda: 'Bs',
          disponibilidad: Array.isArray(item.stores_with_stock) && item.stores_with_stock.length > 0,
          urlProducto: `https://www.farmatodo.com.ve/producto/${item.url ?? item.objectID}`,
          marca: marca || undefined
        };
      })
      .filter((p): p is ProductoExtraido => p !== null);
  } catch (error) {
    const err = error as Error;
    console.error(`[Farmatodo Error] Búsqueda "${query}":`, err.message);
    return [];
  }
}
