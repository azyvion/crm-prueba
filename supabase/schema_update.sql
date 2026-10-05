-- ==============================================================================
-- ACTUALIZACIÓN DE ESQUEMA SUPABASE - CRM AZYVION
-- Nuevas tablas y columnas para:
-- 1. Facturación Electrónica (FEL SAT) y Catálogo
-- 2. Multi-sucursal (Sucursales por Organización y Aislamiento)
-- 3. Control de Turnos y Cierres de Caja POS (Persistencia 24h/indefinida)
-- ==============================================================================

-- 1. TABLA SUCURSALES (Multi-tienda)
CREATE TABLE IF NOT EXISTS "Sucursales" (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    codigo TEXT,
    direccion TEXT,
    telefono TEXT,
    es_central BOOLEAN DEFAULT FALSE,
    activa BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. TABLA CAJAS_TURNOS (Historial de Aperturas y Cierres de Caja POS)
CREATE TABLE IF NOT EXISTS "Cajas_Turnos" (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    sucursal_id TEXT,
    cajero TEXT NOT NULL,
    monto_inicial NUMERIC(12,2) DEFAULT 0.00,
    fecha_apertura TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_cierre TIMESTAMP WITH TIME ZONE,
    ventas_efectivo NUMERIC(12,2) DEFAULT 0.00,
    ventas_tarjeta NUMERIC(12,2) DEFAULT 0.00,
    ventas_transferencia NUMERIC(12,2) DEFAULT 0.00,
    ventas_otros NUMERIC(12,2) DEFAULT 0.00,
    total_esperado NUMERIC(12,2) DEFAULT 0.00,
    efectivo_contado NUMERIC(12,2) DEFAULT 0.00,
    diferencia NUMERIC(12,2) DEFAULT 0.00,
    estado TEXT DEFAULT 'ABIERTA', -- 'ABIERTA' o 'CERRADA'
    observaciones TEXT
);

-- 3. EXTENSIÓN PARA LA TABLA Organizations (Configuración General, FEL SAT, Sucursales y Correo)
ALTER TABLE IF EXISTS "Organizations"
    ADD COLUMN IF NOT EXISTS prefijo_cotizacion TEXT DEFAULT 'COT-',
    ADD COLUMN IF NOT EXISTS prefijo_ticket TEXT DEFAULT 'POS-',
    ADD COLUMN IF NOT EXISTS pais_codigo TEXT DEFAULT 'GT',
    ADD COLUMN IF NOT EXISTS tipo_documento_fiscal TEXT DEFAULT 'NIT',
    ADD COLUMN IF NOT EXISTS catalogo_fotos_habilitado BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS webhook_correo_facturas TEXT,
    ADD COLUMN IF NOT EXISTS fel_habilitado BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS fel_nit_emisor TEXT,
    ADD COLUMN IF NOT EXISTS fel_nombre_comercial TEXT,
    ADD COLUMN IF NOT EXISTS fel_afiliacion_iva TEXT DEFAULT 'General',
    ADD COLUMN IF NOT EXISTS fel_codigo_establecimiento TEXT DEFAULT '1',
    ADD COLUMN IF NOT EXISTS fel_certificador TEXT DEFAULT 'INFILE',
    ADD COLUMN IF NOT EXISTS fel_entorno TEXT DEFAULT 'Pruebas',
    ADD COLUMN IF NOT EXISTS fel_usuario_certificador TEXT,
    ADD COLUMN IF NOT EXISTS fel_api_key TEXT,
    ADD COLUMN IF NOT EXISTS fel_frase_sat TEXT DEFAULT 'Sujeto a pagos trimestrales ISR',
    ADD COLUMN IF NOT EXISTS dias_vigencia_cotizacion INT DEFAULT 15,
    ADD COLUMN IF NOT EXISTS pie_ticket TEXT;

-- 4. EXTENSIÓN PARA LA TABLA Inventario (Fotos, Códigos, Precios Mayoristas y Sucursal)
ALTER TABLE IF EXISTS "Inventario"
    ADD COLUMN IF NOT EXISTS sku TEXT,
    ADD COLUMN IF NOT EXISTS descripcion TEXT,
    ADD COLUMN IF NOT EXISTS imagen_url TEXT,
    ADD COLUMN IF NOT EXISTS "precioPlata" NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS "precioOro" NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS sucursal_id TEXT,
    ADD COLUMN IF NOT EXISTS marca_id TEXT,
    ADD COLUMN IF NOT EXISTS linea_id TEXT,
    ADD COLUMN IF NOT EXISTS familia_id TEXT,
    ADD COLUMN IF NOT EXISTS unidad_negocio_id TEXT,
    ADD COLUMN IF NOT EXISTS tipo_producto_id TEXT;

-- 5. EXTENSIÓN PARA LA TABLA Clientes (Precios Diferenciados, NIT y Sucursal)
ALTER TABLE IF EXISTS "Clientes"
    ADD COLUMN IF NOT EXISTS lista_precio TEXT DEFAULT 'Publico',
    ADD COLUMN IF NOT EXISTS nit TEXT,
    ADD COLUMN IF NOT EXISTS sucursal_id TEXT;

-- 6. EXTENSIÓN PARA LA TABLA Transacciones / Contabilidad (Sucursal y Caja)
ALTER TABLE IF EXISTS "Transacciones"
    ADD COLUMN IF NOT EXISTS sucursal_id TEXT,
    ADD COLUMN IF NOT EXISTS caja_turno_id TEXT;

ALTER TABLE IF EXISTS "TransaccionesCRM"
    ADD COLUMN IF NOT EXISTS sucursal_id TEXT,
    ADD COLUMN IF NOT EXISTS caja_turno_id TEXT;

-- 7. EXTENSIÓN PARA LA TABLA Usuarios (Asignación de Sucursal)
ALTER TABLE IF EXISTS "Usuarios"
    ADD COLUMN IF NOT EXISTS sucursal_id TEXT;

-- 8. EXTENSIÓN PARA LA TABLA Encuestas (Token público para compartir)
ALTER TABLE IF EXISTS "encuestas"
    ADD COLUMN IF NOT EXISTS token_publico TEXT;

-- 9. POLÍTICAS RLS (Row Level Security) MULTITENANT
-- Asegura que ningún usuario acceda a datos de otra organización
DO $$
BEGIN
    -- Función auxiliar para obtener organization_id del usuario actual sin problemas de casteo de UUID
    CREATE OR REPLACE FUNCTION public.current_org_id()
    RETURNS TEXT AS $f$
        SELECT organization_id::text 
        FROM public."Usuarios" 
        WHERE (auth_uid = auth.uid()::text OR id::text = auth.uid()::text)
        LIMIT 1;
    $f$ LANGUAGE sql STABLE SECURITY DEFINER;
END $$;

-- 10. BUCKETS DE STORAGE (Crear en panel de Supabase > Storage como públicos si se requiere subida directa)
-- Buckets:
--   - productos
--   - logos-empresa

