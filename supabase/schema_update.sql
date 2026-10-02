-- ==============================================================================
-- ACTUALIZACIÓN DE ESQUEMA SUPABASE - CRM AZYVION
-- Nuevas columnas para Facturación Electrónica (FEL), Control POS y Catálogo
-- ==============================================================================

-- 1. EXTENSIÓN PARA LA TABLA Organizations (Configuración General y FEL SAT)
ALTER TABLE IF EXISTS "Organizations"
    ADD COLUMN IF NOT EXISTS prefijo_cotizacion TEXT DEFAULT 'COT-',
    ADD COLUMN IF NOT EXISTS prefijo_ticket TEXT DEFAULT 'POS-',
    ADD COLUMN IF NOT EXISTS fel_habilitado BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS fel_nit_emisor TEXT,
    ADD COLUMN IF NOT EXISTS fel_nombre_comercial TEXT,
    ADD COLUMN IF NOT EXISTS fel_afiliacion_iva TEXT DEFAULT 'General',
    ADD COLUMN IF NOT EXISTS fel_codigo_establecimiento TEXT DEFAULT '1',
    ADD COLUMN IF NOT EXISTS fel_certificador TEXT DEFAULT 'INFILE',
    ADD COLUMN IF NOT EXISTS fel_entorno TEXT DEFAULT 'Pruebas',
    ADD COLUMN IF NOT EXISTS fel_usuario_certificador TEXT,
    ADD COLUMN IF NOT EXISTS fel_api_key TEXT,
    ADD COLUMN IF NOT EXISTS fel_frase_sat TEXT DEFAULT 'Sujeto a pagos trimestrales ISR';

-- 2. EXTENSIÓN PARA LA TABLA Inventario (Fotos, Códigos y Precios Mayoristas)
ALTER TABLE IF EXISTS "Inventario"
    ADD COLUMN IF NOT EXISTS sku TEXT,
    ADD COLUMN IF NOT EXISTS descripcion TEXT,
    ADD COLUMN IF NOT EXISTS imagen_url TEXT,
    ADD COLUMN IF NOT EXISTS "precioPlata" NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS "precioOro" NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS marca_id TEXT,
    ADD COLUMN IF NOT EXISTS linea_id TEXT,
    ADD COLUMN IF NOT EXISTS familia_id TEXT,
    ADD COLUMN IF NOT EXISTS unidad_negocio_id TEXT,
    ADD COLUMN IF NOT EXISTS tipo_producto_id TEXT;

-- 3. EXTENSIÓN PARA LA TABLA Clientes (Precios Diferenciados y NIT)
ALTER TABLE IF EXISTS "Clientes"
    ADD COLUMN IF NOT EXISTS lista_precio TEXT DEFAULT 'Publico',
    ADD COLUMN IF NOT EXISTS nit TEXT;

-- 4. BUCKETS DE STORAGE (Crear en panel de Supabase > Storage como públicos si se requiere subida directa)
-- Buckets:
--   - productos
--   - logos-empresa
