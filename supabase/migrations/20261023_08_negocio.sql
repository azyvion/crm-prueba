-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Lote 6 · Negocio: reportes, comisiones, auditoría, proveedores y compras con
-- costo/margen, kardex, conteo físico, reposición, código de barras y seguimiento de clientes.
-- Reglas: todo es por organización, la escritura solo ocurre en funciones SECURITY DEFINER con
-- permisos (Usuarios.permisos.pos: reportes · compras · inventario_ajuste), los registros no se
-- borran y las operaciones críticas son transaccionales e idempotentes.
-- Requiere 06 y 07. Reversión: 20261023_08_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════

-- ── Columnas nuevas ──────────────────────────────────────────────────────
ALTER TABLE public."Inventario"
  ADD COLUMN IF NOT EXISTS stock_minimo   numeric(12,3) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  ADD COLUMN IF NOT EXISTS costo_unit     numeric(12,4) NOT NULL DEFAULT 0 CHECK (costo_unit >= 0),   -- costo promedio ponderado
  ADD COLUMN IF NOT EXISTS codigo_barras  text;
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventario_codbarras
  ON public."Inventario" (organization_id, lower(codigo_barras)) WHERE codigo_barras IS NOT NULL AND codigo_barras <> '';
ALTER TABLE public."Clientes" ADD COLUMN IF NOT EXISTS fecha_nacimiento date;
ALTER TABLE public.pos_venta_items ADD COLUMN IF NOT EXISTS costo_unit numeric(12,4) NOT NULL DEFAULT 0;   -- costo al momento de la venta

-- ── Tablas ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proveedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL,
  nombre text NOT NULL, nit text, contacto text, telefono text, correo text, direccion text, notas text,
  activo boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proveedores_nombre_uq UNIQUE (organization_id, nombre)
);
CREATE TABLE IF NOT EXISTS public.compras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, sucursal_id text,
  numero text NOT NULL, idempotency_key text NOT NULL,
  proveedor_id uuid REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  referencia text, fecha date NOT NULL,
  estado text NOT NULL DEFAULT 'Recibida' CHECK (estado IN ('Recibida', 'Anulada')),
  forma_pago text NOT NULL DEFAULT 'Contado' CHECK (forma_pago IN ('Contado', 'Crédito')),
  pagada boolean NOT NULL DEFAULT false, cuenta_bancaria_id uuid, transaccion_id uuid,
  total numeric(12,2) NOT NULL CHECK (total >= 0), notas text, usuario text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), anulada_en timestamptz, anulada_por text, motivo_anulacion text,
  CONSTRAINT compras_numero_uq UNIQUE (organization_id, numero),
  CONSTRAINT compras_idem_uq UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_compras_org_fecha ON public.compras (organization_id, fecha DESC);
CREATE TABLE IF NOT EXISTS public.compra_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), compra_id uuid NOT NULL REFERENCES public.compras(id) ON DELETE RESTRICT,
  orden integer NOT NULL, producto_id uuid NOT NULL, descripcion text NOT NULL,
  cantidad numeric(12,3) NOT NULL CHECK (cantidad > 0), costo_unit numeric(12,4) NOT NULL CHECK (costo_unit >= 0),
  total numeric(12,2) NOT NULL CHECK (total >= 0)
);
CREATE INDEX IF NOT EXISTS ix_compra_items_compra ON public.compra_items (compra_id);
CREATE TABLE IF NOT EXISTS public.inv_movimientos (
  id bigserial PRIMARY KEY, organization_id text NOT NULL, producto_id uuid NOT NULL,
  tipo text NOT NULL, cantidad numeric(12,3) NOT NULL, saldo numeric(12,3) NOT NULL, costo_unit numeric(12,4),
  referencia text, motivo text, usuario text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_inv_mov_prod ON public.inv_movimientos (organization_id, producto_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.inv_conteos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, nombre text NOT NULL,
  estado text NOT NULL DEFAULT 'Abierto' CHECK (estado IN ('Abierto', 'Aplicado')),
  usuario text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), aplicado_en timestamptz, aplicado_por text
);
CREATE TABLE IF NOT EXISTS public.inv_conteo_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conteo_id uuid NOT NULL REFERENCES public.inv_conteos(id) ON DELETE RESTRICT,
  producto_id uuid NOT NULL, descripcion text NOT NULL, sku text,
  sistema numeric(12,3) NOT NULL, contado numeric(12,3) CHECK (contado IS NULL OR contado >= 0),
  CONSTRAINT inv_conteo_items_uq UNIQUE (conteo_id, producto_id)
);

-- RLS: lectura por organización; escritura solo por funciones
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['proveedores','compras','compra_items','inv_movimientos','inv_conteos','inv_conteo_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.inv_movimientos_id_seq FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS proveedores_sel ON public.proveedores;
CREATE POLICY proveedores_sel ON public.proveedores FOR SELECT TO authenticated USING (organization_id = public.current_user_org_id());
DROP POLICY IF EXISTS compras_sel ON public.compras;
CREATE POLICY compras_sel ON public.compras FOR SELECT TO authenticated USING (organization_id = public.current_user_org_id());
DROP POLICY IF EXISTS compra_items_sel ON public.compra_items;
CREATE POLICY compra_items_sel ON public.compra_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.compras c WHERE c.id = compra_id AND c.organization_id = public.current_user_org_id()));
DROP POLICY IF EXISTS inv_mov_sel ON public.inv_movimientos;
CREATE POLICY inv_mov_sel ON public.inv_movimientos FOR SELECT TO authenticated USING (organization_id = public.current_user_org_id());
DROP POLICY IF EXISTS inv_conteos_sel ON public.inv_conteos;
CREATE POLICY inv_conteos_sel ON public.inv_conteos FOR SELECT TO authenticated USING (organization_id = public.current_user_org_id());
DROP POLICY IF EXISTS inv_conteo_items_sel ON public.inv_conteo_items;
CREATE POLICY inv_conteo_items_sel ON public.inv_conteo_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.inv_conteos c WHERE c.id = conteo_id AND c.organization_id = public.current_user_org_id()));

-- Los registros no se borran; el kardex es de solo inserción
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['proveedores','compras','compra_items','inv_conteos','inv_conteo_items'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_pos_nodelete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_pos_nodelete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.pos_bloquear_borrado()', t);
  END LOOP;
END $$;
-- Solo se permite fijar una vez la referencia provisional («tmp:…») con el número definitivo del documento
CREATE OR REPLACE FUNCTION public.trg_fn_inv_mov_ro() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.referencia LIKE 'tmp:%' AND NEW.referencia IS DISTINCT FROM OLD.referencia
     AND (to_jsonb(NEW) - 'referencia') = (to_jsonb(OLD) - 'referencia') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'El kardex de inventario es de solo inserción.' USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS trg_inv_mov_ro ON public.inv_movimientos;
CREATE TRIGGER trg_inv_mov_ro BEFORE UPDATE OR DELETE ON public.inv_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_inv_mov_ro();

-- ── Kardex automático: cualquier cambio de existencias queda registrado ──
CREATE OR REPLACE FUNCTION public.trg_fn_inv_kardex() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user text; v_tipo text := NULLIF(current_setting('app.inv_tipo', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.unidades, 0) = 0 OR COALESCE(NEW.tipo, 'Producto') = 'Servicio' THEN RETURN NEW; END IF;
  ELSIF NEW.unidades IS NOT DISTINCT FROM OLD.unidades OR COALESCE(NEW.tipo, 'Producto') = 'Servicio' THEN
    RETURN NEW;
  END IF;
  SELECT usuario INTO v_user FROM public.pos_ctx() LIMIT 1;
  INSERT INTO public.inv_movimientos(organization_id, producto_id, tipo, cantidad, saldo, costo_unit, referencia, motivo, usuario)
  VALUES (NEW.organization_id, NEW.id,
          COALESCE(v_tipo, CASE WHEN TG_OP = 'INSERT' THEN 'Stock inicial' ELSE 'Ajuste manual' END),
          NEW.unidades - CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.unidades END, NEW.unidades, NEW.costo_unit,
          NULLIF(current_setting('app.inv_ref', true), ''), NULLIF(current_setting('app.inv_motivo', true), ''),
          COALESCE(v_user, 'sistema'));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_fn_inv_kardex() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_inv_kardex ON public."Inventario";
CREATE TRIGGER trg_inv_kardex AFTER INSERT OR UPDATE OF unidades ON public."Inventario"
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_inv_kardex();

CREATE OR REPLACE FUNCTION public.inv_ctx_mov(p_tipo text, p_ref text, p_motivo text DEFAULT NULL) RETURNS void
LANGUAGE sql SET search_path = '' AS $$
  SELECT set_config('app.inv_tipo', COALESCE(p_tipo, ''), true), set_config('app.inv_ref', COALESCE(p_ref, ''), true), set_config('app.inv_motivo', COALESCE(p_motivo, ''), true);
$$;
REVOKE ALL ON FUNCTION public.inv_ctx_mov(text, text, text) FROM PUBLIC, anon, authenticated;

-- ── Historial de compras de un cliente ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.pos_historial_cliente(p_cliente uuid, p_limite integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; r jsonb;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public."Clientes" WHERE id = p_cliente AND organization_id = c.org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado.' USING ERRCODE = 'P0001'; END IF;
  SELECT jsonb_build_object('ok', true,
    'resumen', (SELECT jsonb_build_object(
        'compras', count(*) FILTER (WHERE estado <> 'Anulada'),
        'total_comprado', COALESCE(sum(total - reembolsado), 0),
        'devuelto', COALESCE(sum(reembolsado), 0),
        'ticket_promedio', COALESCE(round(sum(total - reembolsado) FILTER (WHERE estado <> 'Anulada') / NULLIF(count(*) FILTER (WHERE estado <> 'Anulada'), 0), 2), 0),
        'primera_compra', min(created_at) FILTER (WHERE estado <> 'Anulada'),
        'ultima_compra', max(created_at) FILTER (WHERE estado <> 'Anulada'))
      FROM public.pos_ventas WHERE organization_id = c.org AND cliente_id = p_cliente),
    'ventas', COALESCE((SELECT jsonb_agg(x ORDER BY x ->> 'fecha' DESC) FROM (
        SELECT jsonb_build_object('id', v.id, 'numero', v.numero, 'fecha', v.created_at, 'estado', v.estado, 'total', v.total,
               'reembolsado', v.reembolsado, 'cajero', v.cajero,
               'articulos', (SELECT COALESCE(sum(i.cantidad), 0) FROM public.pos_venta_items i WHERE i.venta_id = v.id),
               'resumen', (SELECT string_agg(i.descripcion, ', ' ORDER BY i.orden) FROM public.pos_venta_items i WHERE i.venta_id = v.id)) AS x
          FROM public.pos_ventas v WHERE v.organization_id = c.org AND v.cliente_id = p_cliente
         ORDER BY v.created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limite, 100), 1), 500)) q), '[]'::jsonb),
    'top_productos', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('producto', i.descripcion, 'unidades', sum(i.cantidad - i.cantidad_devuelta), 'importe', round(sum(i.total * (i.cantidad - i.cantidad_devuelta) / i.cantidad), 2)) AS x
          FROM public.pos_venta_items i JOIN public.pos_ventas v ON v.id = i.venta_id
         WHERE v.organization_id = c.org AND v.cliente_id = p_cliente AND v.estado <> 'Anulada'
         GROUP BY i.descripcion HAVING sum(i.cantidad - i.cantidad_devuelta) > 0 ORDER BY sum(i.total * (i.cantidad - i.cantidad_devuelta) / i.cantidad) DESC LIMIT 5) q), '[]'::jsonb))
  INTO r;
  RETURN r;
END $$;

-- ── Reportes ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pos_kpis_int(p_org text, p_d1 date, p_d2 date, p_suc text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH v AS (SELECT * FROM public.pos_ventas WHERE organization_id = p_org
               AND (created_at AT TIME ZONE 'America/Guatemala')::date BETWEEN p_d1 AND p_d2
               AND (p_suc IS NULL OR sucursal_id IS NOT DISTINCT FROM p_suc)),
       it AS (SELECT i.* FROM public.pos_venta_items i JOIN v ON v.id = i.venta_id)
  SELECT jsonb_build_object(
    'tickets', (SELECT count(*) FROM v WHERE estado <> 'Anulada'),
    'tickets_anulados', (SELECT count(*) FROM v WHERE estado = 'Anulada'),
    'ventas_brutas', COALESCE((SELECT sum(total) FROM v), 0),
    'devoluciones', COALESCE((SELECT sum(reembolsado) FROM v), 0),
    'ventas_netas', COALESCE((SELECT sum(total - reembolsado) FROM v), 0),
    'descuentos', COALESCE((SELECT sum(descuento) FROM v WHERE estado <> 'Anulada'), 0),
    'iva_neto', COALESCE((SELECT round(sum(iva_monto * (total - reembolsado) / total), 2) FROM v), 0),
    'propinas', COALESCE((SELECT sum(propina) FROM v WHERE estado <> 'Anulada'), 0),
    'costo', COALESCE((SELECT round(sum((cantidad - cantidad_devuelta) * costo_unit), 2) FROM it), 0),
    'items_sin_costo', (SELECT count(*) FROM it WHERE costo_unit = 0 AND tipo <> 'Servicio' AND cantidad > cantidad_devuelta));
$$;

CREATE OR REPLACE FUNCTION public.pos_reporte_ventas(p_desde date, p_hasta date, p_sucursal text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; k jsonb; kp jsonb; span int; d0 date; d9 date; neto numeric; sin_iva numeric;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT public.pos_puede(c.privilegiado, c.perms, 'reportes') THEN RAISE EXCEPTION 'No tiene permiso para ver reportes.' USING ERRCODE = '42501'; END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 366 THEN
    RAISE EXCEPTION 'Rango de fechas inválido (máximo 366 días).' USING ERRCODE = '22023'; END IF;
  span := p_hasta - p_desde + 1; d9 := p_desde - 1; d0 := d9 - (span - 1);
  k := public.pos_kpis_int(c.org, p_desde, p_hasta, p_sucursal);
  kp := public.pos_kpis_int(c.org, d0, d9, p_sucursal);
  neto := (k ->> 'ventas_netas')::numeric; sin_iva := neto - (k ->> 'iva_neto')::numeric;
  RETURN jsonb_build_object('ok', true, 'desde', p_desde, 'hasta', p_hasta, 'kpis', k, 'kpis_previo', kp, 'periodo_previo', jsonb_build_object('desde', d0, 'hasta', d9),
    'ingresos_sin_iva', sin_iva,
    'ticket_promedio', CASE WHEN (k ->> 'tickets')::int > 0 THEN round(neto / (k ->> 'tickets')::int, 2) ELSE 0 END,
    'margen', sin_iva - (k ->> 'costo')::numeric,
    'margen_pct', CASE WHEN sin_iva > 0 THEN round((sin_iva - (k ->> 'costo')::numeric) / sin_iva * 100, 1) ELSE 0 END,
    'por_dia', COALESCE((SELECT jsonb_agg(jsonb_build_object('fecha', g.d::date, 'tickets', COALESCE(s.n, 0), 'neto', COALESCE(s.t, 0)) ORDER BY g.d)
        FROM generate_series(p_desde, p_hasta, interval '1 day') AS g(d)
        LEFT JOIN (SELECT (created_at AT TIME ZONE 'America/Guatemala')::date AS d, count(*) FILTER (WHERE estado <> 'Anulada') AS n, sum(total - reembolsado) AS t
                     FROM public.pos_ventas WHERE organization_id = c.org AND (p_sucursal IS NULL OR sucursal_id IS NOT DISTINCT FROM p_sucursal)
                      AND (created_at AT TIME ZONE 'America/Guatemala')::date BETWEEN p_desde AND p_hasta GROUP BY 1) s ON s.d = g.d::date), '[]'::jsonb),
    'por_metodo', COALESCE((SELECT jsonb_agg(jsonb_build_object('metodo', m, 'monto', round(cobrado - COALESCE(reemb, 0), 2)) ORDER BY m) FROM (
        SELECT g.metodo AS m, sum(g.monto) AS cobrado,
               (SELECT sum(d.monto) FROM public.pos_devoluciones d JOIN public.pos_ventas v2 ON v2.id = d.venta_id
                 WHERE d.organization_id = c.org AND d.metodo_reembolso = g.metodo
                   AND (v2.created_at AT TIME ZONE 'America/Guatemala')::date BETWEEN p_desde AND p_hasta
                   AND (p_sucursal IS NULL OR v2.sucursal_id IS NOT DISTINCT FROM p_sucursal)) AS reemb
          FROM public.pos_venta_pagos g JOIN public.pos_ventas v ON v.id = g.venta_id
         WHERE v.organization_id = c.org AND (v.created_at AT TIME ZONE 'America/Guatemala')::date BETWEEN p_desde AND p_hasta
           AND (p_sucursal IS NULL OR v.sucursal_id IS NOT DISTINCT FROM p_sucursal) GROUP BY g.metodo) q), '[]'::jsonb),
    'por_cajero', COALESCE((SELECT jsonb_agg(x ORDER BY (x ->> 'neto')::numeric DESC) FROM (
        SELECT jsonb_build_object('cajero', cajero, 'tickets', count(*) FILTER (WHERE estado <> 'Anulada'), 'neto', sum(total - reembolsado)) AS x
          FROM public.pos_ventas WHERE organization_id = c.org AND (created_at AT TIME ZONE 'America/Guatemala')::date BETWEEN p_desde AND p_hasta
           AND (p_sucursal IS NULL OR sucursal_id IS NOT DISTINCT FROM p_sucursal) GROUP BY cajero) q), '[]'::jsonb),
    'por_sucursal', COALESCE((SELECT jsonb_agg(x ORDER BY (x ->> 'neto')::numeric DESC) FROM (
        SELECT jsonb_build_object('sucursal_id', v.sucursal_id, 'sucursal', COALESCE(s.nombre, 'Sin sucursal'), 'tickets', count(*) FILTER (WHERE v.estado <> 'Anulada'), 'neto', sum(v.total - v.reembolsado)) AS x
          FROM public.pos_ventas v LEFT JOIN public."Sucursales" s ON s.id = v.sucursal_id AND s.organization_id = c.org
         WHERE v.organization_id = c.org AND (v.created_at AT TIME ZONE 'America/Guatemala')::date BETWEEN p_desde AND p_hasta
           AND (p_sucursal IS NULL OR v.sucursal_id IS NOT DISTINCT FROM p_sucursal) GROUP BY v.sucursal_id, s.nombre) q), '[]'::jsonb),
    'top_productos', COALESCE((SELECT jsonb_agg(x ORDER BY (x ->> 'importe')::numeric DESC) FROM (
        SELECT jsonb_build_object('producto', i.descripcion, 'sku', max(i.sku), 'unidades', sum(i.cantidad - i.cantidad_devuelta),
               'importe', round(sum(i.total * (i.cantidad - i.cantidad_devuelta) / i.cantidad), 2),
               'costo', round(sum((i.cantidad - i.cantidad_devuelta) * i.costo_unit), 2)) AS x
          FROM public.pos_venta_items i JOIN public.pos_ventas v ON v.id = i.venta_id
         WHERE v.organization_id = c.org AND v.estado <> 'Anulada' AND (v.created_at AT TIME ZONE 'America/Guatemala')::date BETWEEN p_desde AND p_hasta
           AND (p_sucursal IS NULL OR v.sucursal_id IS NOT DISTINCT FROM p_sucursal)
         GROUP BY i.descripcion HAVING sum(i.cantidad - i.cantidad_devuelta) > 0
         ORDER BY sum(i.total * (i.cantidad - i.cantidad_devuelta) / i.cantidad) DESC LIMIT 10) q), '[]'::jsonb),
    'sin_movimiento', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('producto', inv.producto, 'sku', inv.sku, 'unidades', inv.unidades) AS x
          FROM public."Inventario" inv
         WHERE inv.organization_id = c.org AND COALESCE(inv.activo, true) AND COALESCE(inv.tipo, 'Producto') <> 'Servicio' AND inv.unidades > 0
           AND NOT EXISTS (SELECT 1 FROM public.pos_venta_items i JOIN public.pos_ventas v ON v.id = i.venta_id
                            WHERE i.producto_id = inv.id AND v.estado <> 'Anulada' AND (v.created_at AT TIME ZONE 'America/Guatemala')::date BETWEEN p_desde AND p_hasta)
         ORDER BY inv.unidades DESC LIMIT 10) q), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.pos_reporte_cierres(p_desde date, p_hasta date, p_sucursal text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT public.pos_puede(c.privilegiado, c.perms, 'reportes') THEN RAISE EXCEPTION 'No tiene permiso para ver reportes.' USING ERRCODE = '42501'; END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 366 THEN
    RAISE EXCEPTION 'Rango de fechas inválido (máximo 366 días).' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('ok', true,
    'turnos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'sucursal', COALESCE(s.nombre, 'Sin sucursal'), 'cajero', t.cajero, 'apertura', t.fecha_apertura, 'cierre', t.fecha_cierre,
          'estado', t.estado, 'fondo', t.monto_inicial, 'ventas_efectivo', t.ventas_efectivo, 'ventas_tarjeta', t.ventas_tarjeta, 'ventas_transferencia', t.ventas_transferencia,
          'esperado', t.total_esperado, 'contado', t.efectivo_contado, 'diferencia', t.diferencia, 'tickets', t.tickets, 'cerrado_por', t.cerrado_por) ORDER BY t.fecha_apertura DESC)
        FROM public."Cajas_Turnos" t LEFT JOIN public."Sucursales" s ON s.id = t.sucursal_id AND s.organization_id = c.org
       WHERE t.organization_id = c.org AND (t.fecha_apertura AT TIME ZONE 'America/Guatemala')::date BETWEEN p_desde AND p_hasta
         AND (p_sucursal IS NULL OR t.sucursal_id IS NOT DISTINCT FROM p_sucursal)), '[]'::jsonb),
    'totales', (SELECT jsonb_build_object('turnos', count(*), 'cerrados', count(*) FILTER (WHERE estado = 'CERRADA'), 'abiertos', count(*) FILTER (WHERE estado = 'ABIERTA'),
          'ventas_efectivo', COALESCE(sum(ventas_efectivo), 0), 'ventas_tarjeta', COALESCE(sum(ventas_tarjeta), 0), 'ventas_transferencia', COALESCE(sum(ventas_transferencia), 0),
          'faltantes', COALESCE(sum(diferencia) FILTER (WHERE diferencia < 0), 0), 'sobrantes', COALESCE(sum(diferencia) FILTER (WHERE diferencia > 0), 0))
        FROM public."Cajas_Turnos" t WHERE t.organization_id = c.org AND (t.fecha_apertura AT TIME ZONE 'America/Guatemala')::date BETWEEN p_desde AND p_hasta
         AND (p_sucursal IS NULL OR t.sucursal_id IS NOT DISTINCT FROM p_sucursal)));
END $$;

CREATE OR REPLACE FUNCTION public.pos_reporte_comisiones(p_desde date, p_hasta date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; cfg jsonb; rows jsonb;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT public.pos_puede(c.privilegiado, c.perms, 'reportes') THEN RAISE EXCEPTION 'No tiene permiso para ver reportes.' USING ERRCODE = '42501'; END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 366 THEN
    RAISE EXCEPTION 'Rango de fechas inválido (máximo 366 días).' USING ERRCODE = '22023'; END IF;
  cfg := public.pos_cfg(c.org);
  SELECT COALESCE(jsonb_agg(x ORDER BY (x ->> 'base')::numeric DESC), '[]'::jsonb) INTO rows FROM (
    SELECT jsonb_build_object('cajero', q.cajero, 'tickets', q.tickets, 'ventas_netas', q.neto, 'base', q.base, 'pct', q.pct, 'comision', round(q.base * q.pct / 100, 2)) AS x
    FROM (SELECT v.cajero, count(*) FILTER (WHERE v.estado <> 'Anulada') AS tickets, sum(v.total - v.reembolsado) AS neto,
                 round(sum(v.total - v.reembolsado) - sum(v.iva_monto * (v.total - v.reembolsado) / v.total), 2) AS base,
                 COALESCE((SELECT (u.permisos ->> 'pos_comision_pct')::numeric FROM public."Usuarios" u WHERE u.organization_id = c.org AND u.usuario = v.cajero LIMIT 1),
                          (cfg ->> 'comision_pct_default')::numeric) AS pct
            FROM public.pos_ventas v
           WHERE v.organization_id = c.org AND (v.created_at AT TIME ZONE 'America/Guatemala')::date BETWEEN p_desde AND p_hasta
           GROUP BY v.cajero) q) z;
  RETURN jsonb_build_object('ok', true, 'desde', p_desde, 'hasta', p_hasta, 'filas', rows,
    'total_comisiones', COALESCE((SELECT sum((x ->> 'comision')::numeric) FROM jsonb_array_elements(rows) x), 0),
    'nota', 'Base = ventas netas (después de devoluciones) sin IVA. Porcentaje: el del usuario (Usuarios → comisión) o el por defecto de la empresa.');
END $$;

CREATE OR REPLACE FUNCTION public.pos_listar_auditoria(p_desde date, p_hasta date, p_accion text DEFAULT NULL, p_limite integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT c.privilegiado THEN RAISE EXCEPTION 'Solo un administrador puede ver la auditoría.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('ok', true, 'filas', COALESCE((SELECT jsonb_agg(x) FROM (
    SELECT jsonb_build_object('id', a.id, 'fecha', a.created_at, 'accion', a.accion, 'entidad', a.entidad, 'entidad_id', a.entidad_id, 'usuario', a.usuario, 'detalle', a.detalle) AS x
      FROM public.pos_auditoria a
     WHERE a.organization_id = c.org AND (a.created_at AT TIME ZONE 'America/Guatemala')::date BETWEEN COALESCE(p_desde, current_date - 30) AND COALESCE(p_hasta, current_date)
       AND (NULLIF(p_accion, '') IS NULL OR a.accion LIKE p_accion || '%')
     ORDER BY a.id DESC LIMIT LEAST(GREATEST(COALESCE(p_limite, 200), 1), 1000)) q), '[]'::jsonb));
END $$;

-- ── Seguimiento de clientes (recompra y cumpleaños) ──────────────────────
CREATE OR REPLACE FUNCTION public.seguimiento_clientes(p_dias_sin_compra integer DEFAULT 60, p_dias_cumple integer DEFAULT 14)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT public.pos_puede(c.privilegiado, c.perms, 'reportes') THEN RAISE EXCEPTION 'No tiene permiso para ver el seguimiento de clientes.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('ok', true,
    'recompra', COALESCE((SELECT jsonb_agg(x ORDER BY (x ->> 'dias')::int DESC) FROM (
      SELECT jsonb_build_object('id', cl.id, 'nombre', cl.nombre, 'telefono', cl.telefono, 'correo', cl.correo,
             'ultima_compra', max(v.created_at), 'dias', (current_date - (max(v.created_at) AT TIME ZONE 'America/Guatemala')::date),
             'compras', count(*), 'total', round(sum(v.total - v.reembolsado), 2)) AS x
        FROM public."Clientes" cl JOIN public.pos_ventas v ON v.cliente_id = cl.id AND v.organization_id = c.org AND v.estado <> 'Anulada'
       WHERE cl.organization_id = c.org AND cl."deletedAt" IS NULL
       GROUP BY cl.id, cl.nombre, cl.telefono, cl.correo
      HAVING (current_date - (max(v.created_at) AT TIME ZONE 'America/Guatemala')::date) >= GREATEST(COALESCE(p_dias_sin_compra, 60), 1) LIMIT 200) q), '[]'::jsonb),
    'cumpleanos', COALESCE((SELECT jsonb_agg(x ORDER BY (x ->> 'en_dias')::int) FROM (
      SELECT jsonb_build_object('id', cl.id, 'nombre', cl.nombre, 'telefono', cl.telefono, 'fecha_nacimiento', cl.fecha_nacimiento,
             'en_dias', n.prox - current_date, 'cumple', n.prox) AS x
        FROM public."Clientes" cl
        CROSS JOIN LATERAL (SELECT CASE WHEN make_date(extract(year FROM current_date)::int, extract(month FROM cl.fecha_nacimiento)::int, LEAST(extract(day FROM cl.fecha_nacimiento)::int, 28 + (extract(month FROM cl.fecha_nacimiento)::int <> 2)::int * 3)) >= current_date
                              THEN make_date(extract(year FROM current_date)::int, extract(month FROM cl.fecha_nacimiento)::int, LEAST(extract(day FROM cl.fecha_nacimiento)::int, 28 + (extract(month FROM cl.fecha_nacimiento)::int <> 2)::int * 3))
                              ELSE make_date(extract(year FROM current_date)::int + 1, extract(month FROM cl.fecha_nacimiento)::int, LEAST(extract(day FROM cl.fecha_nacimiento)::int, 28 + (extract(month FROM cl.fecha_nacimiento)::int <> 2)::int * 3)) END AS prox) n
       WHERE cl.organization_id = c.org AND cl."deletedAt" IS NULL AND cl.fecha_nacimiento IS NOT NULL
         AND n.prox - current_date <= GREATEST(COALESCE(p_dias_cumple, 14), 0) LIMIT 200) q), '[]'::jsonb));
END $$;

-- ── Proveedores ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.proveedor_guardar(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; v_id uuid; v_nombre text;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT public.pos_puede(c.privilegiado, c.perms, 'compras') THEN RAISE EXCEPTION 'No tiene permiso para administrar proveedores.' USING ERRCODE = '42501'; END IF;
  v_nombre := btrim(COALESCE(p ->> 'nombre', ''));
  IF length(v_nombre) < 2 OR length(v_nombre) > 120 THEN RAISE EXCEPTION 'Indique el nombre del proveedor.' USING ERRCODE = '22023'; END IF;
  IF COALESCE(p ->> 'id', '') = '' THEN
    BEGIN
      INSERT INTO public.proveedores(organization_id, nombre, nit, contacto, telefono, correo, direccion, notas)
      VALUES (c.org, v_nombre, NULLIF(btrim(p ->> 'nit'), ''), NULLIF(btrim(p ->> 'contacto'), ''), NULLIF(btrim(p ->> 'telefono'), ''),
              NULLIF(btrim(p ->> 'correo'), ''), NULLIF(btrim(p ->> 'direccion'), ''), NULLIF(btrim(p ->> 'notas'), '')) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Ya existe un proveedor con ese nombre.' USING ERRCODE = 'P0001'; END;
  ELSE
    v_id := (p ->> 'id')::uuid;
    BEGIN
      UPDATE public.proveedores SET nombre = v_nombre, nit = NULLIF(btrim(p ->> 'nit'), ''), contacto = NULLIF(btrim(p ->> 'contacto'), ''),
             telefono = NULLIF(btrim(p ->> 'telefono'), ''), correo = NULLIF(btrim(p ->> 'correo'), ''), direccion = NULLIF(btrim(p ->> 'direccion'), ''),
             notas = NULLIF(btrim(p ->> 'notas'), ''), activo = COALESCE((p ->> 'activo')::boolean, activo)
       WHERE id = v_id AND organization_id = c.org;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Ya existe un proveedor con ese nombre.' USING ERRCODE = 'P0001'; END;
    IF NOT FOUND THEN RAISE EXCEPTION 'Proveedor no encontrado.' USING ERRCODE = 'P0001'; END IF;
  END IF;
  PERFORM public.pos_audit(c.org, 'proveedor.guardar', 'proveedores', v_id::text, c.usuario, jsonb_build_object('nombre', v_nombre));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

-- ── Compras (entrada de mercadería con costo promedio) ───────────────────
CREATE OR REPLACE FUNCTION public.compra_registrar(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c record; v_key text; v_exist uuid; it jsonb; inv record; v_ids uuid[]; v_cant numeric; v_costo numeric; v_orden int := 0; v_total numeric := 0;
  v_prov uuid; v_forma text; v_cta uuid; v_anio int; v_seq int; v_numero text; v_compra uuid := gen_random_uuid(); v_trx uuid; v_fecha date;
  v_lines jsonb := '[]'::jsonb; v_nuevo numeric; v_base numeric; v_pagada boolean;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT public.pos_puede(c.privilegiado, c.perms, 'compras') THEN RAISE EXCEPTION 'No tiene permiso para registrar compras.' USING ERRCODE = '42501'; END IF;
  v_key := btrim(COALESCE(p ->> 'idempotency_key', ''));
  IF length(v_key) < 8 OR length(v_key) > 100 THEN RAISE EXCEPTION 'Falta la clave de idempotencia.' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('compra:' || c.org || ':' || v_key));
  SELECT id INTO v_exist FROM public.compras WHERE organization_id = c.org AND idempotency_key = v_key;
  IF v_exist IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'duplicado', true, 'compraId', v_exist); END IF;
  IF jsonb_typeof(p -> 'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'items') = 0 OR jsonb_array_length(p -> 'items') > 200 THEN
    RAISE EXCEPTION 'Agregue de 1 a 200 productos a la compra.' USING ERRCODE = '22023'; END IF;
  v_forma := COALESCE(NULLIF(p ->> 'formaPago', ''), 'Contado');
  IF v_forma NOT IN ('Contado', 'Crédito') THEN RAISE EXCEPTION 'Forma de pago inválida.' USING ERRCODE = '22023'; END IF;
  BEGIN v_fecha := COALESCE(NULLIF(p ->> 'fecha', '')::date, (now() AT TIME ZONE 'America/Guatemala')::date); EXCEPTION WHEN others THEN RAISE EXCEPTION 'Fecha inválida.' USING ERRCODE = '22023'; END;
  IF v_fecha > (now() AT TIME ZONE 'America/Guatemala')::date + 1 THEN RAISE EXCEPTION 'La fecha de la compra no puede ser futura.' USING ERRCODE = '22023'; END IF;
  v_prov := NULL;
  IF COALESCE(p ->> 'proveedorId', '') <> '' THEN
    v_prov := (p ->> 'proveedorId')::uuid;
    PERFORM 1 FROM public.proveedores WHERE id = v_prov AND organization_id = c.org AND activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Proveedor no encontrado o inactivo.' USING ERRCODE = 'P0001'; END IF;
  END IF;
  v_cta := NULL;
  IF v_forma = 'Contado' AND COALESCE(p ->> 'cuentaBancariaId', '') <> '' THEN
    v_cta := (p ->> 'cuentaBancariaId')::uuid;
    PERFORM 1 FROM public."CuentasBancarias" WHERE id = v_cta AND organization_id = c.org AND COALESCE(activa, true) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta bancaria inválida.' USING ERRCODE = 'P0001'; END IF;
  END IF;

  SELECT array_agg(DISTINCT (x ->> 'id')::uuid ORDER BY (x ->> 'id')::uuid) INTO v_ids FROM jsonb_array_elements(p -> 'items') x;
  PERFORM 1 FROM public."Inventario" WHERE id = ANY (v_ids) AND organization_id = c.org ORDER BY id FOR UPDATE;
  PERFORM public.inv_ctx_mov('Compra', 'tmp:' || v_compra::text, NULL);
  FOR it IN SELECT * FROM jsonb_array_elements(p -> 'items') LOOP
    v_orden := v_orden + 1;
    BEGIN v_cant := (it ->> 'cantidad')::numeric; v_costo := (it ->> 'costo')::numeric; EXCEPTION WHEN others THEN v_cant := NULL; END;
    IF v_cant IS NULL OR v_cant <= 0 OR v_cant > 1000000 OR round(v_cant, 3) <> v_cant THEN RAISE EXCEPTION 'Cantidad inválida en la línea %.', v_orden USING ERRCODE = '22023'; END IF;
    IF v_costo IS NULL OR v_costo < 0 OR v_costo > 100000000 OR round(v_costo, 4) <> v_costo THEN RAISE EXCEPTION 'Costo inválido en la línea %.', v_orden USING ERRCODE = '22023'; END IF;
    SELECT * INTO inv FROM public."Inventario" WHERE id = (it ->> 'id')::uuid AND organization_id = c.org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto de la línea % no encontrado.', v_orden USING ERRCODE = 'P0001'; END IF;
    IF COALESCE(inv.tipo, 'Producto') = 'Servicio' THEN RAISE EXCEPTION '"%" es un servicio: no se compra a inventario.', inv.producto USING ERRCODE = '22023'; END IF;
    v_base := GREATEST(COALESCE(inv.unidades, 0), 0);          -- existencias negativas no pesan en el costo
    v_nuevo := round((v_base * COALESCE(inv.costo_unit, 0) + v_cant * v_costo) / (v_base + v_cant), 4);
    UPDATE public."Inventario" SET unidades = unidades + v_cant, costo_unit = v_nuevo WHERE id = inv.id;
    v_total := v_total + round(v_cant * v_costo, 2);
    v_lines := v_lines || jsonb_build_object('orden', v_orden, 'producto_id', inv.id, 'descripcion', inv.producto, 'cantidad', v_cant, 'costo', v_costo, 'total', round(v_cant * v_costo, 2));
  END LOOP;
  PERFORM public.inv_ctx_mov(NULL, NULL, NULL);

  v_anio := extract(year FROM now() AT TIME ZONE 'America/Guatemala')::int;
  INSERT INTO public.pos_secuencias(organization_id, anio, ultimo) VALUES ('compra:' || c.org, v_anio, 1)
  ON CONFLICT (organization_id, anio) DO UPDATE SET ultimo = public.pos_secuencias.ultimo + 1 RETURNING ultimo INTO v_seq;
  v_numero := 'COM-' || v_anio || '-' || lpad(v_seq::text, 5, '0');
  v_total := round(v_total, 2);
  v_pagada := (v_forma = 'Contado');

  INSERT INTO public.compras(id, organization_id, sucursal_id, numero, idempotency_key, proveedor_id, referencia, fecha, forma_pago, pagada, cuenta_bancaria_id, total, notas, usuario)
  VALUES (v_compra, c.org, c.sucursal, v_numero, v_key, v_prov, NULLIF(btrim(p ->> 'referencia'), ''), v_fecha, v_forma, v_pagada, v_cta, v_total, NULLIF(btrim(p ->> 'notas'), ''), c.usuario);
  INSERT INTO public.compra_items(compra_id, orden, producto_id, descripcion, cantidad, costo_unit, total)
  SELECT v_compra, (l ->> 'orden')::int, (l ->> 'producto_id')::uuid, l ->> 'descripcion', (l ->> 'cantidad')::numeric, (l ->> 'costo')::numeric, (l ->> 'total')::numeric FROM jsonb_array_elements(v_lines) l;
  UPDATE public.inv_movimientos SET referencia = v_numero WHERE organization_id = c.org AND referencia = 'tmp:' || v_compra::text;

  IF v_pagada AND v_total > 0 THEN
    v_trx := gen_random_uuid();
    INSERT INTO public."Transacciones"(id, fecha, tipo, concepto, monto, "cuentaBancariaId", referencia, descripcion, "creadoPor", "fechaReg", organization_id, sucursal_id)
    VALUES (v_trx, v_fecha, 'Egreso', 'Compra · ' || v_numero, v_total, v_cta, v_numero,
            'Compra ' || v_numero || COALESCE(' · Factura ' || NULLIF(btrim(p ->> 'referencia'), ''), ''), c.usuario, now(), c.org, c.sucursal);
    IF v_cta IS NOT NULL THEN UPDATE public."CuentasBancarias" SET saldo = COALESCE(saldo, 0) - v_total WHERE id = v_cta AND organization_id = c.org; END IF;
    UPDATE public.compras SET transaccion_id = v_trx WHERE id = v_compra;
  END IF;
  PERFORM public.pos_audit(c.org, 'compra.registrar', 'compras', v_compra::text, c.usuario, jsonb_build_object('numero', v_numero, 'total', v_total, 'formaPago', v_forma));
  RETURN jsonb_build_object('ok', true, 'duplicado', false, 'compraId', v_compra, 'numero', v_numero, 'total', v_total);
END $$;

CREATE OR REPLACE FUNCTION public.compra_pagar(p_id uuid, p_cuenta uuid DEFAULT NULL, p_ref text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; cp record; v_trx uuid := gen_random_uuid();
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT public.pos_puede(c.privilegiado, c.perms, 'compras') THEN RAISE EXCEPTION 'No tiene permiso para pagar compras.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO cp FROM public.compras WHERE id = p_id AND organization_id = c.org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada.' USING ERRCODE = 'P0001'; END IF;
  IF cp.estado <> 'Recibida' THEN RAISE EXCEPTION 'La compra está anulada.' USING ERRCODE = 'P0001'; END IF;
  IF cp.pagada THEN RAISE EXCEPTION 'La compra ya está pagada.' USING ERRCODE = 'P0001'; END IF;
  IF p_cuenta IS NOT NULL THEN
    PERFORM 1 FROM public."CuentasBancarias" WHERE id = p_cuenta AND organization_id = c.org AND COALESCE(activa, true) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta bancaria inválida.' USING ERRCODE = 'P0001'; END IF;
    UPDATE public."CuentasBancarias" SET saldo = COALESCE(saldo, 0) - cp.total WHERE id = p_cuenta AND organization_id = c.org;
  END IF;
  INSERT INTO public."Transacciones"(id, fecha, tipo, concepto, monto, "cuentaBancariaId", referencia, descripcion, "creadoPor", "fechaReg", organization_id, sucursal_id)
  VALUES (v_trx, (now() AT TIME ZONE 'America/Guatemala')::date, 'Egreso', 'Pago de compra · ' || cp.numero, cp.total, p_cuenta, cp.numero,
          'Pago de compra a crédito ' || cp.numero || COALESCE(' · Ref. ' || NULLIF(btrim(p_ref), ''), ''), c.usuario, now(), c.org, c.sucursal);
  UPDATE public.compras SET pagada = true, cuenta_bancaria_id = p_cuenta, transaccion_id = v_trx WHERE id = p_id;
  PERFORM public.pos_audit(c.org, 'compra.pagar', 'compras', p_id::text, c.usuario, jsonb_build_object('numero', cp.numero, 'total', cp.total));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.compra_anular(p_id uuid, p_motivo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; cp record; li record; inv record; v_trx uuid;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT public.pos_puede(c.privilegiado, c.perms, 'compras') THEN RAISE EXCEPTION 'No tiene permiso para anular compras.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Indique el motivo (mínimo 5 caracteres).' USING ERRCODE = '22023'; END IF;
  SELECT * INTO cp FROM public.compras WHERE id = p_id AND organization_id = c.org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra no encontrada.' USING ERRCODE = 'P0001'; END IF;
  IF cp.estado = 'Anulada' THEN RAISE EXCEPTION 'La compra ya fue anulada.' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public."Inventario" WHERE organization_id = c.org AND id IN (SELECT producto_id FROM public.compra_items WHERE compra_id = p_id) ORDER BY id FOR UPDATE;
  PERFORM public.inv_ctx_mov('Anulación de compra', cp.numero, btrim(p_motivo));
  FOR li IN SELECT * FROM public.compra_items WHERE compra_id = p_id ORDER BY orden LOOP
    SELECT * INTO inv FROM public."Inventario" WHERE id = li.producto_id AND organization_id = c.org;
    IF NOT FOUND OR inv.unidades < li.cantidad THEN
      RAISE EXCEPTION 'No se puede anular: de "%" ya se vendió o ajustó parte de lo recibido (existencias %).', li.descripcion, COALESCE(inv.unidades, 0) USING ERRCODE = 'P0001';
    END IF;
    UPDATE public."Inventario" SET unidades = unidades - li.cantidad WHERE id = li.producto_id;   -- el costo promedio no se revierte (queda como histórico)
  END LOOP;
  PERFORM public.inv_ctx_mov(NULL, NULL, NULL);
  IF cp.pagada AND cp.total > 0 THEN
    v_trx := gen_random_uuid();
    INSERT INTO public."Transacciones"(id, fecha, tipo, concepto, monto, "cuentaBancariaId", referencia, descripcion, "creadoPor", "fechaReg", organization_id, sucursal_id)
    VALUES (v_trx, (now() AT TIME ZONE 'America/Guatemala')::date, 'Ingreso', 'Anulación de compra · ' || cp.numero, cp.total, cp.cuenta_bancaria_id, cp.numero,
            'Anulación de compra ' || cp.numero || ' · ' || btrim(p_motivo), c.usuario, now(), c.org, c.sucursal);
    IF cp.cuenta_bancaria_id IS NOT NULL THEN UPDATE public."CuentasBancarias" SET saldo = COALESCE(saldo, 0) + cp.total WHERE id = cp.cuenta_bancaria_id AND organization_id = c.org; END IF;
  END IF;
  UPDATE public.compras SET estado = 'Anulada', anulada_en = now(), anulada_por = c.usuario, motivo_anulacion = btrim(p_motivo) WHERE id = p_id;
  PERFORM public.pos_audit(c.org, 'compra.anular', 'compras', p_id::text, c.usuario, jsonb_build_object('numero', cp.numero, 'motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ── Ajustes y conteo físico ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.inv_ajustar(p_producto uuid, p_nuevo numeric, p_motivo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; inv record;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT public.pos_puede(c.privilegiado, c.perms, 'inventario_ajuste') THEN RAISE EXCEPTION 'No tiene permiso para ajustar inventario.' USING ERRCODE = '42501'; END IF;
  IF p_nuevo IS NULL OR p_nuevo < 0 OR p_nuevo > 100000000 OR round(p_nuevo, 3) <> p_nuevo THEN RAISE EXCEPTION 'Existencia inválida.' USING ERRCODE = '22023'; END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Indique el motivo del ajuste (mínimo 5 caracteres).' USING ERRCODE = '22023'; END IF;
  SELECT * INTO inv FROM public."Inventario" WHERE id = p_producto AND organization_id = c.org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF COALESCE(inv.tipo, 'Producto') = 'Servicio' THEN RAISE EXCEPTION 'Un servicio no tiene existencias.' USING ERRCODE = '22023'; END IF;
  PERFORM public.inv_ctx_mov('Ajuste', 'AJUSTE', btrim(p_motivo));
  UPDATE public."Inventario" SET unidades = p_nuevo WHERE id = p_producto;
  PERFORM public.inv_ctx_mov(NULL, NULL, NULL);
  PERFORM public.pos_audit(c.org, 'inventario.ajustar', 'Inventario', p_producto::text, c.usuario, jsonb_build_object('antes', inv.unidades, 'despues', p_nuevo, 'motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true, 'antes', inv.unidades, 'despues', p_nuevo);
END $$;

CREATE OR REPLACE FUNCTION public.inv_conteo_crear(p_nombre text, p_categoria text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; v_id uuid := gen_random_uuid(); n int;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT public.pos_puede(c.privilegiado, c.perms, 'inventario_ajuste') THEN RAISE EXCEPTION 'No tiene permiso para contar inventario.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_nombre, ''))) < 3 THEN RAISE EXCEPTION 'Indique un nombre para el conteo.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.inv_conteos(id, organization_id, nombre, usuario) VALUES (v_id, c.org, btrim(p_nombre), c.usuario);
  INSERT INTO public.inv_conteo_items(conteo_id, producto_id, descripcion, sku, sistema)
  SELECT v_id, i.id, i.producto, i.sku, COALESCE(i.unidades, 0) FROM public."Inventario" i
   WHERE i.organization_id = c.org AND COALESCE(i.activo, true) AND COALESCE(i.tipo, 'Producto') <> 'Servicio'
     AND (NULLIF(p_categoria, '') IS NULL OR i.categoria = p_categoria);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'No hay productos para contar con ese criterio.' USING ERRCODE = 'P0001'; END IF;
  PERFORM public.pos_audit(c.org, 'conteo.crear', 'inv_conteos', v_id::text, c.usuario, jsonb_build_object('nombre', btrim(p_nombre), 'productos', n));
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'productos', n);
END $$;

CREATE OR REPLACE FUNCTION public.inv_conteo_guardar(p_id uuid, p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; cn record; x jsonb; v numeric; n int := 0;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT public.pos_puede(c.privilegiado, c.perms, 'inventario_ajuste') THEN RAISE EXCEPTION 'No tiene permiso para contar inventario.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO cn FROM public.inv_conteos WHERE id = p_id AND organization_id = c.org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conteo no encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF cn.estado <> 'Abierto' THEN RAISE EXCEPTION 'El conteo ya fue aplicado.' USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Formato inválido.' USING ERRCODE = '22023'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    BEGIN v := NULLIF(x ->> 'contado', '')::numeric; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Cantidad contada inválida.' USING ERRCODE = '22023'; END;
    IF v IS NOT NULL AND (v < 0 OR v > 100000000 OR round(v, 3) <> v) THEN RAISE EXCEPTION 'Cantidad contada inválida.' USING ERRCODE = '22023'; END IF;
    UPDATE public.inv_conteo_items SET contado = v WHERE conteo_id = p_id AND producto_id = (x ->> 'producto_id')::uuid;
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'guardados', n);
END $$;

CREATE OR REPLACE FUNCTION public.inv_conteo_aplicar(p_id uuid, p_motivo text DEFAULT 'Conteo físico') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; cn record; li record; inv record; n int := 0; ajustes jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT public.pos_puede(c.privilegiado, c.perms, 'inventario_ajuste') THEN RAISE EXCEPTION 'No tiene permiso para aplicar conteos.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO cn FROM public.inv_conteos WHERE id = p_id AND organization_id = c.org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conteo no encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF cn.estado <> 'Abierto' THEN RAISE EXCEPTION 'El conteo ya fue aplicado.' USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM public."Inventario" WHERE organization_id = c.org AND id IN (SELECT producto_id FROM public.inv_conteo_items WHERE conteo_id = p_id AND contado IS NOT NULL) ORDER BY id FOR UPDATE;
  PERFORM public.inv_ctx_mov('Ajuste por conteo', cn.nombre, COALESCE(NULLIF(btrim(p_motivo), ''), 'Conteo físico'));
  FOR li IN SELECT * FROM public.inv_conteo_items WHERE conteo_id = p_id AND contado IS NOT NULL ORDER BY producto_id LOOP
    SELECT * INTO inv FROM public."Inventario" WHERE id = li.producto_id AND organization_id = c.org;
    IF FOUND AND inv.unidades IS DISTINCT FROM li.contado THEN
      UPDATE public."Inventario" SET unidades = li.contado WHERE id = li.producto_id;
      n := n + 1;
      ajustes := ajustes || jsonb_build_object('producto', li.descripcion, 'antes', inv.unidades, 'despues', li.contado);
    END IF;
  END LOOP;
  PERFORM public.inv_ctx_mov(NULL, NULL, NULL);
  UPDATE public.inv_conteos SET estado = 'Aplicado', aplicado_en = now(), aplicado_por = c.usuario WHERE id = p_id;
  PERFORM public.pos_audit(c.org, 'conteo.aplicar', 'inv_conteos', p_id::text, c.usuario, jsonb_build_object('nombre', cn.nombre, 'ajustes', n));
  RETURN jsonb_build_object('ok', true, 'ajustados', n, 'detalle', ajustes);
END $$;

-- ── Reposición ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.inv_reposicion() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('ok', true, 'filas', COALESCE((SELECT jsonb_agg(x ORDER BY (x ->> 'faltante')::numeric DESC) FROM (
    SELECT jsonb_build_object('id', i.id, 'producto', i.producto, 'sku', i.sku, 'unidades', i.unidades, 'minimo', i.stock_minimo, 'maximo', i."stockMax",
           'costo', i.costo_unit, 'faltante', GREATEST(i.stock_minimo - i.unidades, 0),
           'sugerido', GREATEST(CEIL(GREATEST(i."stockMax", i.stock_minimo * 2) - i.unidades), 1),
           'ultimo_proveedor', (SELECT pr.nombre FROM public.compra_items ci JOIN public.compras cp ON cp.id = ci.compra_id AND cp.estado = 'Recibida'
                                  LEFT JOIN public.proveedores pr ON pr.id = cp.proveedor_id WHERE ci.producto_id = i.id ORDER BY cp.created_at DESC LIMIT 1)) AS x
      FROM public."Inventario" i
     WHERE i.organization_id = c.org AND COALESCE(i.activo, true) AND COALESCE(i.tipo, 'Producto') <> 'Servicio' AND i.stock_minimo > 0 AND i.unidades <= i.stock_minimo) q), '[]'::jsonb));
END $$;

-- ── Permisos de ejecución ────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['pos_historial_cliente(uuid,integer)', 'pos_kpis_int(text,date,date,text)', 'pos_reporte_ventas(date,date,text)',
    'pos_reporte_cierres(date,date,text)', 'pos_reporte_comisiones(date,date)', 'pos_listar_auditoria(date,date,text,integer)',
    'seguimiento_clientes(integer,integer)', 'proveedor_guardar(jsonb)', 'compra_registrar(jsonb)', 'compra_pagar(uuid,uuid,text)',
    'compra_anular(uuid,text)', 'inv_ajustar(uuid,numeric,text)', 'inv_conteo_crear(text,text)', 'inv_conteo_guardar(uuid,jsonb)',
    'inv_conteo_aplicar(uuid,text)', 'inv_reposicion()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.pos_historial_cliente(uuid, integer) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_reporte_ventas(date, date, text) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_reporte_cierres(date, date, text) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_reporte_comisiones(date, date) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_listar_auditoria(date, date, text, integer) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.seguimiento_clientes(integer, integer) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.proveedor_guardar(jsonb) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.compra_registrar(jsonb) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.compra_pagar(uuid, uuid, text) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.compra_anular(uuid, text) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.inv_ajustar(uuid, numeric, text) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.inv_conteo_crear(text, text) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.inv_conteo_guardar(uuid, jsonb) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.inv_conteo_aplicar(uuid, text) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.inv_reposicion() TO authenticated;
END $$;

-- ── Funciones del POS actualizadas (kardex, costo y nuevas opciones) ─────
CREATE OR REPLACE FUNCTION public.pos_cfg_defaults() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'descuento_max_default', 10,
    'vender_sin_stock', 'no',                 -- no | permiso | si
    'caja_obligatoria', 'auto',               -- auto (según plan) | si | no
    'redondeo_efectivo', 0,                   -- 0, 0.05, 0.10, 0.25, 0.50, 1
    'tolerancia_cuadre', 0,
    'cuadre_max_sin_supervisor', 0,           -- 0 = sin límite
    'efectivo_max_caja', 0,                   -- 0 = sin aviso
    'turno_horas_max', 0,                     -- 0 = sin límite
    'turno_bloquear', false,
    'ancho_papel', '80',                      -- 58 | 80
    'ticket_encabezado', '',
    'mostrar_sku', true, 'mostrar_cajero', true, 'mostrar_turno', true, 'mostrar_iva', true,
    'mostrar_redes', true, 'mostrar_qr', false,
    'ticket_autoimprimir', false, 'ticket_copias', 1,
    'plazo_devolucion_dias', 0,               -- 0 = sin plazo
    'motivos_devolucion', jsonb_build_array('Producto defectuoso', 'Error de precio o cobro', 'El cliente se arrepintió', 'Cambio de producto', 'Otro'),
    'motivos_sin_reingreso', jsonb_build_array('Producto defectuoso'),
    'nit_obligatorio_desde', 0,               -- 0 = nunca
    'propina_habilitada', false, 'propina_sugeridas', jsonb_build_array(10, 15),
    'metodos_habilitados', jsonb_build_array('Efectivo', 'Tarjeta', 'Transferencia'),
    'etiquetas_metodos', '{}'::jsonb,
    'stock_bajo_umbral', 5,
    'comision_pct_default', 0,                -- % de comisión sobre ventas netas sin IVA (usuario: Usuarios → comisión)
    'encuesta_url', '',                       -- enlace público de la encuesta de satisfacción (opcional)
    'mensaje_comprobante', 'Hola {nombre}, gracias por tu compra en {empresa}. Tu comprobante {numero} por {total}.',
    'mensaje_encuesta', 'Hola {nombre}, nos ayudaría mucho tu opinión sobre tu compra en {empresa}: {enlace}',
    'mensaje_recompra', 'Hola {nombre}, hace tiempo no te vemos en {empresa}. ¡Te esperamos con novedades!',
    'mensaje_cumple', '¡Feliz cumpleaños {nombre}! De parte de todos en {empresa}.'
  );
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_org_pos_config() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  d jsonb := public.pos_cfg_defaults(); c jsonb := COALESCE(NEW.pos_config, '{}'::jsonb); o jsonb := '{}'::jsonb;
  k text; v jsonb; e jsonb; n numeric; r jsonb := '{}'::jsonb; rk text; rv jsonb; m text;
BEGIN
  IF jsonb_typeof(c) <> 'object' THEN RAISE EXCEPTION 'Configuración POS inválida: debe ser un objeto.' USING ERRCODE = '22023'; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(c) LOOP
    CONTINUE WHEN NOT d ? k;                                   -- clave desconocida: se descarta
    IF jsonb_typeof(v) <> jsonb_typeof(d -> k) THEN
      RAISE EXCEPTION 'Configuración POS inválida: "%" debe ser de tipo %.', k, jsonb_typeof(d -> k) USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v) = 'number' THEN
      n := (v #>> '{}')::numeric;
      IF (k = 'descuento_max_default' AND (n < 0 OR n > 100))
         OR (k = 'redondeo_efectivo' AND n NOT IN (0, 0.05, 0.1, 0.25, 0.5, 1))
         OR (k IN ('tolerancia_cuadre', 'cuadre_max_sin_supervisor', 'efectivo_max_caja', 'nit_obligatorio_desde') AND (n < 0 OR n > 100000000))
         OR (k = 'ticket_copias' AND (n < 1 OR n > 3 OR n <> trunc(n)))
         OR (k = 'plazo_devolucion_dias' AND (n < 0 OR n > 3650 OR n <> trunc(n)))
         OR (k = 'stock_bajo_umbral' AND (n < 0 OR n > 100000))
         OR (k = 'comision_pct_default' AND (n < 0 OR n > 100))
         OR (k = 'turno_horas_max' AND (n < 0 OR n > 168))
      THEN RAISE EXCEPTION 'Configuración POS inválida: valor fuera de rango en "%".', k USING ERRCODE = '22023'; END IF;
    ELSIF jsonb_typeof(v) = 'string' THEN
      m := v #>> '{}';
      IF (k = 'vender_sin_stock' AND m NOT IN ('no', 'permiso', 'si'))
         OR (k = 'caja_obligatoria' AND m NOT IN ('auto', 'si', 'no'))
         OR (k = 'ancho_papel' AND m NOT IN ('58', '80'))
         OR (k IN ('ticket_encabezado', 'mensaje_comprobante', 'mensaje_encuesta', 'mensaje_recompra', 'mensaje_cumple', 'encuesta_url') AND length(m) > 300)
         OR (k = 'encuesta_url' AND m <> '' AND m !~* '^https?://')
      THEN RAISE EXCEPTION 'Configuración POS inválida en "%".', k USING ERRCODE = '22023'; END IF;
    ELSIF jsonb_typeof(v) = 'array' THEN
      IF jsonb_array_length(v) > 12 THEN RAISE EXCEPTION 'Configuración POS inválida: demasiados elementos en "%".', k USING ERRCODE = '22023'; END IF;
      FOR e IN SELECT * FROM jsonb_array_elements(v) LOOP
        IF k = 'metodos_habilitados' THEN
          IF jsonb_typeof(e) <> 'string' OR (e #>> '{}') NOT IN ('Efectivo', 'Tarjeta', 'Transferencia') THEN
            RAISE EXCEPTION 'Configuración POS inválida: método de pago desconocido.' USING ERRCODE = '22023'; END IF;
        ELSIF k = 'propina_sugeridas' THEN
          IF jsonb_typeof(e) <> 'number' OR (e #>> '{}')::numeric < 0 OR (e #>> '{}')::numeric > 100 THEN
            RAISE EXCEPTION 'Configuración POS inválida: propina sugerida fuera de rango.' USING ERRCODE = '22023'; END IF;
        ELSE
          IF jsonb_typeof(e) <> 'string' OR length(btrim(e #>> '{}')) = 0 OR length(e #>> '{}') > 60 THEN
            RAISE EXCEPTION 'Configuración POS inválida: textos de lista de 1 a 60 caracteres en "%".', k USING ERRCODE = '22023'; END IF;
        END IF;
      END LOOP;
      IF k = 'metodos_habilitados' AND jsonb_array_length(v) = 0 THEN
        RAISE EXCEPTION 'Debe haber al menos un método de pago habilitado.' USING ERRCODE = '22023'; END IF;
    ELSIF jsonb_typeof(v) = 'object' AND k = 'etiquetas_metodos' THEN
      FOR rk, rv IN SELECT * FROM jsonb_each(v) LOOP
        IF rk NOT IN ('Efectivo', 'Tarjeta', 'Transferencia') OR jsonb_typeof(rv) <> 'string' OR length(rv #>> '{}') > 30 THEN
          RAISE EXCEPTION 'Configuración POS inválida en "etiquetas_metodos".' USING ERRCODE = '22023'; END IF;
      END LOOP;
    END IF;
    o := o || jsonb_build_object(k, v);
  END LOOP;
  NEW.pos_config := o;

  -- Redes sociales: solo claves conocidas, texto corto
  IF jsonb_typeof(COALESCE(NEW.redes_sociales, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Redes sociales inválidas: debe ser un objeto.' USING ERRCODE = '22023'; END IF;
  FOR rk, rv IN SELECT * FROM jsonb_each(COALESCE(NEW.redes_sociales, '{}'::jsonb)) LOOP
    CONTINUE WHEN rk NOT IN ('facebook', 'instagram', 'tiktok', 'whatsapp', 'x', 'youtube');
    IF jsonb_typeof(rv) <> 'string' OR length(rv #>> '{}') > 120 THEN
      RAISE EXCEPTION 'Red social inválida: "%".', rk USING ERRCODE = '22023'; END IF;
    IF length(btrim(rv #>> '{}')) > 0 THEN r := r || jsonb_build_object(rk, btrim(rv #>> '{}')); END IF;
  END LOOP;
  NEW.redes_sociales := r;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.pos_mis_permisos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; k text; r jsonb := '{}'::jsonb; cfg jsonb;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  cfg := public.pos_cfg(c.org);
  FOREACH k IN ARRAY ARRAY['descuento', 'editar_precio', 'anular', 'devolver', 'caja_mov', 'reimprimir', 'sin_stock', 'reportes', 'compras', 'inventario_ajuste'] LOOP
    r := r || jsonb_build_object(k, public.pos_puede(c.privilegiado, c.perms, k));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'permisos', r, 'privilegiado', c.privilegiado, 'usuario', c.usuario, 'config', cfg,
    'puedeVenderSinStock', (cfg ->> 'vender_sin_stock') = 'si' OR ((cfg ->> 'vender_sin_stock') = 'permiso' AND (r ->> 'sin_stock')::boolean),
    'descuentoMax', CASE WHEN c.privilegiado THEN 100 ELSE COALESCE((c.perms ->> 'pos_descuento_max')::numeric, (cfg ->> 'descuento_max_default')::numeric) END);
END $$;

CREATE OR REPLACE FUNCTION public.pos_registrar_venta(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c record; v_key text; v_exist uuid;
  it jsonb; inv record; v_ids uuid[]; v_cli record; v_lista text; v_cli_lista text;
  v_cant numeric; v_precio numeric; v_lp numeric; v_pla numeric; v_oro numeric;
  v_lines jsonb := '[]'::jsonb; v_orden int := 0; v_subtotal numeric := 0; v_linea numeric;
  v_pct numeric; v_desc numeric; v_base numeric; v_total numeric; v_iva numeric := 0; v_ivapct numeric := 12; v_ivamod text := 'incluido';
  v_pref text := 'POS-'; v_anio int; v_seq int; v_numero text;
  v_turno text; v_sucursal text; v_venta uuid := gen_random_uuid();
  pg jsonb; v_metodo text; v_monto numeric; v_ref text; v_cta uuid;
  v_noncash numeric := 0; v_cash_recv numeric := 0; v_cash_app numeric; v_cambio numeric;
  v_trx uuid; v_cli_id uuid; v_cli_nombre text; v_nit text; v_dir text; v_pagos_n int := 0;
  v_cf constant text := 'Consumidor Final (C/F)'; v_hoy date;
  cfg jsonb; v_propina numeric := 0; v_due numeric; v_redondeo numeric := 0; v_cash_raw numeric; v_step numeric;
  v_sin_stock boolean := false; v_req_caja boolean; v_turno_ts timestamptz; v_dmax numeric;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Solicitud inválida.' USING ERRCODE = '22023'; END IF;
  cfg := public.pos_cfg(c.org);
  v_sin_stock := (cfg ->> 'vender_sin_stock') = 'si' OR ((cfg ->> 'vender_sin_stock') = 'permiso' AND public.pos_puede(c.privilegiado, c.perms, 'sin_stock'));
  v_dmax := COALESCE((c.perms ->> 'pos_descuento_max')::numeric, (cfg ->> 'descuento_max_default')::numeric);

  v_key := btrim(COALESCE(p ->> 'idempotency_key', ''));
  IF length(v_key) < 8 OR length(v_key) > 100 THEN RAISE EXCEPTION 'Falta la clave de idempotencia de la venta.' USING ERRCODE = '22023'; END IF;

  -- Idempotencia: el mismo intento (doble clic, reintento tras corte de red) devuelve la venta ya registrada.
  PERFORM pg_advisory_xact_lock(hashtext('pos_venta:' || c.org || ':' || v_key));
  SELECT id INTO v_exist FROM public.pos_ventas WHERE organization_id = c.org AND idempotency_key = v_key;
  IF v_exist IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicado', true, 'ticket', public.pos_ticket_json(v_exist));
  END IF;

  IF jsonb_typeof(p -> 'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'items') = 0 THEN
    RAISE EXCEPTION 'Agregue al menos un producto a la venta.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p -> 'items') > 200 THEN RAISE EXCEPTION 'La venta supera el máximo de 200 líneas.' USING ERRCODE = '22023'; END IF;

  -- Turno de caja del servidor (no se confía en el cliente)
  v_sucursal := c.sucursal;
  SELECT id, fecha_apertura INTO v_turno, v_turno_ts FROM public."Cajas_Turnos"
   WHERE organization_id = c.org AND estado = 'ABIERTA' AND sucursal_id IS NOT DISTINCT FROM v_sucursal
   ORDER BY fecha_apertura DESC LIMIT 1 FOR SHARE;   -- serializa con el cierre de caja
  v_req_caja := CASE cfg ->> 'caja_obligatoria' WHEN 'si' THEN true WHEN 'no' THEN false
                  ELSE NOT COALESCE((p ->> 'permitir_sin_caja')::boolean, false) END;
  IF v_turno IS NULL AND v_req_caja THEN
    RAISE EXCEPTION 'No hay una caja abierta. Abra la caja antes de cobrar.' USING ERRCODE = 'P0001';
  END IF;
  IF v_turno IS NOT NULL AND COALESCE((cfg ->> 'turno_bloquear')::boolean, false) AND (cfg ->> 'turno_horas_max')::numeric > 0
     AND now() - v_turno_ts > ((cfg ->> 'turno_horas_max')::numeric * interval '1 hour') THEN
    RAISE EXCEPTION 'El turno lleva más de % horas abierto. Ciérrelo y abra uno nuevo para seguir cobrando.', (cfg ->> 'turno_horas_max') USING ERRCODE = 'P0001';
  END IF;

  -- Cliente / lista de precios
  v_cli_id := NULL; v_cli_nombre := COALESCE(NULLIF(btrim(p ->> 'clienteNombre'), ''), v_cf);
  v_nit := COALESCE(NULLIF(upper(btrim(p ->> 'nit')), ''), 'C/F'); v_dir := NULLIF(btrim(COALESCE(p ->> 'direccion', '')), '');
  v_cli_lista := 'Publico';
  IF COALESCE(p ->> 'clienteId', '') <> '' THEN
    SELECT id, nombre, nit, direccion, COALESCE(lista_precio, 'Publico') AS lista INTO v_cli
      FROM public."Clientes" WHERE id = (p ->> 'clienteId')::uuid AND organization_id = c.org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado.' USING ERRCODE = 'P0001'; END IF;
    v_cli_id := v_cli.id; v_cli_nombre := v_cli.nombre; v_nit := COALESCE(NULLIF(upper(btrim(v_cli.nit)), ''), 'C/F');
    v_dir := COALESCE(NULLIF(btrim(v_cli.direccion), ''), v_dir); v_cli_lista := v_cli.lista;
  END IF;
  v_lista := COALESCE(NULLIF(p ->> 'listaPrecio', ''), 'Publico');
  IF v_lista NOT IN ('Publico', 'Plata', 'Oro') THEN RAISE EXCEPTION 'Lista de precios inválida.' USING ERRCODE = '22023'; END IF;
  IF v_lista <> 'Publico' AND v_lista <> v_cli_lista AND NOT public.pos_puede(c.privilegiado, c.perms, 'editar_precio') THEN
    RAISE EXCEPTION 'La lista de precios "%" no corresponde al cliente y no tiene permiso para cambiarla.', v_lista USING ERRCODE = '42501';
  END IF;

  -- Bloquear inventario involucrado en orden fijo (evita interbloqueos)
  SELECT array_agg(DISTINCT (x ->> 'id')::uuid ORDER BY (x ->> 'id')::uuid) INTO v_ids
    FROM jsonb_array_elements(p -> 'items') x WHERE COALESCE(x ->> 'id', '') <> '';
  IF v_ids IS NOT NULL THEN
    PERFORM 1 FROM public."Inventario" WHERE id = ANY (v_ids) AND organization_id = c.org ORDER BY id FOR UPDATE;
  END IF;

  PERFORM public.inv_ctx_mov('Venta', 'tmp:' || v_venta::text, NULL);     -- kardex: origen del movimiento
  FOR it IN SELECT * FROM jsonb_array_elements(p -> 'items') LOOP
    v_orden := v_orden + 1;
    IF COALESCE(it ->> 'id', '') = '' THEN RAISE EXCEPTION 'La línea % no tiene producto.', v_orden USING ERRCODE = '22023'; END IF;
    BEGIN v_cant := (it ->> 'cantidad')::numeric; EXCEPTION WHEN others THEN v_cant := NULL; END;
    IF v_cant IS NULL OR v_cant <= 0 OR v_cant > 100000 OR round(v_cant, 3) <> v_cant THEN
      RAISE EXCEPTION 'Cantidad inválida en la línea %.', v_orden USING ERRCODE = '22023';
    END IF;
    SELECT * INTO inv FROM public."Inventario" WHERE id = (it ->> 'id')::uuid AND organization_id = c.org;
    IF NOT FOUND OR COALESCE(inv.activo, true) = false THEN
      RAISE EXCEPTION 'El producto de la línea % no está disponible.', v_orden USING ERRCODE = 'P0001';
    END IF;
    v_lp := COALESCE(inv."precioUnit", 0); v_pla := COALESCE(inv."precioPlata", 0); v_oro := COALESCE(inv."precioOro", 0);
    v_precio := CASE v_lista WHEN 'Plata' THEN CASE WHEN v_pla > 0 THEN v_pla ELSE v_lp END
                             WHEN 'Oro'   THEN CASE WHEN v_oro > 0 THEN v_oro WHEN v_pla > 0 THEN v_pla ELSE v_lp END
                             ELSE v_lp END;
    IF it ? 'precioUnit' AND abs(COALESCE((it ->> 'precioUnit')::numeric, v_precio) - v_precio) > 0.005 THEN
      IF NOT public.pos_puede(c.privilegiado, c.perms, 'editar_precio') THEN
        RAISE EXCEPTION 'No tiene permiso para modificar el precio de "%".', inv.producto USING ERRCODE = '42501';
      END IF;
      v_precio := round((it ->> 'precioUnit')::numeric, 2);
      IF v_precio < 0 THEN RAISE EXCEPTION 'Precio inválido en la línea %.', v_orden USING ERRCODE = '22023'; END IF;
    END IF;
    IF COALESCE(inv.tipo, 'Producto') <> 'Servicio' THEN
      IF v_sin_stock THEN
        UPDATE public."Inventario" SET unidades = unidades - v_cant WHERE id = inv.id;   -- la empresa permite vender sin existencias
      ELSE
        UPDATE public."Inventario" SET unidades = unidades - v_cant WHERE id = inv.id AND unidades >= v_cant;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Existencia insuficiente para "%" (disponible: %).', inv.producto, inv.unidades USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;
    v_linea := round(v_cant * v_precio, 2);
    v_subtotal := v_subtotal + v_linea;
    v_lines := v_lines || jsonb_build_object('orden', v_orden, 'producto_id', inv.id, 'descripcion', inv.producto,
                'sku', inv.sku, 'tipo', COALESCE(inv.tipo, 'Producto'), 'cantidad', v_cant, 'precio', v_precio, 'total', v_linea, 'costo', COALESCE(inv.costo_unit, 0));
  END LOOP;
  PERFORM public.inv_ctx_mov(NULL, NULL, NULL);
  v_subtotal := round(v_subtotal, 2);
  IF v_subtotal <= 0 THEN RAISE EXCEPTION 'El subtotal de la venta debe ser mayor a cero.' USING ERRCODE = '22023'; END IF;

  -- Descuento (con permiso y tope)
  BEGIN v_pct := COALESCE((p ->> 'descuentoPct')::numeric, 0); EXCEPTION WHEN others THEN v_pct := NULL; END;
  IF v_pct IS NULL OR v_pct < 0 OR v_pct > 100 OR round(v_pct, 2) <> v_pct THEN
    RAISE EXCEPTION 'El descuento debe estar entre 0 y 100 por ciento.' USING ERRCODE = '22023';
  END IF;
  IF v_pct > 0 THEN
    IF NOT public.pos_puede(c.privilegiado, c.perms, 'descuento') THEN
      RAISE EXCEPTION 'No tiene permiso para aplicar descuentos.' USING ERRCODE = '42501';
    END IF;
    IF NOT c.privilegiado AND v_pct > v_dmax THEN
      RAISE EXCEPTION 'Su descuento máximo autorizado es de % por ciento.', v_dmax USING ERRCODE = '42501';
    END IF;
  END IF;
  v_desc := round(v_subtotal * v_pct / 100, 2);
  v_base := round(v_subtotal - v_desc, 2);

  -- Impuestos según la configuración de la organización
  SELECT COALESCE(iva_pct, 12), COALESCE(iva_modalidad, 'incluido'), COALESCE(NULLIF(prefijo_ticket, ''), 'POS-')
    INTO v_ivapct, v_ivamod, v_pref FROM public."Organizations" WHERE id::text = c.org;
  v_ivapct := COALESCE(v_ivapct, 12); v_ivamod := COALESCE(v_ivamod, 'incluido'); v_pref := COALESCE(v_pref, 'POS-');
  IF v_ivamod = 'sobre' THEN
    v_iva := round(v_base * v_ivapct / 100, 2); v_total := round(v_base + v_iva, 2);
  ELSE
    v_total := v_base; v_iva := round(v_total - v_total / (1 + v_ivapct / 100), 2);
  END IF;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total a cobrar debe ser mayor a cero.' USING ERRCODE = '22023'; END IF;
  IF (cfg ->> 'nit_obligatorio_desde')::numeric > 0 AND v_total >= (cfg ->> 'nit_obligatorio_desde')::numeric AND v_nit = 'C/F' THEN
    RAISE EXCEPTION 'Para ventas desde Q % se requiere el NIT del cliente (no Consumidor Final).', (cfg ->> 'nit_obligatorio_desde') USING ERRCODE = 'P0001';
  END IF;
  BEGIN v_propina := round(COALESCE(NULLIF(p ->> 'propina', '')::numeric, 0), 2); EXCEPTION WHEN others THEN v_propina := NULL; END;
  IF v_propina IS NULL OR v_propina < 0 OR v_propina > v_total THEN RAISE EXCEPTION 'Propina inválida.' USING ERRCODE = '22023'; END IF;
  IF v_propina > 0 AND NOT COALESCE((cfg ->> 'propina_habilitada')::boolean, false) THEN
    RAISE EXCEPTION 'La propina no está habilitada para esta empresa.' USING ERRCODE = '22023'; END IF;
  v_due := round(v_total + v_propina, 2);
  -- Control cruzado con lo que vio el cajero en pantalla
  IF p ? 'total' AND abs(COALESCE((p ->> 'total')::numeric, v_total) - v_total) > 0.01 THEN
    RAISE EXCEPTION 'El total cambió (pantalla Q %, servidor Q %). Recargue el POS y revise precios.', (p ->> 'total'), v_total USING ERRCODE = 'P0001';
  END IF;

  -- Pagos (efectivo, tarjeta, transferencia; pueden combinarse)
  IF jsonb_typeof(p -> 'pagos') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'pagos') = 0 THEN
    RAISE EXCEPTION 'Indique al menos un método de pago.' USING ERRCODE = '22023';
  END IF;
  FOR pg IN SELECT * FROM jsonb_array_elements(p -> 'pagos') LOOP
    v_metodo := pg ->> 'metodo';
    BEGIN v_monto := (pg ->> 'monto')::numeric; EXCEPTION WHEN others THEN v_monto := NULL; END;
    IF v_metodo NOT IN ('Efectivo', 'Tarjeta', 'Transferencia') THEN RAISE EXCEPTION 'Método de pago no soportado.' USING ERRCODE = '22023'; END IF;
    IF NOT (cfg -> 'metodos_habilitados') ? v_metodo THEN RAISE EXCEPTION 'El método de pago % no está habilitado.', v_metodo USING ERRCODE = '22023'; END IF;
    IF v_monto IS NULL OR v_monto <= 0 OR round(v_monto, 2) <> v_monto THEN RAISE EXCEPTION 'Monto de pago inválido.' USING ERRCODE = '22023'; END IF;
    v_pagos_n := v_pagos_n + 1;
    IF v_metodo = 'Efectivo' THEN v_cash_recv := v_cash_recv + v_monto;
    ELSE
      v_noncash := v_noncash + v_monto;
      IF length(btrim(COALESCE(pg ->> 'referencia', ''))) < 3 THEN
        RAISE EXCEPTION 'Ingrese la referencia (autorización o boleta) del pago con %.', lower(v_metodo) USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
  IF v_noncash > v_due THEN RAISE EXCEPTION 'Los pagos electrónicos (Q %) superan el total (Q %).', v_noncash, v_due USING ERRCODE = '22023'; END IF;
  v_cash_raw := round(v_due - v_noncash, 2);
  v_cash_app := v_cash_raw;
  v_step := (cfg ->> 'redondeo_efectivo')::numeric;
  IF v_step > 0 AND v_cash_raw >= v_step THEN        -- redondeo al múltiplo más cercano (solo sobre el efectivo)
    v_cash_app := round(round(v_cash_raw / v_step, 0) * v_step, 2);
    v_redondeo := round(v_cash_app - v_cash_raw, 2);
  END IF;
  IF v_cash_recv < v_cash_app THEN
    RAISE EXCEPTION 'Pago insuficiente: faltan Q % para completar el total.', round(v_cash_app - v_cash_recv, 2) USING ERRCODE = 'P0001';
  END IF;
  IF v_cash_app = 0 AND v_cash_recv > 0 THEN
    RAISE EXCEPTION 'El total ya está cubierto con pagos electrónicos; quite el efectivo.' USING ERRCODE = '22023';
  END IF;
  v_cambio := round(v_cash_recv - v_cash_app, 2);

  -- Número de ticket atómico (arranca después del mayor número histórico en Transacciones)
  v_anio := extract(year FROM now() AT TIME ZONE 'America/Guatemala')::int;
  INSERT INTO public.pos_secuencias(organization_id, anio, ultimo)
  VALUES (c.org, v_anio, COALESCE((
      SELECT max(substring(referencia FROM '(\d+)$')::int) FROM public."Transacciones"
       WHERE organization_id = c.org AND left(referencia, length(v_pref || v_anio || '-')) = v_pref || v_anio || '-'
         AND referencia ~ '-\d+$'), 0) + 1)
  ON CONFLICT (organization_id, anio) DO UPDATE SET ultimo = public.pos_secuencias.ultimo + 1
  RETURNING ultimo INTO v_seq;
  v_numero := v_pref || v_anio || '-' || lpad(v_seq::text, 5, '0');

  -- Cliente nuevo con NIT (antes se insertaba desde el navegador, fuera de transacción)
  IF v_cli_id IS NULL AND v_nit <> 'C/F' AND v_cli_nombre <> v_cf THEN
    SELECT id INTO v_cli_id FROM public."Clientes"
     WHERE organization_id = c.org AND upper(regexp_replace(COALESCE(nit, ''), '[-\s]', '', 'g')) = regexp_replace(v_nit, '[-\s]', '', 'g')
     LIMIT 1;
    IF v_cli_id IS NULL THEN
      v_cli_id := gen_random_uuid();
      INSERT INTO public."Clientes"(id, nombre, nit, direccion, lista_precio, organization_id, sucursal_id, "creadoPor", "fechaReg")
      VALUES (v_cli_id, v_cli_nombre, v_nit, COALESCE(v_dir, 'Ciudad'), 'Publico', c.org, v_sucursal, c.usuario, now());
    END IF;
  END IF;

  INSERT INTO public.pos_ventas(id, organization_id, sucursal_id, caja_turno_id, numero, idempotency_key, cliente_id, cliente_nombre, nit,
      direccion, lista_precio, subtotal, descuento_pct, descuento, iva_pct, iva_modalidad, iva_monto, total, monto_recibido, cambio,
      cajero, cajero_id, cotizacion_id, propina, redondeo)
  VALUES (v_venta, c.org, v_sucursal, v_turno, v_numero, v_key, v_cli_id, v_cli_nombre, v_nit, v_dir, v_lista, v_subtotal, v_pct, v_desc,
      v_ivapct, v_ivamod, v_iva, v_total, v_cash_recv + v_noncash, v_cambio, c.usuario, c.uid, NULLIF(p ->> 'cotizacionId', ''), v_propina, v_redondeo);

  INSERT INTO public.pos_venta_items(venta_id, orden, producto_id, descripcion, sku, tipo, cantidad, precio_unit, total, costo_unit)
  SELECT v_venta, (l ->> 'orden')::int, (l ->> 'producto_id')::uuid, l ->> 'descripcion', l ->> 'sku', l ->> 'tipo',
         (l ->> 'cantidad')::numeric, (l ->> 'precio')::numeric, (l ->> 'total')::numeric, (l ->> 'costo')::numeric
    FROM jsonb_array_elements(v_lines) l;
  UPDATE public.inv_movimientos SET referencia = v_numero WHERE organization_id = c.org AND referencia = 'tmp:' || v_venta::text;

  v_hoy := (now() AT TIME ZONE 'America/Guatemala')::date;
  -- Un pago efectivo agregado + uno por cada pago electrónico; cada uno genera su Ingreso contable
  IF v_cash_app > 0 THEN
    v_trx := gen_random_uuid();
    INSERT INTO public."Transacciones"(id, fecha, tipo, concepto, monto, "cuentaBancariaId", referencia, descripcion, "creadoPor", "fechaReg",
        organization_id, sucursal_id, caja_turno_id)
    VALUES (v_trx, v_hoy, 'Ingreso', 'Venta POS · Ticket ' || v_numero, v_cash_app, NULL, v_numero,
        'Ticket ' || v_numero || ' · ' || v_cli_nombre || ' · Pago: Efectivo' || CASE WHEN v_nit <> 'C/F' THEN ' · NIT: ' || v_nit ELSE '' END,
        c.usuario, now(), c.org, v_sucursal, v_turno);
    INSERT INTO public.pos_venta_pagos(venta_id, metodo, monto, recibido, transaccion_id) VALUES (v_venta, 'Efectivo', v_cash_app, v_cash_recv, v_trx);
  END IF;
  FOR pg IN SELECT * FROM jsonb_array_elements(p -> 'pagos') WHERE value ->> 'metodo' <> 'Efectivo' LOOP
    v_metodo := pg ->> 'metodo'; v_monto := (pg ->> 'monto')::numeric; v_ref := btrim(pg ->> 'referencia'); v_cta := NULL;
    IF COALESCE(pg ->> 'cuentaBancariaId', '') <> '' THEN
      BEGIN v_cta := (pg ->> 'cuentaBancariaId')::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Cuenta bancaria inválida.' USING ERRCODE = '22023'; END;
      PERFORM 1 FROM public."CuentasBancarias" WHERE id = v_cta AND organization_id = c.org AND COALESCE(activa, true);
      IF NOT FOUND THEN RAISE EXCEPTION 'La cuenta bancaria seleccionada no existe o está inactiva.' USING ERRCODE = 'P0001'; END IF;
    END IF;
    v_trx := gen_random_uuid();
    INSERT INTO public."Transacciones"(id, fecha, tipo, concepto, monto, "cuentaBancariaId", referencia, descripcion, "creadoPor", "fechaReg",
        organization_id, sucursal_id, caja_turno_id)
    VALUES (v_trx, v_hoy, 'Ingreso', 'Venta POS · Ticket ' || v_numero, v_monto, v_cta, v_numero,
        'Ticket ' || v_numero || ' · ' || v_cli_nombre || ' · Pago: ' || v_metodo || ' (ref. ' || v_ref || ')' || CASE WHEN v_nit <> 'C/F' THEN ' · NIT: ' || v_nit ELSE '' END,
        c.usuario, now(), c.org, v_sucursal, v_turno);
    IF v_cta IS NOT NULL THEN
      UPDATE public."CuentasBancarias" SET saldo = COALESCE(saldo, 0) + v_monto WHERE id = v_cta AND organization_id = c.org;
    END IF;
    INSERT INTO public.pos_venta_pagos(venta_id, metodo, monto, recibido, referencia, cuenta_bancaria_id, transaccion_id)
    VALUES (v_venta, v_metodo, v_monto, v_monto, v_ref, v_cta, v_trx);
  END LOOP;

  IF v_cli_id IS NOT NULL THEN
    UPDATE public."Clientes" SET "ultimaCompra" = now(), "ultimaActividad" = now() WHERE id = v_cli_id AND organization_id = c.org;
  END IF;
  PERFORM public.pos_audit(c.org, 'venta.registrar', 'pos_ventas', v_venta::text, c.usuario,
    jsonb_build_object('numero', v_numero, 'total', v_total, 'descuentoPct', v_pct, 'pagos', p -> 'pagos'));
  RETURN jsonb_build_object('ok', true, 'duplicado', false, 'ticket', public.pos_ticket_json(v_venta));
END $$;

CREATE OR REPLACE FUNCTION public.pos_devolver_venta(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c record; v record; it jsonb; li record; v_key text; v_exist uuid; v_anular boolean; v_motivo text;
  v_metodo text; v_cta uuid; v_ref text; v_reingreso boolean; v_cant numeric; v_ret_sub numeric := 0;
  v_monto numeric; v_restante numeric; v_turno text; v_dev uuid := gen_random_uuid(); v_trx uuid;
  v_tipo text; v_estado text; v_todo boolean; v_factor numeric; v_ids uuid[]; v_sel jsonb := '[]'::jsonb; v_hoy date; cfg jsonb; v_mtipo text;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  v_anular := COALESCE((p ->> 'anular')::boolean, false);
  IF NOT public.pos_puede(c.privilegiado, c.perms, CASE WHEN v_anular THEN 'anular' ELSE 'devolver' END) THEN
    RAISE EXCEPTION 'No tiene permiso para % ventas.', CASE WHEN v_anular THEN 'anular' ELSE 'registrar devoluciones de' END USING ERRCODE = '42501';
  END IF;
  cfg := public.pos_cfg(c.org);
  v_motivo := btrim(COALESCE(p ->> 'motivo', ''));
  v_mtipo := NULLIF(btrim(COALESCE(p ->> 'motivoTipo', '')), '');
  IF jsonb_array_length(cfg -> 'motivos_devolucion') > 0 THEN
    IF v_mtipo IS NULL OR NOT (cfg -> 'motivos_devolucion') ? v_mtipo THEN
      RAISE EXCEPTION 'Seleccione el motivo de la lista.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF length(v_motivo) < 5 THEN RAISE EXCEPTION 'Indique el motivo (mínimo 5 caracteres).' USING ERRCODE = '22023'; END IF;
  v_key := NULLIF(btrim(COALESCE(p ->> 'idempotency_key', '')), '');
  IF v_key IS NULL OR length(v_key) < 8 THEN RAISE EXCEPTION 'Falta la clave de idempotencia.' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('pos_dev:' || c.org || ':' || v_key));
  SELECT id INTO v_exist FROM public.pos_devoluciones WHERE organization_id = c.org AND idempotency_key = v_key;
  IF v_exist IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicado', true, 'devolucionId', v_exist,
      'ticket', public.pos_ticket_json((SELECT venta_id FROM public.pos_devoluciones WHERE id = v_exist)));
  END IF;

  SELECT * INTO v FROM public.pos_ventas WHERE id = (p ->> 'ventaId')::uuid AND organization_id = c.org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada.' USING ERRCODE = 'P0001'; END IF;
  IF (cfg ->> 'plazo_devolucion_dias')::numeric > 0 AND NOT c.privilegiado
     AND now() - v.created_at > ((cfg ->> 'plazo_devolucion_dias')::numeric * interval '1 day') THEN
    RAISE EXCEPTION 'Pasó el plazo de % días para devoluciones de la venta %. Solo un administrador puede autorizarla.', (cfg ->> 'plazo_devolucion_dias'), v.numero USING ERRCODE = '42501';
  END IF;
  IF v.estado IN ('Anulada', 'Devuelta') THEN RAISE EXCEPTION 'La venta % ya fue %.', v.numero, lower(v.estado) USING ERRCODE = 'P0001'; END IF;
  IF v_anular AND v.estado <> 'Completada' THEN
    RAISE EXCEPTION 'La venta ya tiene devoluciones parciales; registre una devolución del saldo restante.' USING ERRCODE = 'P0001';
  END IF;

  -- Líneas a devolver (anulación = todo lo pendiente)
  IF v_anular THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('itemId', i.id, 'cantidad', i.cantidad - i.cantidad_devuelta)), '[]'::jsonb) INTO v_sel
      FROM public.pos_venta_items i WHERE i.venta_id = v.id AND i.cantidad - i.cantidad_devuelta > 0;
  ELSE
    IF jsonb_typeof(p -> 'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'items') = 0 THEN
      RAISE EXCEPTION 'Seleccione al menos un artículo a devolver.' USING ERRCODE = '22023';
    END IF;
    v_sel := p -> 'items';
  END IF;

  SELECT array_agg(DISTINCT (x ->> 'itemId')::uuid ORDER BY (x ->> 'itemId')::uuid) INTO v_ids FROM jsonb_array_elements(v_sel) x;
  PERFORM 1 FROM public.pos_venta_items WHERE venta_id = v.id AND id = ANY (v_ids) ORDER BY id FOR UPDATE;
  IF v.total <= 0 THEN RAISE EXCEPTION 'Venta inválida.' USING ERRCODE = 'P0001'; END IF;
  v_factor := v.total / NULLIF(v.subtotal, 0);   -- total efectivamente cobrado por cada Q de línea (descuento e IVA incluidos)

  FOR it IN SELECT * FROM jsonb_array_elements(v_sel) LOOP
    SELECT * INTO li FROM public.pos_venta_items WHERE id = (it ->> 'itemId')::uuid AND venta_id = v.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Artículo no pertenece a la venta.' USING ERRCODE = 'P0001'; END IF;
    BEGIN v_cant := (it ->> 'cantidad')::numeric; EXCEPTION WHEN others THEN v_cant := NULL; END;
    IF v_cant IS NULL OR v_cant <= 0 OR round(v_cant, 3) <> v_cant THEN RAISE EXCEPTION 'Cantidad a devolver inválida.' USING ERRCODE = '22023'; END IF;
    IF v_cant > li.cantidad - li.cantidad_devuelta THEN
      RAISE EXCEPTION 'No puede devolver % de "%": solo quedan % por devolver.', v_cant, li.descripcion, li.cantidad - li.cantidad_devuelta USING ERRCODE = 'P0001';
    END IF;
    v_ret_sub := v_ret_sub + li.precio_unit * v_cant;
  END LOOP;

  UPDATE public.pos_venta_items i SET cantidad_devuelta = i.cantidad_devuelta + s.cant
    FROM (SELECT (x ->> 'itemId')::uuid AS id, sum((x ->> 'cantidad')::numeric) AS cant FROM jsonb_array_elements(v_sel) x GROUP BY 1) s
   WHERE i.id = s.id AND i.venta_id = v.id;

  SELECT NOT EXISTS (SELECT 1 FROM public.pos_venta_items WHERE venta_id = v.id AND cantidad_devuelta < cantidad) INTO v_todo;
  v_restante := round(v.total - v.reembolsado, 2);
  v_monto := CASE WHEN v_todo THEN v_restante ELSE round(v_ret_sub * v_factor, 2) END;
  IF v_monto <= 0 THEN RAISE EXCEPTION 'El monto a reembolsar es cero; revise la selección.' USING ERRCODE = 'P0001'; END IF;
  IF v_monto > v_restante THEN v_monto := v_restante; END IF;
  v_tipo := CASE WHEN v_anular THEN 'Anulación' WHEN v_todo THEN 'Total' ELSE 'Parcial' END;
  v_estado := CASE WHEN v_anular THEN 'Anulada' WHEN v_todo THEN 'Devuelta' ELSE 'Devuelta parcial' END;

  -- Método de reembolso
  v_metodo := COALESCE(NULLIF(p ->> 'metodoReembolso', ''), 'Efectivo');
  IF v_metodo NOT IN ('Efectivo', 'Tarjeta', 'Transferencia') THEN RAISE EXCEPTION 'Método de reembolso no soportado.' USING ERRCODE = '22023'; END IF;
  IF NOT (cfg -> 'metodos_habilitados') ? v_metodo THEN RAISE EXCEPTION 'El método % no está habilitado.', v_metodo USING ERRCODE = '22023'; END IF;
  v_ref := NULLIF(btrim(COALESCE(p ->> 'referencia', '')), '');
  IF v_metodo <> 'Efectivo' AND v_ref IS NULL THEN RAISE EXCEPTION 'Ingrese la referencia del reembolso electrónico.' USING ERRCODE = '22023'; END IF;
  v_cta := NULL;
  IF v_metodo = 'Transferencia' AND COALESCE(p ->> 'cuentaBancariaId', '') <> '' THEN
    v_cta := (p ->> 'cuentaBancariaId')::uuid;
    PERFORM 1 FROM public."CuentasBancarias" WHERE id = v_cta AND organization_id = c.org AND COALESCE(activa, true) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta bancaria inválida.' USING ERRCODE = 'P0001'; END IF;
  END IF;
  -- El efectivo sale de la caja ABIERTA actual (no de un turno ya cerrado)
  SELECT id INTO v_turno FROM public."Cajas_Turnos"
   WHERE organization_id = c.org AND estado = 'ABIERTA' AND sucursal_id IS NOT DISTINCT FROM c.sucursal
   ORDER BY fecha_apertura DESC LIMIT 1 FOR SHARE;
  IF v_metodo = 'Efectivo' AND v_turno IS NULL THEN
    RAISE EXCEPTION 'Para reembolsar en efectivo debe haber una caja abierta.' USING ERRCODE = 'P0001';
  END IF;
  IF v_metodo = 'Efectivo' AND v_monto > (public.pos_resumen_turno_int(c.org, v_turno) ->> 'esperado')::numeric THEN
    RAISE EXCEPTION 'No hay efectivo suficiente en caja para reembolsar Q %.', v_monto USING ERRCODE = 'P0001';
  END IF;

  v_reingreso := COALESCE((p ->> 'reingresarStock')::boolean, true);
  IF v_reingreso THEN
    PERFORM 1 FROM public."Inventario" WHERE organization_id = c.org AND id IN
      (SELECT i.producto_id FROM public.pos_venta_items i WHERE i.id = ANY (v_ids)) ORDER BY id FOR UPDATE;
    PERFORM public.inv_ctx_mov('Devolución', v.numero, v_motivo);
    UPDATE public."Inventario" inv SET unidades = inv.unidades + s.cant
      FROM (SELECT i.producto_id, sum((x ->> 'cantidad')::numeric) AS cant
              FROM jsonb_array_elements(v_sel) x JOIN public.pos_venta_items i ON i.id = (x ->> 'itemId')::uuid
             WHERE i.tipo <> 'Servicio' AND i.producto_id IS NOT NULL GROUP BY 1) s
     WHERE inv.id = s.producto_id AND inv.organization_id = c.org;
    PERFORM public.inv_ctx_mov(NULL, NULL, NULL);
  END IF;

  v_hoy := (now() AT TIME ZONE 'America/Guatemala')::date;
  v_trx := gen_random_uuid();
  INSERT INTO public."Transacciones"(id, fecha, tipo, concepto, monto, "cuentaBancariaId", referencia, descripcion, "creadoPor", "fechaReg",
      organization_id, sucursal_id, caja_turno_id)
  VALUES (v_trx, v_hoy, 'Egreso', CASE WHEN v_anular THEN 'Anulación POS · Ticket ' ELSE 'Devolución POS · Ticket ' END || v.numero, v_monto, v_cta,
      v.numero, v_tipo || ' de ticket ' || v.numero || ' · ' || v.cliente_nombre || ' · Reembolso: ' || v_metodo || ' · Motivo: ' || v_motivo,
      c.usuario, now(), c.org, c.sucursal, v_turno);
  IF v_cta IS NOT NULL THEN
    UPDATE public."CuentasBancarias" SET saldo = COALESCE(saldo, 0) - v_monto WHERE id = v_cta AND organization_id = c.org;
  END IF;

  INSERT INTO public.pos_devoluciones(id, organization_id, venta_id, caja_turno_id, tipo, monto, metodo_reembolso, cuenta_bancaria_id, referencia,
      motivo, motivo_tipo, reingreso_stock, usuario, usuario_id, idempotency_key, transaccion_id)
  VALUES (v_dev, c.org, v.id, v_turno, v_tipo, v_monto, v_metodo, v_cta, v_ref, v_motivo, v_mtipo, v_reingreso, c.usuario, c.uid, v_key, v_trx);
  INSERT INTO public.pos_devolucion_items(devolucion_id, venta_item_id, cantidad)
  SELECT v_dev, (x ->> 'itemId')::uuid, sum((x ->> 'cantidad')::numeric) FROM jsonb_array_elements(v_sel) x GROUP BY 1, 2;

  UPDATE public.pos_ventas SET estado = v_estado, reembolsado = reembolsado + v_monto,
         anulada_en = CASE WHEN v_anular THEN now() ELSE anulada_en END,
         anulada_por = CASE WHEN v_anular THEN c.usuario ELSE anulada_por END,
         motivo_anulacion = CASE WHEN v_anular THEN v_motivo ELSE motivo_anulacion END
   WHERE id = v.id;
  PERFORM public.pos_audit(c.org, CASE WHEN v_anular THEN 'venta.anular' ELSE 'venta.devolver' END, 'pos_ventas', v.id::text, c.usuario,
    jsonb_build_object('numero', v.numero, 'monto', v_monto, 'motivo', v_motivo, 'metodo', v_metodo, 'reingresoStock', v_reingreso));
  RETURN jsonb_build_object('ok', true, 'duplicado', false, 'devolucionId', v_dev, 'monto', v_monto, 'estado', v_estado,
                            'ticket', public.pos_ticket_json(v.id));
END $$;
