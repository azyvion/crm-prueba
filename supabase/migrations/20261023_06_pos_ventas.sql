-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Lote 4 · Rediseño del POS: ventas, pagos, devoluciones y cajas
-- con garantías transaccionales en el servidor.
--
-- Antes: la venta solo existía como una fila en "Transacciones"; el número de
-- ticket se calculaba en el navegador (localStorage), el precio/descuento los
-- dictaba el cliente, el stock, la contabilidad y el saldo bancario se escribían
-- en llamadas separadas (sin atomicidad ni idempotencia), la caja tragaba errores
-- y tenía un "modo local" simulado, y no había devoluciones.
-- Ahora: cada operación crítica es UNA función SQL (una transacción). El servidor
-- recalcula precios desde Inventario, valida permisos, descuenta stock con
-- UPDATE condicional, numera el ticket de forma atómica, registra pagos y
-- contabilidad, y es idempotente por `idempotency_key`.
--
-- Permisos POS (Usuarios.permisos → {"pos": ["descuento","editar_precio",
--   "anular","devolver","caja_mov","reimprimir"], "pos_descuento_max": 10}):
--   Admin/Gerente/Super Admin: todos. Resto: solo los listados.
--
-- Reversión: tests/rls/../20261023_06_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Tablas ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_secuencias (
  organization_id text    NOT NULL,
  anio            integer NOT NULL,
  ultimo          integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, anio)
);

CREATE TABLE IF NOT EXISTS public.pos_ventas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  text NOT NULL,
  sucursal_id      text,
  caja_turno_id    text,
  numero           text NOT NULL,
  idempotency_key  text NOT NULL,
  estado           text NOT NULL DEFAULT 'Completada'
                   CHECK (estado IN ('Completada','Devuelta parcial','Devuelta','Anulada')),
  cliente_id       uuid,
  cliente_nombre   text NOT NULL DEFAULT 'Consumidor Final (C/F)',
  nit              text NOT NULL DEFAULT 'C/F',
  direccion        text,
  lista_precio     text NOT NULL DEFAULT 'Publico',
  subtotal         numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  descuento_pct    numeric(5,2)  NOT NULL DEFAULT 0 CHECK (descuento_pct BETWEEN 0 AND 100),
  descuento        numeric(12,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  iva_pct          numeric(5,2)  NOT NULL DEFAULT 0,
  iva_modalidad    text NOT NULL DEFAULT 'incluido',
  iva_monto        numeric(12,2) NOT NULL DEFAULT 0,
  total            numeric(12,2) NOT NULL CHECK (total > 0),
  monto_recibido   numeric(12,2) NOT NULL DEFAULT 0,
  cambio           numeric(12,2) NOT NULL DEFAULT 0,
  reembolsado      numeric(12,2) NOT NULL DEFAULT 0 CHECK (reembolsado >= 0),
  cajero           text NOT NULL,
  cajero_id        uuid,
  cotizacion_id    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  anulada_en       timestamptz,
  anulada_por      text,
  motivo_anulacion text,
  CONSTRAINT pos_ventas_numero_uq UNIQUE (organization_id, numero),
  CONSTRAINT pos_ventas_idem_uq   UNIQUE (organization_id, idempotency_key),
  CONSTRAINT pos_ventas_reemb_chk CHECK (reembolsado <= total)
);
CREATE INDEX IF NOT EXISTS ix_pos_ventas_org_fecha ON public.pos_ventas (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_pos_ventas_turno     ON public.pos_ventas (organization_id, caja_turno_id);
CREATE INDEX IF NOT EXISTS ix_pos_ventas_cliente   ON public.pos_ventas (organization_id, cliente_id);

CREATE TABLE IF NOT EXISTS public.pos_venta_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id          uuid NOT NULL REFERENCES public.pos_ventas(id) ON DELETE RESTRICT,
  orden             integer NOT NULL,
  producto_id       uuid,
  descripcion       text NOT NULL,
  sku               text,
  tipo              text NOT NULL DEFAULT 'Producto',
  cantidad          numeric(12,3) NOT NULL CHECK (cantidad > 0),
  precio_unit       numeric(12,2) NOT NULL CHECK (precio_unit >= 0),
  total             numeric(12,2) NOT NULL CHECK (total >= 0),
  cantidad_devuelta numeric(12,3) NOT NULL DEFAULT 0,
  CONSTRAINT pos_items_dev_chk CHECK (cantidad_devuelta >= 0 AND cantidad_devuelta <= cantidad)
);
CREATE INDEX IF NOT EXISTS ix_pos_items_venta ON public.pos_venta_items (venta_id);

CREATE TABLE IF NOT EXISTS public.pos_venta_pagos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_id            uuid NOT NULL REFERENCES public.pos_ventas(id) ON DELETE RESTRICT,
  metodo              text NOT NULL CHECK (metodo IN ('Efectivo','Tarjeta','Transferencia')),
  monto               numeric(12,2) NOT NULL CHECK (monto > 0),   -- monto aplicado a la venta
  recibido            numeric(12,2) NOT NULL CHECK (recibido > 0), -- efectivo entregado (monto + cambio)
  referencia          text,
  cuenta_bancaria_id  uuid,
  transaccion_id      uuid
);
CREATE INDEX IF NOT EXISTS ix_pos_pagos_venta ON public.pos_venta_pagos (venta_id);

CREATE TABLE IF NOT EXISTS public.pos_devoluciones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     text NOT NULL,
  venta_id            uuid NOT NULL REFERENCES public.pos_ventas(id) ON DELETE RESTRICT,
  caja_turno_id       text,
  tipo                text NOT NULL CHECK (tipo IN ('Parcial','Total','Anulación')),
  monto               numeric(12,2) NOT NULL CHECK (monto > 0),
  metodo_reembolso    text NOT NULL CHECK (metodo_reembolso IN ('Efectivo','Tarjeta','Transferencia')),
  cuenta_bancaria_id  uuid,
  referencia          text,
  motivo              text NOT NULL,
  reingreso_stock     boolean NOT NULL DEFAULT true,
  usuario             text NOT NULL,
  usuario_id          uuid,
  idempotency_key     text,
  transaccion_id      uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_dev_idem_uq UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_pos_dev_venta ON public.pos_devoluciones (venta_id);
CREATE INDEX IF NOT EXISTS ix_pos_dev_turno ON public.pos_devoluciones (organization_id, caja_turno_id);

CREATE TABLE IF NOT EXISTS public.pos_devolucion_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  devolucion_id   uuid NOT NULL REFERENCES public.pos_devoluciones(id) ON DELETE RESTRICT,
  venta_item_id   uuid NOT NULL REFERENCES public.pos_venta_items(id) ON DELETE RESTRICT,
  cantidad        numeric(12,3) NOT NULL CHECK (cantidad > 0)
);

CREATE TABLE IF NOT EXISTS public.pos_caja_movimientos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  text NOT NULL,
  caja_turno_id    text NOT NULL,
  tipo             text NOT NULL CHECK (tipo IN ('Entrada','Salida')),
  monto            numeric(12,2) NOT NULL CHECK (monto > 0),
  motivo           text NOT NULL,
  usuario          text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_pos_mov_turno ON public.pos_caja_movimientos (organization_id, caja_turno_id);

CREATE TABLE IF NOT EXISTS public.pos_auditoria (
  id               bigserial PRIMARY KEY,
  organization_id  text NOT NULL,
  accion           text NOT NULL,
  entidad          text NOT NULL,
  entidad_id       text,
  usuario          text,
  detalle          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_pos_audit_org ON public.pos_auditoria (organization_id, created_at DESC);

-- Columnas adicionales del turno (aditivas)
ALTER TABLE public."Cajas_Turnos"
  ADD COLUMN IF NOT EXISTS entradas              numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salidas               numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS devoluciones_efectivo numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS devoluciones_otros    numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tickets               integer       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cerrado_por           text;

-- Un solo turno abierto por sucursal (solo si los datos actuales lo permiten)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."Cajas_Turnos" WHERE estado = 'ABIERTA'
                 GROUP BY organization_id, COALESCE(sucursal_id, '') HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS ux_cajas_turnos_abierta
      ON public."Cajas_Turnos" (organization_id, COALESCE(sucursal_id, '')) WHERE estado = 'ABIERTA';
  ELSE
    RAISE NOTICE 'Existen turnos ABIERTA duplicados; ux_cajas_turnos_abierta no se creó (pos_abrir_caja igualmente serializa).';
  END IF;
END $$;

-- ── 2. RLS: lectura por organización; escritura SOLO vía funciones ───────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pos_secuencias','pos_ventas','pos_venta_items','pos_venta_pagos',
                           'pos_devoluciones','pos_devolucion_items','pos_caja_movimientos','pos_auditoria']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS pos_ventas_sel    ON public.pos_ventas;
CREATE POLICY pos_ventas_sel ON public.pos_ventas FOR SELECT TO authenticated
  USING (organization_id = public.current_user_org_id());
DROP POLICY IF EXISTS pos_items_sel     ON public.pos_venta_items;
CREATE POLICY pos_items_sel ON public.pos_venta_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pos_ventas v WHERE v.id = venta_id AND v.organization_id = public.current_user_org_id()));
DROP POLICY IF EXISTS pos_pagos_sel     ON public.pos_venta_pagos;
CREATE POLICY pos_pagos_sel ON public.pos_venta_pagos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pos_ventas v WHERE v.id = venta_id AND v.organization_id = public.current_user_org_id()));
DROP POLICY IF EXISTS pos_dev_sel       ON public.pos_devoluciones;
CREATE POLICY pos_dev_sel ON public.pos_devoluciones FOR SELECT TO authenticated
  USING (organization_id = public.current_user_org_id());
DROP POLICY IF EXISTS pos_devitems_sel  ON public.pos_devolucion_items;
CREATE POLICY pos_devitems_sel ON public.pos_devolucion_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pos_devoluciones d WHERE d.id = devolucion_id AND d.organization_id = public.current_user_org_id()));
DROP POLICY IF EXISTS pos_mov_sel       ON public.pos_caja_movimientos;
CREATE POLICY pos_mov_sel ON public.pos_caja_movimientos FOR SELECT TO authenticated
  USING (organization_id = public.current_user_org_id());
DROP POLICY IF EXISTS pos_audit_sel     ON public.pos_auditoria;
CREATE POLICY pos_audit_sel ON public.pos_auditoria FOR SELECT TO authenticated
  USING (organization_id = public.current_user_org_id());
-- pos_secuencias: sin política → deny-all para clientes (solo las funciones la usan)

-- Cajas_Turnos: antes cualquier usuario de la organización podía insertar/editar/borrar
-- turnos desde el navegador (cierres incluidos). Ahora solo lectura; escribe pos_*_caja().
DROP POLICY IF EXISTS tenant_isolation ON public."Cajas_Turnos";
DROP POLICY IF EXISTS cajas_turnos_sel ON public."Cajas_Turnos";
CREATE POLICY cajas_turnos_sel ON public."Cajas_Turnos" FOR SELECT TO authenticated
  USING (organization_id = public.current_user_org_id());
REVOKE INSERT, UPDATE, DELETE ON public."Cajas_Turnos" FROM authenticated;

-- ── 3. Inmutabilidad (no se borra ni reescribe lo registrado) ────────────
CREATE OR REPLACE FUNCTION public.pos_bloquear_borrado() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Los registros del POS no se eliminan; use anulación o devolución.' USING ERRCODE = 'P0001';
END $$;

CREATE OR REPLACE FUNCTION public.pos_bloquear_modif_auditoria() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'La bitácora de auditoría POS es de solo inserción.' USING ERRCODE = 'P0001';
END $$;

CREATE OR REPLACE FUNCTION public.pos_turno_cerrado_inmutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.estado = 'CERRADA' AND COALESCE(current_setting('app.pos_reabrir', true), '') <> 'on' THEN
    RAISE EXCEPTION 'El turno % ya está cerrado; solo un administrador puede reabrirlo (queda auditado).', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los turnos de caja no se eliminan.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pos_ventas','pos_venta_items','pos_venta_pagos','pos_devoluciones','pos_devolucion_items','pos_caja_movimientos']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_pos_nodelete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_pos_nodelete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.pos_bloquear_borrado()', t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_pos_audit_ro ON public.pos_auditoria;
CREATE TRIGGER trg_pos_audit_ro BEFORE UPDATE OR DELETE ON public.pos_auditoria
  FOR EACH ROW EXECUTE FUNCTION public.pos_bloquear_modif_auditoria();
DROP TRIGGER IF EXISTS trg_pos_turno_inmutable ON public."Cajas_Turnos";
CREATE TRIGGER trg_pos_turno_inmutable BEFORE UPDATE OR DELETE ON public."Cajas_Turnos"
  FOR EACH ROW EXECUTE FUNCTION public.pos_turno_cerrado_inmutable();

-- Hallazgo: la política usuarios_update_self deja a cualquier usuario editar su propia fila y el trigger
-- trg_protect_usuarios_cols NO cubre `permisos` ni `sucursal_id`: un cajero podía darse permisos de POS
-- (descuentos, anulaciones…) o cambiarse de sucursal/caja con un PATCH directo. Solo un administrador puede.
CREATE OR REPLACE FUNCTION public.pos_proteger_permisos_usuario() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;          -- backend de confianza (service_role / SQL)
  IF NEW.permisos IS DISTINCT FROM OLD.permisos OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id THEN
    IF public.is_super_admin() THEN RETURN NEW; END IF;
    v_role := public.get_my_role(public.get_my_org_id());
    IF v_role IS DISTINCT FROM 'ADMIN' THEN
      RAISE EXCEPTION 'No autorizado: solo un administrador puede modificar permisos o sucursal de un usuario.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pos_proteger_permisos_usuario() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_protect_usuarios_permisos ON public."Usuarios";
CREATE TRIGGER trg_protect_usuarios_permisos BEFORE UPDATE ON public."Usuarios"
  FOR EACH ROW EXECUTE FUNCTION public.pos_proteger_permisos_usuario();

-- ── 4. Helpers internos (no expuestos a clientes) ────────────────────────
CREATE OR REPLACE FUNCTION public.pos_ctx()
RETURNS TABLE(org text, uid uuid, usuario text, nombre text, rol text, sucursal text, perms jsonb, privilegiado boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.organization_id::text, auth.uid(), u.usuario, u.nombre, u.rol, u.sucursal_id,
         COALESCE(u.permisos, '{}'::jsonb),
         upper(u.rol) IN ('ADMIN', 'SUPER_ADMIN', 'GERENTE')
  FROM public."Usuarios" u
  WHERE (u.auth_uid::text = auth.uid()::text OR u.id::text = auth.uid()::text)
    AND COALESCE(u.activo, true)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.pos_puede(p_priv boolean, p_perms jsonb, p_perm text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  -- COALESCE final: sin la clave "pos" la expresión es NULL y `IF NOT NULL` dejaría pasar la operación.
  SELECT COALESCE(p_priv, false)
      OR COALESCE(jsonb_typeof(p_perms -> 'pos') = 'array' AND (p_perms -> 'pos') ? p_perm, false);
$$;

CREATE OR REPLACE FUNCTION public.pos_audit(p_org text, p_accion text, p_entidad text, p_id text, p_usuario text, p_det jsonb)
RETURNS void LANGUAGE sql SET search_path = '' AS $$
  INSERT INTO public.pos_auditoria(organization_id, accion, entidad, entidad_id, usuario, detalle)
  VALUES (p_org, p_accion, p_entidad, p_id, p_usuario, COALESCE(p_det, '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.pos_ticket_json(p_venta uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'ventaId', v.id, 'numero', v.numero, 'fecha', v.created_at, 'estado', v.estado,
    'cliente', v.cliente_nombre, 'clienteId', v.cliente_id, 'nit', v.nit, 'direccion', v.direccion,
    'listaPrecio', v.lista_precio,
    'subtotal', v.subtotal, 'descuentoPct', v.descuento_pct, 'descuento', v.descuento,
    'ivaPct', v.iva_pct, 'ivaModalidad', v.iva_modalidad, 'iva', v.iva_monto,
    'total', v.total, 'montoRecibido', v.monto_recibido, 'cambio', v.cambio, 'reembolsado', v.reembolsado,
    'cajero', v.cajero, 'cajaTurnoId', v.caja_turno_id, 'sucursalId', v.sucursal_id,
    'motivoAnulacion', v.motivo_anulacion,
    'metodoPago', CASE WHEN (SELECT count(*) FROM public.pos_venta_pagos g WHERE g.venta_id = v.id) > 1 THEN 'Mixto'
                       ELSE (SELECT g.metodo FROM public.pos_venta_pagos g WHERE g.venta_id = v.id LIMIT 1) END,
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'itemId', i.id, 'id', i.producto_id, 'descripcion', i.descripcion, 'sku', i.sku, 'tipo', i.tipo,
                'cantidad', i.cantidad, 'precioUnit', i.precio_unit, 'total', i.total,
                'cantidadDevuelta', i.cantidad_devuelta) ORDER BY i.orden)
              FROM public.pos_venta_items i WHERE i.venta_id = v.id), '[]'::jsonb),
    'pagos', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'metodo', g.metodo, 'monto', g.monto, 'recibido', g.recibido,
                'referencia', g.referencia, 'cuentaBancariaId', g.cuenta_bancaria_id) ORDER BY g.metodo)
              FROM public.pos_venta_pagos g WHERE g.venta_id = v.id), '[]'::jsonb)
  )
  FROM public.pos_ventas v WHERE v.id = p_venta;
$$;

-- Resumen de un turno (ventas por método, movimientos, devoluciones, efectivo esperado)
CREATE OR REPLACE FUNCTION public.pos_resumen_turno_int(p_org text, p_caja text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t record; ve numeric; vt numeric; vtr numeric; ent numeric; sal numeric; de numeric; dot numeric;
  nt int; na int; esperado numeric;
BEGIN
  SELECT * INTO t FROM public."Cajas_Turnos" WHERE id = p_caja AND organization_id = p_org;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(g.monto) FILTER (WHERE g.metodo = 'Efectivo'), 0),
         COALESCE(sum(g.monto) FILTER (WHERE g.metodo = 'Tarjeta'), 0),
         COALESCE(sum(g.monto) FILTER (WHERE g.metodo = 'Transferencia'), 0)
    INTO ve, vt, vtr
    FROM public.pos_venta_pagos g JOIN public.pos_ventas v ON v.id = g.venta_id
   WHERE v.organization_id = p_org AND v.caja_turno_id = p_caja;
  SELECT count(*) INTO nt FROM public.pos_ventas WHERE organization_id = p_org AND caja_turno_id = p_caja;
  SELECT count(*) INTO na FROM public.pos_devoluciones WHERE organization_id = p_org AND caja_turno_id = p_caja AND tipo = 'Anulación';
  SELECT COALESCE(sum(monto) FILTER (WHERE tipo = 'Entrada'), 0), COALESCE(sum(monto) FILTER (WHERE tipo = 'Salida'), 0)
    INTO ent, sal FROM public.pos_caja_movimientos WHERE organization_id = p_org AND caja_turno_id = p_caja;
  SELECT COALESCE(sum(monto) FILTER (WHERE metodo_reembolso = 'Efectivo'), 0),
         COALESCE(sum(monto) FILTER (WHERE metodo_reembolso <> 'Efectivo'), 0)
    INTO de, dot FROM public.pos_devoluciones WHERE organization_id = p_org AND caja_turno_id = p_caja;
  esperado := round(t.monto_inicial + ve + ent - sal - de, 2);
  RETURN jsonb_build_object(
    'cajaId', t.id, 'estado', t.estado, 'cajero', t.cajero, 'sucursalId', t.sucursal_id,
    'fechaApertura', t.fecha_apertura, 'fechaCierre', t.fecha_cierre,
    'montoInicial', t.monto_inicial, 'ventasEfectivo', ve, 'ventasTarjeta', vt, 'ventasTransferencia', vtr,
    'totalVentas', ve + vt + vtr, 'tickets', nt, 'anulaciones', na,
    'entradas', ent, 'salidas', sal, 'devolucionesEfectivo', de, 'devolucionesOtros', dot,
    'esperado', esperado, 'contado', t.efectivo_contado, 'diferencia', t.diferencia,
    'observaciones', t.observaciones, 'cerradoPor', t.cerrado_por);
END $$;

-- ── 5. Caja: apertura / movimientos / cierre / reapertura ────────────────
CREATE OR REPLACE FUNCTION public.pos_estado_caja()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; t record; r jsonb;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public."Cajas_Turnos"
   WHERE organization_id = c.org AND estado = 'ABIERTA' AND sucursal_id IS NOT DISTINCT FROM c.sucursal
   ORDER BY fecha_apertura DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'cajaAbierta', false); END IF;
  r := public.pos_resumen_turno_int(c.org, t.id);
  RETURN jsonb_build_object('ok', true, 'cajaAbierta', true, 'cajaId', t.id, 'cajero', t.cajero,
    'montoInicial', t.monto_inicial, 'fecha', t.fecha_apertura, 'sucursalId', t.sucursal_id, 'resumen', r);
END $$;

CREATE OR REPLACE FUNCTION public.pos_abrir_caja(p_monto numeric, p_obs text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; v_id text;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF p_monto IS NULL OR p_monto < 0 OR p_monto > 10000000 OR round(p_monto, 2) <> p_monto THEN
    RAISE EXCEPTION 'El fondo inicial debe ser un monto válido (0 o más, hasta 2 decimales).' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('pos_caja:' || c.org || ':' || COALESCE(c.sucursal, '')));
  IF EXISTS (SELECT 1 FROM public."Cajas_Turnos"
              WHERE organization_id = c.org AND estado = 'ABIERTA' AND sucursal_id IS NOT DISTINCT FROM c.sucursal) THEN
    RAISE EXCEPTION 'Ya existe una caja abierta en esta sucursal. Ciérrela antes de abrir otra.' USING ERRCODE = 'P0001';
  END IF;
  v_id := 'CAJA-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public."Cajas_Turnos"(id, organization_id, sucursal_id, cajero, monto_inicial, fecha_apertura, estado, observaciones)
  VALUES (v_id, c.org, c.sucursal, c.usuario, p_monto, now(), 'ABIERTA', COALESCE(p_obs, ''));
  PERFORM public.pos_audit(c.org, 'caja.abrir', 'Cajas_Turnos', v_id, c.usuario, jsonb_build_object('monto', p_monto));
  RETURN jsonb_build_object('ok', true, 'cajaId', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.pos_caja_movimiento(p_tipo text, p_monto numeric, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; t record; r jsonb; v_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT public.pos_puede(c.privilegiado, c.perms, 'caja_mov') THEN
    RAISE EXCEPTION 'No tiene permiso para registrar entradas o salidas de efectivo.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo NOT IN ('Entrada', 'Salida') THEN RAISE EXCEPTION 'Tipo de movimiento inválido.' USING ERRCODE = '22023'; END IF;
  IF p_monto IS NULL OR p_monto <= 0 OR p_monto > 10000000 OR round(p_monto, 2) <> p_monto THEN
    RAISE EXCEPTION 'Monto inválido.' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Indique el motivo del movimiento.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO t FROM public."Cajas_Turnos"
   WHERE organization_id = c.org AND estado = 'ABIERTA' AND sucursal_id IS NOT DISTINCT FROM c.sucursal
   ORDER BY fecha_apertura DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No hay una caja abierta.' USING ERRCODE = 'P0001'; END IF;
  r := public.pos_resumen_turno_int(c.org, t.id);
  IF p_tipo = 'Salida' AND p_monto > (r ->> 'esperado')::numeric THEN
    RAISE EXCEPTION 'La salida (Q %) supera el efectivo disponible en caja (Q %).', p_monto, (r ->> 'esperado') USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.pos_caja_movimientos(id, organization_id, caja_turno_id, tipo, monto, motivo, usuario)
  VALUES (v_id, c.org, t.id, p_tipo, p_monto, btrim(p_motivo), c.usuario);
  PERFORM public.pos_audit(c.org, 'caja.movimiento', 'Cajas_Turnos', t.id, c.usuario,
    jsonb_build_object('tipo', p_tipo, 'monto', p_monto, 'motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true, 'movimientoId', v_id, 'resumen', public.pos_resumen_turno_int(c.org, t.id));
END $$;

CREATE OR REPLACE FUNCTION public.pos_cerrar_caja(p_caja_id text, p_contado numeric, p_obs text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; t record; r jsonb; v_esp numeric; v_dif numeric;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF p_contado IS NULL OR p_contado < 0 OR p_contado > 100000000 OR round(p_contado, 2) <> p_contado THEN
    RAISE EXCEPTION 'El efectivo contado debe ser un monto válido (0 o más, hasta 2 decimales).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public."Cajas_Turnos" WHERE id = p_caja_id AND organization_id = c.org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Turno de caja no encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF t.estado <> 'ABIERTA' THEN RAISE EXCEPTION 'El turno % ya fue cerrado.', t.id USING ERRCODE = 'P0001'; END IF;
  IF NOT (c.privilegiado OR t.cajero = c.usuario OR public.pos_puede(false, c.perms, 'caja_mov')) THEN
    RAISE EXCEPTION 'Solo quien abrió la caja o un administrador puede cerrarla.' USING ERRCODE = '42501';
  END IF;
  r := public.pos_resumen_turno_int(c.org, t.id);
  v_esp := (r ->> 'esperado')::numeric;
  v_dif := round(p_contado - v_esp, 2);
  IF v_dif <> 0 AND length(btrim(COALESCE(p_obs, ''))) < 3 THEN
    RAISE EXCEPTION 'Hay una diferencia de Q % en el cuadre: explíquela en las observaciones.', v_dif USING ERRCODE = 'P0001';
  END IF;
  UPDATE public."Cajas_Turnos" SET
    fecha_cierre = now(), estado = 'CERRADA', cerrado_por = c.usuario,
    ventas_efectivo = (r ->> 'ventasEfectivo')::numeric, ventas_tarjeta = (r ->> 'ventasTarjeta')::numeric,
    ventas_transferencia = (r ->> 'ventasTransferencia')::numeric, ventas_otros = 0,
    entradas = (r ->> 'entradas')::numeric, salidas = (r ->> 'salidas')::numeric,
    devoluciones_efectivo = (r ->> 'devolucionesEfectivo')::numeric, devoluciones_otros = (r ->> 'devolucionesOtros')::numeric,
    tickets = (r ->> 'tickets')::int, total_esperado = v_esp, efectivo_contado = p_contado, diferencia = v_dif,
    observaciones = btrim(COALESCE(p_obs, ''))
  WHERE id = t.id;
  PERFORM public.pos_audit(c.org, 'caja.cerrar', 'Cajas_Turnos', t.id, c.usuario,
    jsonb_build_object('esperado', v_esp, 'contado', p_contado, 'diferencia', v_dif));
  RETURN jsonb_build_object('ok', true) || public.pos_resumen_turno_int(c.org, t.id);
END $$;

CREATE OR REPLACE FUNCTION public.pos_reabrir_caja(p_caja_id text, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; t record;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT c.privilegiado THEN RAISE EXCEPTION 'Solo un administrador puede reabrir un cierre.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Indique el motivo de la reapertura (mínimo 5 caracteres).' USING ERRCODE = '22023'; END IF;
  SELECT * INTO t FROM public."Cajas_Turnos" WHERE id = p_caja_id AND organization_id = c.org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Turno de caja no encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF t.estado <> 'CERRADA' THEN RAISE EXCEPTION 'El turno no está cerrado.' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('pos_caja:' || c.org || ':' || COALESCE(t.sucursal_id, '')));
  IF EXISTS (SELECT 1 FROM public."Cajas_Turnos" WHERE organization_id = c.org AND estado = 'ABIERTA'
              AND sucursal_id IS NOT DISTINCT FROM t.sucursal_id) THEN
    RAISE EXCEPTION 'Hay otra caja abierta en la sucursal; ciérrela primero.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.pos_audit(c.org, 'caja.reabrir', 'Cajas_Turnos', t.id, c.usuario,
    jsonb_build_object('motivo', btrim(p_motivo), 'cierre_previo', to_jsonb(t)));
  PERFORM set_config('app.pos_reabrir', 'on', true);
  UPDATE public."Cajas_Turnos" SET estado = 'ABIERTA', fecha_cierre = NULL, cerrado_por = NULL WHERE id = t.id;
  PERFORM set_config('app.pos_reabrir', 'off', true);
  RETURN jsonb_build_object('ok', true, 'cajaId', t.id);
END $$;

-- ── 6. Venta ─────────────────────────────────────────────────────────────
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
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Solicitud inválida.' USING ERRCODE = '22023'; END IF;

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
  SELECT id INTO v_turno FROM public."Cajas_Turnos"
   WHERE organization_id = c.org AND estado = 'ABIERTA' AND sucursal_id IS NOT DISTINCT FROM v_sucursal
   ORDER BY fecha_apertura DESC LIMIT 1 FOR SHARE;   -- serializa con el cierre de caja
  IF v_turno IS NULL AND COALESCE((p ->> 'permitir_sin_caja')::boolean, false) = false THEN
    RAISE EXCEPTION 'No hay una caja abierta. Abra la caja antes de cobrar.' USING ERRCODE = 'P0001';
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
      UPDATE public."Inventario" SET unidades = unidades - v_cant WHERE id = inv.id AND unidades >= v_cant;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Existencia insuficiente para "%" (disponible: %).', inv.producto, inv.unidades USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_linea := round(v_cant * v_precio, 2);
    v_subtotal := v_subtotal + v_linea;
    v_lines := v_lines || jsonb_build_object('orden', v_orden, 'producto_id', inv.id, 'descripcion', inv.producto,
                'sku', inv.sku, 'tipo', COALESCE(inv.tipo, 'Producto'), 'cantidad', v_cant, 'precio', v_precio, 'total', v_linea);
  END LOOP;
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
    IF NOT c.privilegiado AND v_pct > COALESCE((c.perms ->> 'pos_descuento_max')::numeric, 10) THEN
      RAISE EXCEPTION 'Su descuento máximo autorizado es de % por ciento.', COALESCE((c.perms ->> 'pos_descuento_max')::numeric, 10) USING ERRCODE = '42501';
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
  IF v_noncash > v_total THEN RAISE EXCEPTION 'Los pagos electrónicos (Q %) superan el total (Q %).', v_noncash, v_total USING ERRCODE = '22023'; END IF;
  v_cash_app := round(v_total - v_noncash, 2);
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
      cajero, cajero_id, cotizacion_id)
  VALUES (v_venta, c.org, v_sucursal, v_turno, v_numero, v_key, v_cli_id, v_cli_nombre, v_nit, v_dir, v_lista, v_subtotal, v_pct, v_desc,
      v_ivapct, v_ivamod, v_iva, v_total, v_cash_recv + v_noncash, v_cambio, c.usuario, c.uid, NULLIF(p ->> 'cotizacionId', ''));

  INSERT INTO public.pos_venta_items(venta_id, orden, producto_id, descripcion, sku, tipo, cantidad, precio_unit, total)
  SELECT v_venta, (l ->> 'orden')::int, (l ->> 'producto_id')::uuid, l ->> 'descripcion', l ->> 'sku', l ->> 'tipo',
         (l ->> 'cantidad')::numeric, (l ->> 'precio')::numeric, (l ->> 'total')::numeric
    FROM jsonb_array_elements(v_lines) l;

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

-- ── 7. Devoluciones y anulaciones ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pos_devolver_venta(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c record; v record; it jsonb; li record; v_key text; v_exist uuid; v_anular boolean; v_motivo text;
  v_metodo text; v_cta uuid; v_ref text; v_reingreso boolean; v_cant numeric; v_ret_sub numeric := 0;
  v_monto numeric; v_restante numeric; v_turno text; v_dev uuid := gen_random_uuid(); v_trx uuid;
  v_tipo text; v_estado text; v_todo boolean; v_factor numeric; v_ids uuid[]; v_sel jsonb := '[]'::jsonb; v_hoy date;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  v_anular := COALESCE((p ->> 'anular')::boolean, false);
  IF NOT public.pos_puede(c.privilegiado, c.perms, CASE WHEN v_anular THEN 'anular' ELSE 'devolver' END) THEN
    RAISE EXCEPTION 'No tiene permiso para % ventas.', CASE WHEN v_anular THEN 'anular' ELSE 'registrar devoluciones de' END USING ERRCODE = '42501';
  END IF;
  v_motivo := btrim(COALESCE(p ->> 'motivo', ''));
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
    UPDATE public."Inventario" inv SET unidades = inv.unidades + s.cant
      FROM (SELECT i.producto_id, sum((x ->> 'cantidad')::numeric) AS cant
              FROM jsonb_array_elements(v_sel) x JOIN public.pos_venta_items i ON i.id = (x ->> 'itemId')::uuid
             WHERE i.tipo <> 'Servicio' AND i.producto_id IS NOT NULL GROUP BY 1) s
     WHERE inv.id = s.producto_id AND inv.organization_id = c.org;
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
      motivo, reingreso_stock, usuario, usuario_id, idempotency_key, transaccion_id)
  VALUES (v_dev, c.org, v.id, v_turno, v_tipo, v_monto, v_metodo, v_cta, v_ref, v_motivo, v_reingreso, c.usuario, c.uid, v_key, v_trx);
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

-- ── 8. Consulta / reimpresión de comprobantes ────────────────────────────
CREATE OR REPLACE FUNCTION public.pos_obtener_ticket(p_venta_id uuid DEFAULT NULL, p_key text DEFAULT NULL, p_reimpresion boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; v_id uuid;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_id FROM public.pos_ventas
   WHERE organization_id = c.org AND ((p_venta_id IS NOT NULL AND id = p_venta_id) OR (p_key IS NOT NULL AND idempotency_key = p_key));
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'encontrada', false); END IF;
  IF p_reimpresion THEN
    IF NOT public.pos_puede(c.privilegiado, c.perms, 'reimprimir') THEN
      RAISE EXCEPTION 'No tiene permiso para reimprimir comprobantes.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.pos_audit(c.org, 'venta.reimprimir', 'pos_ventas', v_id::text, c.usuario, '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object('ok', true, 'encontrada', true, 'ticket', public.pos_ticket_json(v_id));
END $$;

CREATE OR REPLACE FUNCTION public.pos_mis_permisos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; k text; r jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  FOREACH k IN ARRAY ARRAY['descuento', 'editar_precio', 'anular', 'devolver', 'caja_mov', 'reimprimir'] LOOP
    r := r || jsonb_build_object(k, public.pos_puede(c.privilegiado, c.perms, k));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'permisos', r, 'privilegiado', c.privilegiado, 'usuario', c.usuario,
    'descuentoMax', CASE WHEN c.privilegiado THEN 100 ELSE COALESCE((c.perms ->> 'pos_descuento_max')::numeric, 10) END);
END $$;

-- ── 9. Permisos de ejecución ─────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'pos_ctx()', 'pos_puede(boolean,jsonb,text)', 'pos_audit(text,text,text,text,text,jsonb)', 'pos_ticket_json(uuid)',
    'pos_resumen_turno_int(text,text)', 'pos_estado_caja()', 'pos_abrir_caja(numeric,text)',
    'pos_caja_movimiento(text,numeric,text)', 'pos_cerrar_caja(text,numeric,text)', 'pos_reabrir_caja(text,text)',
    'pos_registrar_venta(jsonb)', 'pos_devolver_venta(jsonb)', 'pos_obtener_ticket(uuid,text,boolean)', 'pos_mis_permisos()']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  -- Solo estas son la API pública del POS
  GRANT EXECUTE ON FUNCTION public.pos_estado_caja()                       TO authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_abrir_caja(numeric, text)           TO authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_caja_movimiento(text, numeric, text) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_cerrar_caja(text, numeric, text)    TO authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_reabrir_caja(text, text)            TO authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_registrar_venta(jsonb)              TO authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_devolver_venta(jsonb)               TO authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_obtener_ticket(uuid, text, boolean) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_mis_permisos()                      TO authenticated;
END $$;
