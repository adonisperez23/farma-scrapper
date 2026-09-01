# Documentación del Flujo E2E - Farma Scrapper

## 1. Resumen General

Este proyecto extrae precios de medicamentos desde 4 farmacias venezolanas en línea, los normaliza, hace matching contra una lista base de medicamentos de referencia, convierte precios a Bolívares (Bs) usando la tasa oficial del BCV, presenta una comparación ordenada de menor a mayor precio unitario, **y persiste los datos en Supabase (PostgreSQL) mediante upsert diario**.

**Farmacias soportadas:**
- Farmatodo (API Algolia)
- Farmadón (scraping HTML)
- Farmapaz (scraping HTML)
- Farmatina (scraping HTML)

**Salida:** Tabla por medicamento base con todas las ofertas encontradas, ordenadas primero por productos de principio activo único (no combo) y luego por precio unitario (Bs/und) ascendente; productos con componentes mixtos (combos o múltiples principios activos) aparecen al final de cada grupo. **Medicamentos base:** 52 entradas (Hipertensión: 25, Diabetes Tipo 2: 16, Combinaciones: 11).

**Persistencia:** Al final de cada ejecución, los datos se suben a Supabase:
- `medicamentos_base`: catálogo maestro (upsert por `id`)
- `precios_farmacia`: precios actuales por farmacia (upsert por clave única compuesta: `medicamento_base_id + farmacia + nombre_producto_farmacia`)

**Automatización:** Scheduler con `node-cron` ejecutando todos los días a las 6:00 AM VET (UTC-4).

---

## 2. Arquitectura - Módulos Principales

```
src/
├── index.ts                    # Orquestador principal (flujo diario)
├── main.ts                     # Entry point scheduler (inicia cron)
├── scheduler.ts                # Configuración node-cron (6:00 AM VET)
├── test-scrapers.ts            # Herramienta de debugging/prueba
├── comparator.ts               # Agrupación, ordenamiento e impresión
├── data/
│   └── medicamentos.ts         # Lista base de medicamentos a buscar
├── scrappers/
│   ├── farmatodo.ts            # Scraper API Algolia
│   ├── farmadon.ts             # Scraper HTML (cheerio)
│   ├── farmapaz.ts             # Scraper HTML (cheerio)
│   ├── farmatina.ts            # Scraper HTML (cheerio)
│   └── dolar.ts                # Obtención tasa USD/BS (ve.dolarapi.com)
├── parsers/
│   └── normalizar.ts           # Parsing nombre → principio activo, dosis, lab, presentación
├── utils/
│   ├── matcher.ts              # Algoritmo matching (Dice coefficient + reglas)
│   └── precio.ts               # Parsing, conversión, normalización precios
├── lib/
│   ├── supabase.ts             # Cliente Supabase (service_role)
│   └── upsert-precios.ts       # Upsert medicamentos_base + precios_farmacia
└── types/
    └── index.ts                # Interfaces TypeScript compartidas
```

**Nuevos archivos (Supabase + Scheduler):**
- `src/lib/supabase.ts` - Cliente autenticado con `service_role_key`
- `src/lib/upsert-precios.ts` - Lógica de upsert en 2 tablas
- `src/scheduler.ts` - Cron job diario (timezone America/Caracas)
- `src/main.ts` - Punto de entrada que mantiene el proceso vivo
- `supabase/schema.sql` - DDL completo (tablas, índices, RLS, triggers)

---

## 3. Flujo Detallado Paso a Paso

### Paso 1: Obtención Tasa Dólar Oficial (`src/scrappers/dolar.ts:16`)

```typescript
obtenerTasaDolar(): Promise<TasaDolar | null>
```

- Consulta `https://ve.dolarapi.com/v1/dolares/oficial` (reintentos: 3, timeout: 8s)
- Usa `promedio` > `venta` > `compra` como tasa de referencia
- Retorna `{ usd, fuente, fechaActualizacion }` o `null` si falla
- **Crítico:** Sin tasa, precios en REF (dólares) no se convierten a Bs

---

### Paso 2: Iteración Medicamentos Base (`src/index.ts:25`)

```typescript
for (const medBase of medicamentosBase) { ... }
```

- Itera `medicamentosBase` (definidos en `src/data/medicamentos.ts:3`)
- Cada entrada: `id`, `patologia`, `principioActivo`, `dosis`, `alias[]`, `presentacionReferencia` (unidades, ej. 10 para tabletas, 1 para insulinas)
- Para cada medicamento base, lanza scraping en paralelo a las 4 farmacias

---

### Paso 3: Scraping Paralelo 4 Farmacias (`src/index.ts:28-33`)

```typescript
const [resultadosFarmatodo, resultadosFarmadon, resultadosFarmapaz, resultadosFarmatina] = await Promise.all([
  buscarEnFarmatodo(medBase.principioActivo),
  buscarEnFarmadon(medBase.principioActivo),
  buscarEnFarmapaz(medBase.principioActivo),
  buscarEnFarmatina(medBase.principioActivo)
]);
```

#### 3.1 Farmatodo (`src/scrappers/farmatodo.ts:40`) - **API Algolia**
- POST a `https://vcojeyd2po-dsn.algolia.net/1/indexes/products-venezuela/query`
- Headers: `x-algolia-application-id`, `x-algolia-api-key`, `x-algolia-agent`
- Query: `principioActivo`, `hitsPerPage: 24`
- Campos relevantes respuesta: `mediaDescription`, `marca`/`brand`, `activePrinciple`, `unitPrice`, `offerPrice`, `offerStartDate`, `offerEndDate`, `stores_with_stock`, `url`, `barcode`
- Lógica precio: usa `offerPrice` si oferta activa (fecha vigente), sino `unitPrice`
- Filtra: `precio >= 1`
- Moneda: siempre `'Bs'` (API ya devuelve en Bs)
- Disponibilidad: `stores_with_stock.length > 0`

#### 3.2 Farmadón (`src/scrappers/farmadon.ts:6`) - **HTML Scraping**
- GET `https://www.farmadon.com.ve/tienda/?per_page=100&s={query}&post_type=product`
- Selector productos: `.product-type-simple`
- Nombre: `.heading-title.product-name a` (texto + href)
- Precio: `.price .amount, .woocommerce-Price-amount` (primer match)
- Parsing precio: `detectarMoneda()` + `parsePrecioVE()` (`src/utils/precio.ts:3,26`)
- Disponibilidad: `true` (asumida)

#### 3.3 Farmapaz (`src/scrappers/farmapaz.ts:6`) - **HTML Scraping**
- GET `https://farmapazvenezuela.com/?s={query}`
- Selector productos: `.sp-card`
- Nombre: `.sp-card-title a`
- Precio: `.sp-card-price-sale .woocommerce-Price-amount bdi` (oferta) o `.sp-card-price-normal .woocommerce-Price-amount bdi` (normal)
- Sin stock: `.sp-card-badge-low` presente → `disponibilidad: false`
- Parsing precio: `detectarMoneda()` + `parsePrecioVE()`

#### 3.4 Farmatina (`src/scrappers/farmatina.ts:8`) - **HTML Scraping**
- GET `https://farmatina.com/shop?search={query}`
- Selector productos: `form.zenith-product-card`
- Nombre: `a[itemprop="name"]`
- URL: `a[itemprop="url"]` (resuelve contra `BASE_URL`)
- Precio: `.product_price .oe_currency_value` (último)
- Moneda: `detectarMoneda()` sobre texto completo `.product_price`
- Parsing precio: `parsePrecioVE()`
- Disponibilidad: `true` (asumida)

---

### Paso 4: Normalización Productos (`src/parsers/normalizar.ts:142`)

```typescript
normalizarProducto(producto: ProductoExtraido): ProductoNormalizado
```

**Entrada:** `ProductoExtraido` (crudo del scraper)
**Salida:** `ProductoNormalizado` (extiende con campos parseados)

**Proceso:**
1. `limpiarTexto()` - lowercase, quita acentos, normaliza espacios, remueve chars especiales
2. `expandirPresentaciones()` - convierte "x30 tab" → "x 30 tableta"
3. `extraerDosis()` - regex captura `50mg`, `100mg`, `12.5mg`, etc. (array)
4. `extraerCantidad()` - busca `\bx\s*(\d+)\b` → número unidades (ej. 30)
5. `extraerForma()` - match contra lista formas: comprimido, tableta, capsula, jarabe, gotas, crema, inyectable
6. `quitarDosis()` - remueve patrones de dosis del texto
7. Limpia palabras de forma, presentación, "caja", "blister", "xN"
8. `extraerLaboratorio()` - heurísticas por farmacia:
   - **Farmapaz:** busca en paréntesis `(LAB)` excluyendo formas cortas
   - **Lista conocida:** 99 laboratorios hardcodeados (`LABORATORIOS_CONOCIDOS`)
   - **Marca:** usa campo `marca` del scraper (limpiando "medicamentos", "laboratorios")
   - **Farmadón:** toma última parte tras ` - `
   - **Farmatina/Farmadón:** última palabra si ≥3 chars solo letras
9. `principiosActivos` - texto remanente split por `+` o `/`
10. `esCombo` - true si: >1 dosis, contiene `+`, contiene `/[a-z]`, o patrón `50mg/12.5mg`
11. **`tieneComponentesMixtos`** - `esCombo === true` O `principiosActivos.length > 1` (productos con múltiples principios activos)

---

### Paso 5: Matching contra Base (`src/utils/matcher.ts:74`)

```typescript
calcularCoincidencia(producto: ProductoNormalizado, medBase: MedicamentoBase): ResultadoMatch
```

**Reglas:**
1. **Descarta combos** → `{esMatch: false, score: 0}` (línea 78-80)
2. **Si parseo completo** (`principiosActivos.length > 0 && dosis.length > 0`):
   - `principiosCoinciden()` - normaliza ambos, compara tokens clave (prefijo 6 chars), Dice coefficient ≥ 0.6
   - `dosisCoinciden()` - extrae número (ej. "50mg" → 50), compara exacto vs `medBase.dosis`
   - Si ambos OK → match con `score = max(Dice(nombre, objetivo), 0.5)`
3. **Fallback (parseo incompleto):**
   - Dice coefficient sobre nombre limpio vs `"principioActivo dosis"`
   - Match si `score ≥ 0.7` OR (`score ≥ 0.5` Y nombre incluye dosis base)

**Retorna:** `{ esMatch: boolean, score: number (0-1, 2 decimales) }`

---

### Paso 6: Cálculo Precios y Conversión (`src/index.ts:42-52`, `src/utils/precio.ts`)

```typescript
const precioEnBs = normalizado.moneda === 'REF' && tasaDolar
  ? convertirPrecio(normalizado.precio, tasaDolar.usd)
  : normalizado.precio;

const precioPorUnidad = precioUnitario(precioEnBs, normalizado.cantidadUnidades);
const normalizado30 = normalizarPresentacion(precioEnBs, normalizado.cantidadUnidades, medBase.presentacionReferencia);
```

**Funciones (`src/utils/precio.ts`):**
- `parsePrecioVE(texto)` - maneja formatos VE: `1.234,56` / `1,234.56` / `1234,56` → float
- `detectarMoneda(texto)` - `REF` si contiene "ref", "$", "us$", "dólar"; sino `Bs`
- `convertirPrecio(ref, tasa)` - `ref * tasa` redondeado 2 decimales
- `precioUnitario(precio, cantidad)` - `precio / cantidad` (si cantidad > 0)
- `normalizarPresentacion(precio, cantidad, referencia)` - `(precio / cantidad) * referencia` (equivale a precio por presentación referencia, ej. 10 unds)

**Campos calculados en `RegistroPreparadoDB`:**
- `precio` - precio final en Bs (redondeado 2 dec)
- `precio_unitario` - Bs por unidad
- `precio_normalizado` - Bs equivalentes a presentación referencia (ej. 10 unds)

---

### Paso 7: Construcción Comparación Ordenada (`src/comparator.ts:30`)

```typescript
construirComparacion(registros: RegistroPreparadoDB[]): ComparacionMedicamento[]
```

1. **Agrupa** por `medicamento_base_id` (`Map<string, RegistroPreparadoDB[]>`)
2. **Mapea** cada registro a `FilaComparacion` (campos plano para output)
3. **Ordena filas** por:
   - Primero: `tieneComponentesMixtos` (false → true, productos simples primero)
   - Segundo: `precio_unitario` ASC
   ```typescript
   filas.sort((a, b) => {
     if (a.tieneComponentesMixtos !== b.tieneComponentesMixtos) {
       return a.tieneComponentesMixtos ? 1 : -1;
     }
     return a.precio_unitario - b.precio_unitario;
   });
   ```
4. **Construye** `ComparacionMedicamento` con metadata base + filas ordenadas
5. **Ordena resultado final** por `medicamento_base_id` (línea 68)

---

### Paso 8: Impresión Final (`src/comparator.ts:72`)

```typescript
imprimirComparacion(comparaciones: ComparacionMedicamento[], tasaUsd: number | null): void
```

**Formato tabla por medicamento:**
```
================================================================================================
💊 Amlodipina 5mg (MED-001) — Hipertensión
================================================================================================
Farmacia    Laboratorio  Presentación Precio caja Bs/unidad  Bs x10 (equiv) Disp.
------------------------------------------------------------------------------------------------
Farmadon    la sante     x10 tableta        67.63       6.76             67.63  sí   url
Farmapaz    la sante     x10 tableta        82.41       8.24             82.41  sí   url
Farmatodo   dac          x10 tableta        92.60       9.26             92.60  sí   url
Farmatina   calox        x10 tableta        86.36       8.64             86.36  sí   url
...
```

- Columnas: Farmacia (11), Laboratorio (12), Presentación (13), Precio caja (11), Bs/unidad (10), Bs x10 (13), Disp., URL
- Al final: `💵 Tasa de referencia: Bs {tasa}. Precios en Bs.`

---

### Paso 9: Persistencia en Supabase (`src/lib/upsert-precios.ts`)

Al finalizar el flujo de extracción y comparación, los datos limpios se suben a Supabase (PostgreSQL) mediante **upsert** (inserta si no existe, actualiza si existe).

#### 9.1 Sincronizar Catálogo Maestro (`sincronizarMedicamentosBase`)
```typescript
await sincronizarMedicamentosBase(medicamentosBase);
```
- Tabla: `medicamentos_base`
- Clave de conflicto: `id` (ej. `MED-001`)
- Campos: `id`, `patologia`, `principio_activo`, `dosis`, `alias[]`, `presentacion_referencia`
- Se ejecuta en cada corrida para garantizar que el catálogo esté actualizado

#### 9.2 Upsert Precios Farmacia (`upsertPreciosFarmacia`)
```typescript
await upsertPreciosFarmacia(registrosParaGuardar);
```
- Tabla: `precios_farmacia`
- Clave de conflicto compuesta: `(medicamento_base_id, farmacia, nombre_producto_farmacia)`
- **Comportamiento:**
  - Si no existe → `INSERT` (nuevo producto detectado)
  - Si existe → `UPDATE` (precio, disponibilidad, fecha_actualizacion, score_similitud)
- ~200 registros por ejecución diaria (52 medicamentos × ~4 farmacias)
- Campos clave persistidos: `precio_bs`, `precio_unitario`, `precio_normalizado`, `disponibilidad`, `tasa_bcv_usd`, `fecha_actualizacion`, `tiene_componentes_mixtos`

#### 9.3 Cliente Supabase (`src/lib/supabase.ts`)
```typescript
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
```
- Usa `SUPABASE_SERVICE_ROLE_KEY` (bypass RLS para writes)
- Validación de variables de entorno al inicio
- Sin persistencia de sesión (server-to-server)

---

## 4. Estructuras de Datos Clave (`src/types/index.ts`)

```typescript
// Entrada base
interface MedicamentoBase {
  id: string;
  patologia: 'Hipertensión' | 'Diabetes Tipo 2' | 'General';
  principioActivo: string;
  dosis: string;
  alias?: string[];
  presentacionReferencia: number;  // ej. 10 (tabletas), 1 (insulinas)
}

// Crudo del scraper
interface ProductoExtraido {
  farmacia: 'Farmatodo' | 'Farmadón' | 'Farmapaz' | 'Farmatina';
  nombreOriginal: string;
  precio: number;
  moneda: 'Bs' | 'REF';
  disponibilidad: boolean;
  urlProducto: string;
  marca?: string;
}

// Normalizado (parser output)
interface ProductoNormalizado extends ProductoExtraido {
  principiosActivos: string[];
  dosis: string[];
  laboratorio: string;
  cantidadUnidades: number;
  formaFarmaceutica: string;
  esCombo: boolean;
}

// Para BD / comparación final
interface RegistroPreparadoDB {
  medicamento_base_id: string;
  patologia: string;
  farmacia: NombreFarmacia;
  nombre_producto_farmacia: string;
  principio_activo: string;
  dosis: string;
  laboratorio: string;
  es_combo: boolean;
  presentacion: string;
  cantidad_unidades: number;
  forma_farmaceutica: string;
  clave_comparacion: string;
  precio_original: number;
  moneda: Moneda;
  precio: number;              // Bs finales
  precio_unitario: number;     // Bs/und
  precio_normalizado: number;  // Bs equivalentes a presentación referencia (ej. 10 unds)
  disponibilidad: boolean;
  url_producto: string;
  score_similitud: number;
  tasa_bcv_usd: number | null;
  fuente_tasa: string | null;
  fecha_actualizacion: string;
  tiene_componentes_mixtos: boolean;  // true si esCombo || principiosActivos.length > 1
}
```

---

## 5. Configuración y Constantes

| Archivo | Constante | Valor |
|---------|-----------|-------|
| `farmatodo.ts:4-7` | ALGOLIA_APP_ID | `VCOJEYD2PO` |
| | ALGOLIA_API_KEY | `869a91e98550dd668b8b1dc04bca9011` |
| | ALGOLIA_INDEX | `products-venezuela` |
| `farmadon.ts:8` | URL base | `https://www.farmadon.com.ve/tienda/` |
| `farmapaz.ts:8` | URL base | `https://farmapazvenezuela.com/` |
| `farmatina.ts:6` | BASE_URL | `https://farmatina.com` |
| `dolar.ts:14` | URL_OFICIAL | `https://ve.dolarapi.com/v1/dolares/oficial` |
| `normalizar.ts:71-100` | LABORATORIOS_CONOCIDOS | 99 entries |
| `medicamentos.ts:3` | medicamentosBase | 52 medicamentos (ver lista completa abajo) |
| `.env` | SUPABASE_URL | `https://xxx.supabase.co` |
| `.env` | SUPABASE_SERVICE_ROLE_KEY | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `scheduler.ts:4` | CRON_SCHEDULE | `0 10 * * *` (6:00 AM VET = UTC-4) |

**Selectores CSS (propensos a rotura):**
- Farmadón: `.product-type-simple`, `.heading-title.product-name a`, `.price .amount`
- Farmapaz: `.sp-card`, `.sp-card-title a`, `.sp-card-price-sale .woocommerce-Price-amount bdi`
- Farmatina: `form.zenith-product-card`, `a[itemprop="name"]`, `.product_price .oe_currency_value`

**Variables de Entorno Requeridas (`.env`):**
```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
# Obtener en: Dashboard Supabase > Settings > API > service_role (secret)
```
⚠️ **Nunca** usar `anon` key para writes; `service_role` tiene bypass RLS completo.

**Lista completa de medicamentos base (`src/data/medicamentos.ts`):**

*Hipertensión (25):*
- MED-001: Amlodipina / Amlodipino 5mg (ref: 10)
- MED-002: Atenolol 50mg (ref: 10)
- MED-003: Bisoprolol 5mg (ref: 10)
- MED-004: Candesartán 16mg (ref: 10)
- MED-005: Captopril 25mg (ref: 10)
- MED-006: Carvedilol 12.5mg (ref: 10)
- MED-007: Clonidina 0.15mg (ref: 10)
- MED-008: Clortalidona 25mg (ref: 10)
- MED-009: Diltiazem 60mg (ref: 10)
- MED-010: Enalapril 20mg (ref: 10)
- MED-011: Espironolactona 25mg (ref: 10)
- MED-012: Furosemida 40mg (ref: 10)
- MED-013: Hidroclorotiazida 25mg (ref: 10)
- MED-014: Indapamida 1.5mg (ref: 10)
- MED-015: Lisinopril 10mg (ref: 10)
- MED-016: Losartán Potásico 50mg (ref: 10)
- MED-017: Metildopa 250mg (ref: 10)
- MED-018: Metoprolol 50mg (ref: 10)
- MED-019: Nebivolol 5mg (ref: 10)
- MED-020: Nifedipina 30mg (ref: 10)
- MED-021: Olmesartán 20mg (ref: 10)
- MED-022: Ramipril 5mg (ref: 10)
- MED-023: Telmisartán 40mg (ref: 10)
- MED-024: Valsartán 80mg (ref: 10)
- MED-025: Verapamilo 80mg (ref: 10)

*Diabetes Tipo 2 (16):*
- MED-026: Acarbosa 50mg (ref: 10)
- MED-027: Canagliflozina 100mg (ref: 10)
- MED-028: Dapagliflozina 10mg (ref: 10)
- MED-029: Empagliflozina 10mg (ref: 10)
- MED-030: Glibenclamida 5mg (ref: 10)
- MED-031: Gliclazida 60mg (ref: 10)
- MED-032: Glimepirida 2mg (ref: 10)
- MED-033: Glipizida 5mg (ref: 10)
- MED-034: Insulina Glargina 100 UI/ml (ref: 1)
- MED-035: Insulina NPH 100 UI/ml (ref: 1)
- MED-036: Insulina Regular / Cristalina 100 UI/ml (ref: 1)
- MED-037: Linagliptina 5mg (ref: 10)
- MED-038: Metformina 850mg (ref: 10)
- MED-039: Pioglitazona 15mg (ref: 10)
- MED-040: Sitagliptina 50mg (ref: 10)
- MED-041: Vildagliptina 50mg (ref: 10)

*Combinaciones / Mezclas (11):*
- MED-042: Amlodipina + Losartán 5mg/50mg (ref: 10)
- MED-043: Amlodipina + Valsartán 5mg/160mg (ref: 10)
- MED-044: Losartán + Hidroclorotiazida 50mg/12.5mg (ref: 10)
- MED-045: Olmesartán + Amlodipina 20mg/5mg (ref: 10)
- MED-046: Valsartán + Hidroclorotiazida 160mg/12.5mg (ref: 10)
- MED-047: Empagliflozina + Linagliptina 10mg/5mg (ref: 10)
- MED-048: Empagliflozina + Metformina 5mg/850mg (ref: 10)
- MED-049: Linagliptina + Metformina 2.5mg/850mg (ref: 10)
- MED-050: Metformina + Glibenclamida 500mg/2.5mg (ref: 10)
- MED-051: Sitagliptina + Metformina 50mg/850mg (ref: 10)
- MED-052: Vildagliptina + Metformina 50mg/850mg (ref: 10)

---

## 6. Comandos de Ejecución

```bash
# Flujo principal (producción / daily job) - una sola ejecución
pnpm daily
# o directamente:
pnpm tsx src/index.ts

# Scheduler automático (mantiene proceso vivo, ejecuta 6:00 AM VET diario)
pnpm scheduler
# o directamente:
pnpm tsx src/main.ts

# Test/debug scrapers + matching (usa 'amlodipina' hardcodeado)
pnpm test:scrapers
# o directamente:
pnpm tsx src/test-scrapers.ts

# Compilar TypeScript
pnpm build
# o directamente:
pnpm tsc

# Ejecutar compilado (producción)
node dist/index.js        # flujo único
node dist/main.js         # scheduler
node dist/test-scrapers.js
```

**Producción con PM2:**
```bash
pnpm build
pm2 start dist/main.js --name farma-scrapper
pm2 save && pm2 startup
```

**Dependencias clave (package.json):**
- `axios` - HTTP requests
- `cheerio` - HTML parsing
- `node-cron` - Programación de tareas (scheduling)
- `@supabase/supabase-js` - Cliente Supabase (PostgreSQL)
- `typescript` / `tsx` - runtime TS

---

## 7. Output de Ejemplo (Real)

```
===== Farmatodo (24 resultados crudos) =====
  1. Amlodipina 5 mg La Santé x 10 Tabletas
     → principio: [amlodipina] | dosis: [5mg] | lab: la sante | presentación: x10 tableta
     Precio: 152.60 Bs → Bs 152.60 (Bs/und: 15.26)
   ...

===== VALIDACIÓN DE MATCHING =====
  ✔ Farmatodo | Amlodipina 5 mg La Santé x 10 Tabletas
    score=0.69 lab=la sante dosis=[5mg] combo=false
    Precio: 152.60 Bs → Bs 152.60 (Bs/und: 15.26)
  ✔ Farmadon | Amlodipina 5mg x 10 Tabletas - La Santé
    score=0.7 lab=la sante dosis=[5mg] combo=false
    Precio: 67.63 Bs → Bs 67.63 (Bs/und: 6.76)
  ...

💊 Amlodipina 5mg (MED-001) — Hipertensión
===============================================================================================
Farmacia    Laboratorio  Presentación Precio caja Bs/unidad  Bs x10 (equiv) Disp.
------------------------------------------------------------------------------------------------
Farmadon    la sante     x10 tableta        67.63       6.76             67.63  sí   url
Farmapaz    la sante     x10 tableta        82.41       8.24             82.41  sí   url
Farmatodo   dac          x10 tableta        92.60       9.26             92.60  sí   url
Farmatina   calox        x10 tableta        86.36       8.64             86.36  sí   url
```

---

## 8. Notas de Mantenimiento

### ⚠️ Puntos Críticos de Falla

1. **Selectores CSS** - Cambios en HTML de Farmadón/Farmapaz/Farmatina rompen scraping
   - *Solución:* Verificar selectores mensualmente, agregar logging HTML snippet en catch

2. **API Key Farmatodo (Algolia)** - Puede expirar o rotar
   - *Solución:* Monitorear errores 401/403, tener proceso de renovación

3. **Tasa Dólar (ve.dolarapi.com)** - Dependencia externa única
   - *Solución:* Fallback a BCV oficial o tasa paralela documentada

4. **Lista Laboratorios** - Hardcodeada (99 entries)
   - *Solución:* Migrar a archivo JSON/DB actualizable sin deploy

5. **Matching Thresholds** - `0.7` / `0.5` / `0.6` (Dice) ajustados empíricamente
   - *Solución:* Logs de falsos positivos/negativos para recalibrar

### 🗄️ Supabase - Puntos de Atención

6. **Service Role Key** - Credencial de admin (bypass RLS)
   - *Riesgo:* Si se filtra, acceso total a la BD
   - *Solución:* Solo en backend/server, nunca en frontend. Rotar periódicamente en Dashboard > Settings > API

7. **Rate Limits Supabase** - ~500 req/s, 1000 req/10s por IP
   - *Impacto:* Batch de ~200 upserts está bien, pero evitar loops sin batch
   - *Monitoreo:* Dashboard > Logs > API requests

8. **RLS (Row Level Security)** - Lectura pública, escritura solo service_role
   - *Verificación:* `SELECT * FROM pg_policies WHERE tablename IN ('medicamentos_base','precios_farmacia');`
   - *Test:* Con `anon` key solo debe poder `SELECT`, no `INSERT/UPDATE`

9. **Timezone** - Venezuela UTC-4 todo el año (sin DST)
   - Cron: `0 10 * * *` UTC = 6:00 AM VET
   - `fecha_actualizacion` se guarda en ISO string (UTC) desde el cliente

10. **Crecimiento `precios_farmacia`** - ~200 filas/día = ~73k/año
    - *Actual:* Sin tabla histórico, solo estado actual (upsert sobrescribe)
    - *Futuro:* Si se requiere histórico → tabla particionada por mes (`pg_partman`) o `precios_historico` con trigger

### 🔧 Cómo Agregar Nueva Farmacia

1. Crear `src/scrappers/nueva.ts` implementando `buscarEnNueva(query): Promise<ProductoExtraido[]>`
2. Importar en `index.ts` y `test-scrapers.ts`
3. Agregar a `Promise.all` en ambos archivos
4. Añadir tipo a `NombreFarmacia` en `types/index.ts:10`
5. Implementar heurística laboratorio en `normalizar.ts:104` si necesario

### 🔧 Cómo Agregar Nuevo Medicamento Base

Editar `src/data/medicamentos.ts`:
```typescript
{
  id: 'MED-053',
  patologia: 'Hipertensión',
  principioActivo: 'Enalapril',
  dosis: '20mg',
  alias: ['enalapril', 'enalapril maleato 20 mg'],
  presentacionReferencia: 10
}
```

---

## 9. Diagrama de Flujo (Mermaid)

```mermaid
flowchart TD
    A[Inicio: ejecutarFlujoExtraccionDiaria] --> B[obtenerTasaDolar]
    B --> C{Tasa OK?}
    C -->|Sí| D[Log tasa USD]
    C -->|No| E[Warn: sin conversión REF]
    D --> F[Loop: medicamentosBase]
    E --> F
    F --> G[Promise.all: 4 scrapers paralelos]
    G --> H1[buscarEnFarmatodo\nAPI Algolia]
    G --> H2[buscarEnFarmadon\nHTML cheerio]
    G --> H3[buscarEnFarmapaz\nHTML cheerio]
    G --> H4[buscarEnFarmatina\nHTML cheerio]
    H1 --> I[Merge resultados]
    H2 --> I
    H3 --> I
    H4 --> I
    I --> J[ForEach producto: normalizarProducto]
    J --> K[calcularCoincidencia vs medBase]
    K --> L{esMatch?}
    L -->|Sí| M[Calcular precios:\nconvertirPrecio, precioUnitario,\nnormalizarPresentacion]
    L -->|No| N[Descartar]
    M --> O[Push RegistroPreparadoDB]
    O --> F
    F --> P[construirComparacion\nagrupa + ordena:\n1. tieneComponentesMixtos (false primero)\n2. precio_unitario ASC]
    P --> Q[imprimirComparacion\ntabla formateada]
    Q --> R1[sincronizarMedicamentosBase\nupsert 52 medicamentos]
    R1 --> R2[upsertPreciosFarmacia\nupsert ~200 precios]
    R2 --> R[Fin + return registrosParaGuardar]
```

---

## 10. Test Scrapers (`src/test-scrapers.ts`)

Herramienta de debugging independiente que:
1. Obtiene tasa dólar
2. Busca **solo 'amlodipina'** (hardcodeado línea 44) en las 4 farmacias
3. Imprime **resultados crudos** por farmacia con precios parseados
4. Ejecuta **validación matching** contra `medicamentosBase[0]` (Amlodipina 5mg)
5. Muestra matches con score, laboratorio, dosis, combo, **y precios** (Bs + Bs/und)

**Nuevo:** El campo `tieneComponentesMixtos` se propaga a la comparación final, permitiendo ver qué productos son combinaciones/multiples principios activos.

**Útil para:**
- Verificar selectores CSS tras cambios web
- Validar parsing precios/monedas
- Ajustar thresholds matching
- Detectar combos mal clasificados

---

## 11. Esquema Supabase & Setup

### 11.1 Tablas

#### `medicamentos_base` - Catálogo Maestro
```sql
CREATE TABLE medicamentos_base (
  id TEXT PRIMARY KEY,                    -- 'MED-001'
  patologia TEXT NOT NULL,                -- 'Hipertensión' | 'Diabetes Tipo 2' | 'General'
  principio_activo TEXT NOT NULL,         -- 'Amlodipina / Amlodipino'
  dosis TEXT NOT NULL,                    -- '5mg'
  alias TEXT[],                           -- ['Amlovas', 'Astudal']
  presentacion_referencia INT NOT NULL,   -- 10 (tabletas), 1 (insulinas)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```
- **52 filas fijas** (se upsertan en cada ejecución)
- Índices: `patologia`, `principio_activo`

#### `precios_farmacia` - Precios Actuales
```sql
CREATE TABLE precios_farmacia (
  id BIGSERIAL PRIMARY KEY,
  medicamento_base_id TEXT NOT NULL REFERENCES medicamentos_base(id),
  farmacia TEXT NOT NULL,                 -- 'Farmatodo' | 'Farmadón' | 'Farmapaz' | 'Farmatina'
  nombre_producto_farmacia TEXT NOT NULL, -- Nombre exacto en la web
  principio_activo TEXT NOT NULL,
  dosis TEXT NOT NULL,
  laboratorio TEXT,
  es_combo BOOLEAN DEFAULT FALSE,
  presentacion TEXT,                      -- 'x10 tableta'
  cantidad_unidades INT,
  forma_farmaceutica TEXT,                -- 'tableta', 'capsula', 'jarabe'
  clave_comparacion TEXT NOT NULL,        -- 'MED-001-5mg'
  precio_original NUMERIC(12,2),          -- Precio tal cual en la web
  moneda TEXT NOT NULL,                   -- 'Bs' | 'REF'
  precio_bs NUMERIC(12,2) NOT NULL,       -- Precio final en Bolívares
  precio_unitario NUMERIC(12,4),          -- Bs/unidad
  precio_normalizado NUMERIC(12,2),       -- Bs equivalentes a presentación referencia
  disponibilidad BOOLEAN DEFAULT TRUE,
  url_producto TEXT,
  score_similitud NUMERIC(3,2),           -- 0.00 - 1.00
  tasa_bcv_usd NUMERIC(10,4),             -- Tasa usada si moneda=REF
  fuente_tasa TEXT,                       -- 've.dolarapi.com'
  fecha_actualizacion TIMESTAMPTZ NOT NULL,
  tiene_componentes_mixtos BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (medicamento_base_id, farmacia, nombre_producto_farmacia)
);
```
- **~200 filas/día** (upsert diario)
- **Clave única compuesta** evita duplicados: mismo medicamento + farmacia + nombre producto
- Índices: `medicamento_base_id`, `farmacia`, `disponibilidad` (partial), `fecha_actualizacion`

### 11.2 Row Level Security (RLS)
```sql
ALTER TABLE medicamentos_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE precios_farmacia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read medicamentos" ON medicamentos_base FOR SELECT USING (true);
CREATE POLICY "Public read precios" ON precios_farmacia FOR SELECT USING (true);
```
- **Lectura pública** habilitada (para frontend/dashboards)
- **Escritura** solo vía `service_role_key` (bypass RLS en backend)

### 11.3 Triggers `updated_at`
```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER update_medicamentos_updated_at BEFORE UPDATE ON medicamentos_base FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_precios_updated_at BEFORE UPDATE ON precios_farmacia FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 11.4 Setup Inicial (Una sola vez)

1. **Crear proyecto en Supabase**
   - https://supabase.com → New Project
   - Región: **South America (São Paulo)** - latencia óptima para Venezuela
   - Copiar: `Project URL` y `service_role` key (Settings > API)

2. **Ejecutar DDL**
   - Dashboard > SQL Editor → New Query
   - Pegar contenido de `supabase/schema.sql`
   - Run

3. **Configurar variables de entorno**
   ```bash
   cp .env.example .env
   # Editar .env con credenciales reales
   ```

4. **Verificar**
   ```bash
   pnpm daily
   # Revisar Table Editor > precios_farmacia: ~200 filas
   ```

### 11.5 Automatización Diaria

**Desarrollo:**
```bash
pnpm scheduler    # Inicia cron, mantiene proceso vivo (Ctrl+C para parar)
```

**Producción (PM2):**
```bash
pnpm build
pm2 start dist/main.js --name farma-scrapper
pm2 save && pm2 startup
```
- Logs: `pm2 logs farma-scrapper`
- Monitoreo: `pm2 monit`

**Cron Expression:** `0 10 * * *` (UTC) = **6:00 AM VET** (America/Caracas, UTC-4)
- Timezone configurado en `src/scheduler.ts`: `{ timezone: 'America/Caracas' }`

### 11.6 Consultas SQL Útiles

**Precio mínimo por medicamento (disponibles):**
```sql
SELECT m.principio_activo, m.dosis, p.farmacia, p.precio_bs, p.precio_unitario, p.url_producto
FROM precios_farmacia p
JOIN medicamentos_base m ON m.id = p.medicamento_base_id
WHERE p.disponibilidad = TRUE
  AND p.precio_unitario = (
    SELECT MIN(precio_unitario)
    FROM precios_farmacia
    WHERE medicamento_base_id = p.medicamento_base_id
      AND disponibilidad = TRUE
  )
ORDER BY m.patologia, m.principio_activo;
```

**Farmacias con mayor cobertura:**
```sql
SELECT farmacia, COUNT(DISTINCT medicamento_base_id) as medicamentos_cubiertos
FROM precios_farmacia
WHERE disponibilidad = TRUE
GROUP BY farmacia
ORDER BY medicamentos_cubiertos DESC;
```

**Productos con precio REF sin convertir (tasa falló):**
```sql
SELECT * FROM precios_farmacia
WHERE moneda = 'REF' AND (tasa_bcv_usd IS NULL OR tasa_bcv_usd = 0);
```

**Cambios de precio detectados (comparar última vs anterior):**
```sql
-- Requiere tabla histórico o enable pg_audit
-- Con tabla histórico:
SELECT h.medicamento_base_id, h.farmacia, h.precio_bs as anterior, p.precio_bs as actual,
       ROUND(((p.precio_bs - h.precio_bs) / h.precio_bs) * 100, 2) as pct_cambio
FROM precios_historico h
JOIN precios_farmacia p ON p.medicamento_base_id = h.medicamento_base_id AND p.farmacia = h.farmacia
WHERE h.fecha_registro < p.fecha_actualizacion
  AND ABS(p.precio_bs - h.precio_bs) > 0.01
ORDER BY p.fecha_actualizacion DESC;
```

---

*Documentación generada basada en código fuente revisado agosto 2026 (actualizada: 52 medicamentos base, presentacionReferencia 10/1, test usa amlodipina, node-cron agregado, **Supabase upsert + scheduler diario**)*