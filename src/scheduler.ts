import cron from 'node-cron';
import { ejecutarFlujoExtraccionDiaria } from './index';

cron.schedule('0 10 * * *', async () => {
  console.log('\n⏰ ===== Iniciando job diario programado (6:00 AM VET) =====');
  const inicio = Date.now();
  try {
    await ejecutarFlujoExtraccionDiaria();
    console.log(`✅ Job diario completado en ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error('❌ Error en job diario:', err);
  }
  console.log('===== Fin job diario =====\n');
}, { timezone: 'America/Caracas' });

console.log('🕐 Scheduler iniciado - próxima ejecución: 6:00 AM VET (UTC-4)');
console.log('   Presiona Ctrl+C para detener\n');


