-- ==============================================================================
-- SCRIPT DE MIGRACIÓN DEFINITIVO - CRM AZYVION (SUPABASE)
-- Ejecutar en el SQL Editor de tu proyecto Supabase
-- ==============================================================================

-- 1. EXTENSIÓN PARA LA TABLA Organizations (Configuración de Empresa, Vigencia, POS y FEL)
ALTER TABLE IF EXISTS public."Organizations"
    ADD COLUMN IF NOT EXISTS prefijo_cotizacion TEXT DEFAULT 'COT-',
    ADD COLUMN IF NOT EXISTS prefijo_ticket TEXT DEFAULT 'POS-',
    ADD COLUMN IF NOT EXISTS pais_codigo TEXT DEFAULT 'GT',
    ADD COLUMN IF NOT EXISTS tipo_documento_fiscal TEXT DEFAULT 'NIT',
    ADD COLUMN IF NOT EXISTS catalogo_fotos_habilitado BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS webhook_correo_facturas TEXT,
    ADD COLUMN IF NOT EXISTS dias_vigencia_cotizacion INT DEFAULT 15,
    ADD COLUMN IF NOT EXISTS pie_ticket TEXT DEFAULT 'Gracias por su compra — Conserve este comprobante',
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

-- 2. EXTENSIÓN PARA LA TABLA Clientes (Listas de Precio: Público, Plata, Oro)
ALTER TABLE IF EXISTS public."Clientes"
    ADD COLUMN IF NOT EXISTS lista_precio TEXT DEFAULT 'Publico',
    ADD COLUMN IF NOT EXISTS nit TEXT DEFAULT 'C/F',
    ADD COLUMN IF NOT EXISTS sucursal_id TEXT,
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- 3. EXTENSIÓN PARA LA TABLA Inventario (Precios por Nivel, Códigos y Clasificación)
ALTER TABLE IF EXISTS public."Inventario"
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
    ADD COLUMN IF NOT EXISTS tipo_producto_id TEXT,
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- 4. EXTENSIÓN PARA LA TABLA Cotizaciones y CotizacionItems
ALTER TABLE IF EXISTS public."Cotizaciones"
    ADD COLUMN IF NOT EXISTS organization_id TEXT,
    ADD COLUMN IF NOT EXISTS sucursal_id TEXT;

ALTER TABLE IF EXISTS public."CotizacionItems"
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- 5. EXTENSIÓN PARA LA TABLA Transacciones y Contabilidad
ALTER TABLE IF EXISTS public."Transacciones"
    ADD COLUMN IF NOT EXISTS organization_id TEXT,
    ADD COLUMN IF NOT EXISTS sucursal_id TEXT,
    ADD COLUMN IF NOT EXISTS caja_turno_id TEXT;

ALTER TABLE IF EXISTS public."TransaccionesCRM"
    ADD COLUMN IF NOT EXISTS organization_id TEXT,
    ADD COLUMN IF NOT EXISTS sucursal_id TEXT,
    ADD COLUMN IF NOT EXISTS caja_turno_id TEXT;

-- 6. EXTENSIÓN PARA LA TABLA Usuarios (Permisos de Submenús y Sucursales)
ALTER TABLE IF EXISTS public."Usuarios"
    ADD COLUMN IF NOT EXISTS permisos JSONB DEFAULT '{"submenus": ["pos", "clientes", "prospectos", "cotizaciones", "inventario", "crear-producto", "encuestas", "contabilidad", "perfil"]}'::jsonb,
    ADD COLUMN IF NOT EXISTS sucursal_id TEXT,
    ADD COLUMN IF NOT EXISTS auth_uid TEXT,
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- 7. EXTENSIÓN PARA LA TABLA encuestas (Token público para respuestas sin login)
CREATE TABLE IF NOT EXISTS public."encuestas" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    tipo TEXT DEFAULT 'Mixta',
    preg_total INT DEFAULT 5,
    notas TEXT,
    estado TEXT DEFAULT 'Borrador',
    token_publico TEXT,
    organization_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE IF EXISTS public."encuestas"
    ADD COLUMN IF NOT EXISTS token_publico TEXT,
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

ALTER TABLE IF EXISTS public."encuesta_preguntas"
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

ALTER TABLE IF EXISTS public."encuesta_envios"
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

ALTER TABLE IF EXISTS public."encuesta_respuestas"
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- 8. TABLA SUCURSALES (Multi-tienda)
CREATE TABLE IF NOT EXISTS public."Sucursales" (
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

-- 9. TABLA CAJAS_TURNOS (Historial de Aperturas y Cierres de Caja POS)
CREATE TABLE IF NOT EXISTS public."Cajas_Turnos" (
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
    estado TEXT DEFAULT 'ABIERTA',
    observaciones TEXT
);

-- ==============================================================================
-- 10. FUNCIÓN AUXILIAR MULTITENANT (SIN ERROR DE OPERADOR UUID = TEXT)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS TEXT AS $$
    SELECT organization_id::text
    FROM public."Usuarios"
    WHERE id::text = auth.uid()::text 
       OR auth_uid::text = auth.uid()::text
    LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ==============================================================================
-- 11. HABILITACIÓN DE RLS (ROW LEVEL SECURITY)
-- ==============================================================================

-- A. Clientes
ALTER TABLE public."Clientes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clientes_isolation_policy" ON public."Clientes";
CREATE POLICY "clientes_isolation_policy" ON public."Clientes"
    FOR ALL
    USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)
    WITH CHECK (organization_id::text = public.current_user_org_id() OR organization_id IS NULL);

-- B. Inventario
ALTER TABLE public."Inventario" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inventario_isolation_policy" ON public."Inventario";
CREATE POLICY "inventario_isolation_policy" ON public."Inventario"
    FOR ALL
    USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)
    WITH CHECK (organization_id::text = public.current_user_org_id() OR organization_id IS NULL);

-- C. Cotizaciones
ALTER TABLE public."Cotizaciones" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cotizaciones_isolation_policy" ON public."Cotizaciones";
CREATE POLICY "cotizaciones_isolation_policy" ON public."Cotizaciones"
    FOR ALL
    USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)
    WITH CHECK (organization_id::text = public.current_user_org_id() OR organization_id IS NULL);

-- D. Transacciones
ALTER TABLE public."Transacciones" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transacciones_isolation_policy" ON public."Transacciones";
CREATE POLICY "transacciones_isolation_policy" ON public."Transacciones"
    FOR ALL
    USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)
    WITH CHECK (organization_id::text = public.current_user_org_id() OR organization_id IS NULL);

-- E. Encuestas (Permite lectura pública para que clientes respondan por token/id)
ALTER TABLE public."encuestas" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "encuestas_select_public" ON public."encuestas";
CREATE POLICY "encuestas_select_public" ON public."encuestas"
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "encuestas_manage_org" ON public."encuestas";
CREATE POLICY "encuestas_manage_org" ON public."encuestas"
    FOR ALL
    USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)
    WITH CHECK (organization_id::text = public.current_user_org_id() OR organization_id IS NULL);

-- F. Respuestas y Envíos de Encuestas (Públicos para inserción y aislados para lectura)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'encuesta_envios') THEN
        ALTER TABLE public."encuesta_envios" ADD COLUMN IF NOT EXISTS organization_id TEXT;
        ALTER TABLE public."encuesta_envios" ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "encuesta_envios_insert_public" ON public."encuesta_envios";
        EXECUTE 'CREATE POLICY "encuesta_envios_insert_public" ON public."encuesta_envios" FOR INSERT WITH CHECK (true)';
        DROP POLICY IF EXISTS "encuesta_envios_select_org" ON public."encuesta_envios";
        EXECUTE 'CREATE POLICY "encuesta_envios_select_org" ON public."encuesta_envios" FOR SELECT USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)';
    END IF;

    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'encuesta_respuestas') THEN
        ALTER TABLE public."encuesta_respuestas" ADD COLUMN IF NOT EXISTS organization_id TEXT;
        ALTER TABLE public."encuesta_respuestas" ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "encuesta_respuestas_insert_public" ON public."encuesta_respuestas";
        EXECUTE 'CREATE POLICY "encuesta_respuestas_insert_public" ON public."encuesta_respuestas" FOR INSERT WITH CHECK (true)';
        DROP POLICY IF EXISTS "encuesta_respuestas_select_org" ON public."encuesta_respuestas";
        EXECUTE 'CREATE POLICY "encuesta_respuestas_select_org" ON public."encuesta_respuestas" FOR SELECT USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)';
    END IF;
END $$;
