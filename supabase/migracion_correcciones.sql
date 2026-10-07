-- ==============================================================================
-- MIGRACIÓN DE CORRECCIONES FUNCIONALES Y SEGURIDAD RLS - CRM AZYVION
-- Ejecutar en el SQL Editor de tu proyecto Supabase
-- ==============================================================================

-- 1. EXTENSIÓN PARA LA TABLA empleados (Soporte de campo ciudad y RLS)
CREATE TABLE IF NOT EXISTS public."empleados" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    apellido TEXT,
    puesto TEXT,
    fecha_nacimiento DATE,
    genero TEXT,
    estado_civil TEXT,
    nacionalidad TEXT,
    telefono TEXT,
    correo TEXT,
    telefono_emergencia TEXT,
    direccion TEXT,
    ciudad TEXT,
    pais TEXT DEFAULT 'Guatemala',
    codigo_empleado TEXT,
    departamento TEXT,
    tipo_contrato TEXT,
    fecha_ingreso DATE,
    salario_base NUMERIC(12,2),
    moneda TEXT DEFAULT 'GTQ',
    tipo_pago TEXT,
    numero_cuenta TEXT,
    banco TEXT,
    dpi_cedula TEXT,
    nit TEXT,
    no_afiliacion_igss TEXT,
    estado TEXT DEFAULT 'Activo',
    notas TEXT,
    organization_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE IF EXISTS public."empleados"
    ADD COLUMN IF NOT EXISTS ciudad TEXT,
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

ALTER TABLE public."empleados" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "empleados_isolation_policy" ON public."empleados";
CREATE POLICY "empleados_isolation_policy" ON public."empleados"
    FOR ALL
    USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)
    WITH CHECK (organization_id::text = public.current_user_org_id() OR organization_id IS NULL);

-- 2. EXTENSIÓN PARA LA TABLA encuesta_preguntas (Soporte de opciones para preguntas de selección)
CREATE TABLE IF NOT EXISTS public."encuesta_preguntas" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    encuesta_id UUID REFERENCES public."encuestas"(id) ON DELETE CASCADE,
    titulo TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'nps',
    orden INT DEFAULT 1,
    opciones JSONB,
    organization_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE IF EXISTS public."encuesta_preguntas"
    ADD COLUMN IF NOT EXISTS opciones JSONB,
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

ALTER TABLE public."encuesta_preguntas" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "encuesta_preguntas_select_public" ON public."encuesta_preguntas";
CREATE POLICY "encuesta_preguntas_select_public" ON public."encuesta_preguntas"
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "encuesta_preguntas_manage_org" ON public."encuesta_preguntas";
CREATE POLICY "encuesta_preguntas_manage_org" ON public."encuesta_preguntas"
    FOR ALL
    USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)
    WITH CHECK (organization_id::text = public.current_user_org_id() OR organization_id IS NULL);

-- 3. EXTENSIÓN PARA LA TABLA CotizacionItems (Persistencia completa de líneas manuales y cálculo)
ALTER TABLE IF EXISTS public."CotizacionItems"
    ADD COLUMN IF NOT EXISTS "descuentoPct" NUMERIC(5,2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS "total" NUMERIC(12,2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS "precioUnit" NUMERIC(12,2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS "cantidad" NUMERIC(12,2) DEFAULT 1.00,
    ADD COLUMN IF NOT EXISTS "descripcion" TEXT,
    ADD COLUMN IF NOT EXISTS "detalle" TEXT,
    ADD COLUMN IF NOT EXISTS "tipo" TEXT DEFAULT 'Producto',
    ADD COLUMN IF NOT EXISTS "itemId" TEXT,
    ADD COLUMN IF NOT EXISTS "unidadMedida" TEXT DEFAULT 'Unidad',
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

ALTER TABLE public."CotizacionItems" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cotizacion_items_isolation_policy" ON public."CotizacionItems";
CREATE POLICY "cotizacion_items_isolation_policy" ON public."CotizacionItems"
    FOR ALL
    USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)
    WITH CHECK (organization_id::text = public.current_user_org_id() OR organization_id IS NULL);

-- 4. SEGURIDAD Y RLS PARA TABLA Sucursales
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

ALTER TABLE public."Sucursales" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sucursales_isolation_policy" ON public."Sucursales";
CREATE POLICY "sucursales_isolation_policy" ON public."Sucursales"
    FOR ALL
    USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)
    WITH CHECK (organization_id::text = public.current_user_org_id() OR organization_id IS NULL);

-- 5. CATÁLOGOS DE INVENTARIO (Marcas, Líneas, Familias, Unidades de Negocio, Tipos de Producto)
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT unnest(ARRAY['MarcasInventario', 'LineasInventario', 'FamiliasInventario', 'UnidadesNegocio', 'TiposProducto'])
    LOOP
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS public.%I (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                organization_id TEXT,
                nombre TEXT NOT NULL,
                descripcion TEXT,
                activa BOOLEAN DEFAULT TRUE,
                creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id TEXT;
            ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;
            DROP POLICY IF EXISTS %I ON public.%I;
            CREATE POLICY %I ON public.%I
                FOR ALL
                USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)
                WITH CHECK (organization_id::text = public.current_user_org_id() OR organization_id IS NULL);
        ', t, t, t, lower(t) || '_isolation_policy', t, lower(t) || '_isolation_policy', t);
    END LOOP;
END $$;
