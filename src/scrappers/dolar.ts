import axios from 'axios';
import { TasaDolar } from '../types';

interface DolarAPIResponse {
  moneda: string;
  fuente: string;
  nombre: string;
  compra: number | null;
  venta: number | null;
  promedio: number | null;
  fechaActualizacion: string;
}

const URL_OFICIAL = 'https://ve.dolarapi.com/v1/dolares/oficial';

export async function obtenerTasaDolar(): Promise<TasaDolar | null> {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const response = await axios.get<DolarAPIResponse>(URL_OFICIAL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 8000
      });

      const usd = response.data.promedio ?? response.data.venta ?? response.data.compra;

      if (usd && usd > 0) {
        return {
          usd,
          fuente: 've.dolarapi.com',
          fechaActualizacion: response.data.fechaActualizacion
        };
      }

      console.warn(`[DolarAPI] Respuesta sin promedio válido (intento ${intento})`);
    } catch (error) {
      const err = error as Error;
      console.error(`[DolarAPI Error] Intento ${intento}:`, err.message);
    }
  }

  return null;
}
