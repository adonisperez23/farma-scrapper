-- Esquema Supabase para Farma Scrapper
-- Ejecutar en Dashboard > SQL Editor

-- 1. Catálogo maestro de medicamentos base
CREATE TABLE medicamentos_base (
  id TEXT PRIMARY KEY,
  patologia TEXT NOT NULL,
  principio_activo TEXT NOT NULL,
  dosis TEXT NOT NULL,
  alias TEXT[],
  presentacion_referencia INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Precios actuales por farmacia (upsert diario)
CREATE TABLE precios_farmacia (
  id BIGSERIAL PRIMARY KEY,
  medicamento_base_id TEXT NOT NULL REFERENCES medicamentos_base(id),
  farmacia TEXT NOT NULL,
  nombre_producto_farmacia TEXT NOT NULL,
  principio_activo TEXT NOT NULL,
  dosis TEXT NOT NULL,
  laboratorio TEXT,
  es_combo BOOLEAN DEFAULT FALSE,
  presentacion TEXT,
  cantidad_unidades INT,
  forma_farmaceutica TEXT,
  clave_comparacion TEXT NOT NULL,
  precio_original NUMERIC(12,2),
  moneda TEXT NOT NULL,
  precio_bs NUMERIC(12,2) NOT NULL,
  precio_unitario NUMERIC(12,4),
  precio_normalizado NUMERIC(12,2),
  disponibilidad BOOLEAN DEFAULT TRUE,
  url_producto TEXT,
  score_similitud NUMERIC(3,2),
  tasa_bcv_usd NUMERIC(10,4),
  fuente_tasa TEXT,
  fecha_actualizacion TIMESTAMPTZ NOT NULL,
  tiene_componentes_mixtos BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (medicamento_base_id, farmacia, nombre_producto_farmacia)
);

-- Índices para consultas frecuentes
CREATE INDEX idx_precios_medicamento ON precios_farmacia(medicamento_base_id);
CREATE INDEX idx_precios_farmacia ON precios_farmacia(farmacia);
CREATE INDEX idx_precios_disponibilidad ON precios_farmacia(disponibilidad) WHERE disponibilidad = TRUE;
CREATE INDEX idx_precios_fecha ON precios_farmacia(fecha_actualizacion DESC);
CREATE INDEX idx_medicamentos_patologia ON medicamentos_base(patologia);
CREATE INDEX idx_medicamentos_principio ON medicamentos_base(principio_activo);

-- Row Level Security - Lectura pública
ALTER TABLE medicamentos_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE precios_farmacia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read medicamentos" ON medicamentos_base FOR SELECT USING (true);
CREATE POLICY "Public read precios" ON precios_farmacia FOR SELECT USING (true);

-- Triggers para updated_at automático
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_medicamentos_updated_at
  BEFORE UPDATE ON medicamentos_base
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_precios_updated_at
  BEFORE UPDATE ON precios_farmacia
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();