-- ==============================================================================
-- MIGRACIÓN DE CORRECCIONES FUNCIONALES Y SEGURIDAD RLS - CRM AZYVION
-- Ejecutar en el SQL Editor de tu proyecto Supabase
-- ==============================================================================

-- ==============================================================================
-- 0. FUNCIÓN AUXILIAR MULTITENANT
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS TEXT AS $$
    SELECT organization_id::text
    FROM public."Usuarios"
    WHERE id::text = auth.uid()::text 
       OR auth_uid::text = auth.uid()::text
    LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

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

-- 6. CONFIGURACIÓN DEL BUCKET fotos-perfil EN SUPABASE STORAGE
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('fotos-perfil', 'fotos-perfil', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "fotos_perfil_public_read" ON storage.objects;
CREATE POLICY "fotos_perfil_public_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'fotos-perfil');

DROP POLICY IF EXISTS "fotos_perfil_authenticated_insert" ON storage.objects;
CREATE POLICY "fotos_perfil_authenticated_insert" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'fotos-perfil');

DROP POLICY IF EXISTS "fotos_perfil_authenticated_update" ON storage.objects;
CREATE POLICY "fotos_perfil_authenticated_update" ON storage.objects
    FOR UPDATE USING (bucket_id = 'fotos-perfil');

DROP POLICY IF EXISTS "fotos_perfil_authenticated_delete" ON storage.objects;
CREATE POLICY "fotos_perfil_authenticated_delete" ON storage.objects
    FOR DELETE USING (bucket_id = 'fotos-perfil');

-- 7. TABLAS Y CONFIGURACIÓN DE SUSCRIPCIONES, PLANES (STARTER, PRO, ENTERPRISE) Y CONTROL DE PRUEBA DE 4 DÍAS
-- ==============================================================================

-- 7.1 TABLA sub_planes (Configuración de Planes, Límites y Funcionalidades)
CREATE TABLE IF NOT EXISTS public."sub_planes" (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    precio NUMERIC(10,2) NOT NULL DEFAULT 59.00,
    precio_anual NUMERIC(10,2) DEFAULT 47.00,
    moneda TEXT DEFAULT 'USD',
    ciclo TEXT DEFAULT 'monthly',
    max_usuarios INTEGER DEFAULT 3,
    max_sucursales INTEGER DEFAULT 1,
    max_contactos INTEGER DEFAULT 2500,
    max_storage_gb NUMERIC(6,1) DEFAULT 10,
    max_ia_consultas INTEGER DEFAULT 100,
    features JSONB DEFAULT '{}'::jsonb,
    activo BOOLEAN DEFAULT TRUE,
    destacado BOOLEAN DEFAULT FALSE,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
    fecha_actualizado TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS en sub_planes
ALTER TABLE public."sub_planes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sub_planes_public_read" ON public."sub_planes";
CREATE POLICY "sub_planes_public_read" ON public."sub_planes"
    FOR SELECT USING (true);

-- Semillas de los 3 Planes Oficiales de Alto Margen
INSERT INTO public."sub_planes" (id, nombre, descripcion, precio, precio_anual, moneda, ciclo, max_usuarios, max_sucursales, max_contactos, max_storage_gb, max_ia_consultas, features, activo, destacado)
VALUES
(
    'starter',
    'Starter',
    'El plan de despegue para PyMEs y comercios en crecimiento. Incluye CRM comercial, cotizaciones ilimitadas y 1 caja POS.',
    59.00,
    47.00,
    'USD',
    'monthly',
    3,
    1,
    2500,
    10.0,
    100,
    '{
        "crm": true,
        "cotizaciones_pdf": true,
        "catalogo_inventario": true,
        "pos": true,
        "pos_cajas": 1,
        "pos_arqueo": false,
        "pos_pagos_mixtos": false,
        "precios_plata_oro": false,
        "fel_sat": false,
        "contabilidad": false,
        "encuestas_ilimitadas": false,
        "comisiones": false,
        "auditoria": false
    }'::jsonb,
    true,
    false
),
(
    'pro',
    'Pro / Business',
    'La solución empresarial completa para comercios y distribuidores. Facturación SAT (FEL), POS multicaja con arqueo, precios mayoristas y finanzas.',
    149.00,
    119.00,
    'USD',
    'monthly',
    10,
    3,
    25000,
    50.0,
    1000,
    '{
        "crm": true,
        "cotizaciones_pdf": true,
        "catalogo_inventario": true,
        "pos": true,
        "pos_cajas": 5,
        "pos_arqueo": true,
        "pos_pagos_mixtos": true,
        "precios_plata_oro": true,
        "fel_sat": true,
        "contabilidad": true,
        "encuestas_ilimitadas": true,
        "comisiones": false,
        "auditoria": false
    }'::jsonb,
    true,
    true
),
(
    'enterprise',
    'Enterprise',
    'Para cadenas, franquicias y corporativos con alto volumen. Sucursales ilimitadas, cálculo de comisiones a vendedores y auditoría total.',
    299.00,
    239.00,
    'USD',
    'monthly',
    30,
    999,
    999999,
    500.0,
    999999,
    '{
        "crm": true,
        "cotizaciones_pdf": true,
        "catalogo_inventario": true,
        "pos": true,
        "pos_cajas": 999,
        "pos_arqueo": true,
        "pos_pagos_mixtos": true,
        "precios_plata_oro": true,
        "fel_sat": true,
        "contabilidad": true,
        "encuestas_ilimitadas": true,
        "comisiones": true,
        "auditoria": true
    }'::jsonb,
    true,
    false
)
ON CONFLICT (id) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    descripcion = EXCLUDED.descripcion,
    precio = EXCLUDED.precio,
    precio_anual = EXCLUDED.precio_anual,
    max_usuarios = EXCLUDED.max_usuarios,
    max_sucursales = EXCLUDED.max_sucursales,
    max_contactos = EXCLUDED.max_contactos,
    max_storage_gb = EXCLUDED.max_storage_gb,
    max_ia_consultas = EXCLUDED.max_ia_consultas,
    features = EXCLUDED.features,
    activo = EXCLUDED.activo,
    destacado = EXCLUDED.destacado,
    fecha_actualizado = NOW();

-- 7.2 TABLA sub_empresas (Empresas cliente con estado y control de los 4 días de trial)
CREATE TABLE IF NOT EXISTS public."sub_empresas" (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    correo TEXT,
    telefono TEXT,
    pais TEXT DEFAULT 'Guatemala',
    plan_id TEXT REFERENCES public."sub_planes"(id) DEFAULT 'starter',
    estado TEXT DEFAULT 'TRIAL', -- 'TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED'
    dias_prueba INTEGER DEFAULT 4,
    fecha_inicio DATE DEFAULT CURRENT_DATE,
    fecha_fin DATE DEFAULT (CURRENT_DATE + INTERVAL '4 days'),
    ciclo TEXT DEFAULT 'monthly',
    precio NUMERIC(10,2) DEFAULT 59.00,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    consultas_ia_consumidas INTEGER DEFAULT 0,
    notas TEXT,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
    fecha_actualizado TIMESTAMPTZ DEFAULT NOW()
);

-- Asegurar columnas si sub_empresas ya existía
ALTER TABLE IF EXISTS public."sub_empresas"
    ADD COLUMN IF NOT EXISTS dias_prueba INTEGER DEFAULT 4,
    ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
    ADD COLUMN IF NOT EXISTS consultas_ia_consumidas INTEGER DEFAULT 0;

ALTER TABLE public."sub_empresas" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sub_empresas_isolation_policy" ON public."sub_empresas";
CREATE POLICY "sub_empresas_isolation_policy" ON public."sub_empresas"
    FOR ALL
    USING (id = public.current_user_org_id() OR public.current_user_org_id() IS NULL)
    WITH CHECK (id = public.current_user_org_id() OR public.current_user_org_id() IS NULL);

-- 7.3 TABLA sub_suscripciones (Historial de suscripciones y renovaciones)
CREATE TABLE IF NOT EXISTS public."sub_suscripciones" (
    id TEXT PRIMARY KEY DEFAULT ('SUB-' || substr(md5(random()::text), 1, 10)),
    empresa_id TEXT REFERENCES public."sub_empresas"(id) ON DELETE CASCADE,
    plan_id TEXT REFERENCES public."sub_planes"(id),
    estado TEXT DEFAULT 'TRIAL',
    fecha_inicio DATE DEFAULT CURRENT_DATE,
    fecha_fin DATE DEFAULT (CURRENT_DATE + INTERVAL '4 days'),
    proximo_cobro DATE,
    precio NUMERIC(10,2) DEFAULT 59.00,
    moneda TEXT DEFAULT 'USD',
    ciclo TEXT DEFAULT 'monthly',
    ultimo_pago DATE,
    stripe_subscription_id TEXT,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public."sub_suscripciones" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sub_suscripciones_isolation_policy" ON public."sub_suscripciones";
CREATE POLICY "sub_suscripciones_isolation_policy" ON public."sub_suscripciones"
    FOR ALL
    USING (empresa_id = public.current_user_org_id() OR public.current_user_org_id() IS NULL)
    WITH CHECK (empresa_id = public.current_user_org_id() OR public.current_user_org_id() IS NULL);

-- 7.4 TABLA sub_pagos (Registro histórico de pagos exitosos)
CREATE TABLE IF NOT EXISTS public."sub_pagos" (
    id TEXT PRIMARY KEY DEFAULT ('PAY-' || substr(md5(random()::text), 1, 10)),
    empresa_id TEXT REFERENCES public."sub_empresas"(id) ON DELETE CASCADE,
    suscripcion_id TEXT REFERENCES public."sub_suscripciones"(id),
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    monto NUMERIC(10,2) NOT NULL,
    moneda TEXT DEFAULT 'USD',
    estado TEXT DEFAULT 'SUCCESS',
    metodo TEXT DEFAULT 'Tarjeta',
    referencia TEXT,
    notas TEXT,
    fecha_creacion TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public."sub_pagos" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sub_pagos_isolation_policy" ON public."sub_pagos";
CREATE POLICY "sub_pagos_isolation_policy" ON public."sub_pagos"
    FOR ALL
    USING (empresa_id = public.current_user_org_id() OR public.current_user_org_id() IS NULL)
    WITH CHECK (empresa_id = public.current_user_org_id() OR public.current_user_org_id() IS NULL);

-- 7.5 TABLA sub_auditoria (Auditoría administrativa de empresas y licencias)
CREATE TABLE IF NOT EXISTS public."sub_auditoria" (
    id TEXT PRIMARY KEY DEFAULT ('AUD-' || substr(md5(random()::text), 1, 10)),
    fecha TIMESTAMPTZ DEFAULT NOW(),
    admin_usuario TEXT NOT NULL,
    accion TEXT NOT NULL,
    empresa_id TEXT,
    empresa_nombre TEXT,
    detalle TEXT,
    datos_anteriores JSONB,
    datos_nuevos JSONB
);

ALTER TABLE public."sub_auditoria" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sub_auditoria_isolation_policy" ON public."sub_auditoria";
CREATE POLICY "sub_auditoria_isolation_policy" ON public."sub_auditoria"
    FOR ALL
    USING (true)
    WITH CHECK (true);


-- ==============================================================================
-- 8. CONFIGURACIÓN EMPRESARIAL, MULTI-SUCURSAL Y EXTENSIÓN DE TABLAS NATIVAS
-- ==============================================================================

-- 8.1 EXTENSIÓN PARA Organizations (Configuración General, FEL SAT, POS y Facturación)
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
    ADD COLUMN IF NOT EXISTS fel_frase_sat TEXT DEFAULT 'Sujeto a pagos trimestrales ISR',
    ADD COLUMN IF NOT EXISTS iva_pct NUMERIC(5,2) DEFAULT 12.00,
    ADD COLUMN IF NOT EXISTS iva_modalidad TEXT DEFAULT 'incluido';

-- 8.2 EXTENSIÓN PARA Clientes (Listas de Precio, NIT, Ubicación, Origen)
ALTER TABLE IF EXISTS public."Clientes"
    ADD COLUMN IF NOT EXISTS lista_precio TEXT DEFAULT 'Publico',
    ADD COLUMN IF NOT EXISTS nit TEXT DEFAULT 'C/F',
    ADD COLUMN IF NOT EXISTS direccion TEXT,
    ADD COLUMN IF NOT EXISTS ciudad TEXT,
    ADD COLUMN IF NOT EXISTS pais TEXT,
    ADD COLUMN IF NOT EXISTS fuente TEXT,
    ADD COLUMN IF NOT EXISTS sucursal_id TEXT,
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- 8.3 EXTENSIÓN PARA Prospectos (Dirección, Origen y Multitenant)
ALTER TABLE IF EXISTS public."Prospectos"
    ADD COLUMN IF NOT EXISTS direccion TEXT,
    ADD COLUMN IF NOT EXISTS origen TEXT,
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- 8.4 EXTENSIÓN PARA Inventario (Precios por Nivel Mayorista Plata/Oro y Clasificación)
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

-- 8.5 EXTENSIÓN PARA Cotizaciones y Transacciones
ALTER TABLE IF EXISTS public."Cotizaciones"
    ADD COLUMN IF NOT EXISTS organization_id TEXT,
    ADD COLUMN IF NOT EXISTS sucursal_id TEXT;

ALTER TABLE IF EXISTS public."Transacciones"
    ADD COLUMN IF NOT EXISTS organization_id TEXT,
    ADD COLUMN IF NOT EXISTS sucursal_id TEXT,
    ADD COLUMN IF NOT EXISTS caja_id TEXT,
    ADD COLUMN IF NOT EXISTS metodo_pago TEXT,
    ADD COLUMN IF NOT EXISTS ticket_id TEXT,
    ADD COLUMN IF NOT EXISTS factura_fel_id TEXT;

-- ==============================================================================
-- 9. CONTROL DE TURNOS Y ARQUEO DE CAJA POS (Cajas_Turnos)
-- ==============================================================================
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
    estado TEXT DEFAULT 'ABIERTA', -- 'ABIERTA' o 'CERRADA'
    observaciones TEXT
);

ALTER TABLE public."Cajas_Turnos" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cajas_turnos_isolation_policy" ON public."Cajas_Turnos";
CREATE POLICY "cajas_turnos_isolation_policy" ON public."Cajas_Turnos"
    FOR ALL
    USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)
    WITH CHECK (organization_id::text = public.current_user_org_id() OR organization_id IS NULL);

-- ==============================================================================
-- 10. FACTURACIÓN ELECTRÓNICA SAT GUATEMALA (fel_facturas)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public."fel_facturas" (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    sucursal_id TEXT,
    numero_dte TEXT NOT NULL,
    serie_dte TEXT NOT NULL,
    uuid_sat TEXT NOT NULL,
    fecha_certificacion TIMESTAMP WITH TIME ZONE NOT NULL,
    cliente_nit TEXT NOT NULL,
    cliente_nombre TEXT NOT NULL,
    monto_total NUMERIC(12,2) NOT NULL,
    monto_iva NUMERIC(12,2) NOT NULL,
    certificador TEXT DEFAULT 'INFILE',
    frase_sat TEXT,
    enlace_verificacion_sat TEXT,
    xml_certificado TEXT,
    estado TEXT DEFAULT 'ACTIVA', -- 'ACTIVA' o 'ANULADA'
    ticket_id TEXT,
    cotizacion_id TEXT,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public."fel_facturas" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fel_facturas_isolation_policy" ON public."fel_facturas";
CREATE POLICY "fel_facturas_isolation_policy" ON public."fel_facturas"
    FOR ALL
    USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)
    WITH CHECK (organization_id::text = public.current_user_org_id() OR organization_id IS NULL);

-- ==============================================================================
-- 11. MÓDULOS DE VALOR AGREGADO ENTERPRISE (Comisiones y Auditoría Forense)
-- ==============================================================================

-- 11.1 Liquidación Automática de Comisiones a Vendedores
CREATE TABLE IF NOT EXISTS public."comisiones_vendedores" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id TEXT,
    empleado_id UUID REFERENCES public."empleados"(id) ON DELETE SET NULL,
    periodo_mes TEXT NOT NULL, -- Ej: '2026-10'
    total_ventas NUMERIC(12,2) DEFAULT 0.00,
    porcentaje_comision NUMERIC(5,2) DEFAULT 0.00,
    monto_comision NUMERIC(12,2) DEFAULT 0.00,
    bono_adicional NUMERIC(12,2) DEFAULT 0.00,
    estado TEXT DEFAULT 'PENDIENTE', -- 'PENDIENTE', 'APROBADA', 'PAGADA'
    notas TEXT,
    fecha_calculo TIMESTAMPTZ DEFAULT NOW(),
    fecha_pago TIMESTAMPTZ
);

ALTER TABLE public."comisiones_vendedores" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "comisiones_vendedores_isolation_policy" ON public."comisiones_vendedores";
CREATE POLICY "comisiones_vendedores_isolation_policy" ON public."comisiones_vendedores"
    FOR ALL
    USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)
    WITH CHECK (organization_id::text = public.current_user_org_id() OR organization_id IS NULL);

-- 11.2 Registro de Auditoría Forense y Trazabilidad del Sistema
CREATE TABLE IF NOT EXISTS public."auditoria_sistema" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id TEXT,
    usuario_id TEXT,
    usuario_nombre TEXT,
    accion TEXT NOT NULL, -- 'CREAR', 'EDITAR', 'ELIMINAR', 'DESCUENTO', 'ANULAR'
    modulo TEXT NOT NULL, -- 'POS', 'COTIZACIONES', 'INVENTARIO', 'AJUSTES'
    entidad_id TEXT,
    detalle TEXT,
    datos_anteriores JSONB,
    datos_nuevos JSONB,
    ip_address TEXT,
    fecha TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public."auditoria_sistema" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auditoria_sistema_isolation_policy" ON public."auditoria_sistema";
CREATE POLICY "auditoria_sistema_isolation_policy" ON public."auditoria_sistema"
    FOR ALL
    USING (organization_id::text = public.current_user_org_id() OR organization_id IS NULL)
    WITH CHECK (organization_id::text = public.current_user_org_id() OR organization_id IS NULL);
