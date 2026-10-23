-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Lote 7 · Productividad: tareas y recordatorios (sobre ActividadesCRM),
-- plantillas de WhatsApp/correo, importación CSV de clientes y productos, auditoría general
-- de cambios, metas por vendedor y ventas pendientes del POS guardadas en el servidor.
-- Reglas: todo es por organización; lo sensible (auditoría, metas) solo se escribe desde
-- funciones o triggers SECURITY DEFINER; la importación es SECURITY INVOKER (aplica RLS).
-- Requiere 06–08 (pos_ctx, pos_puede). Reversión: 20261023_09_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════

-- ── Helper: ¿el usuario actual es ADMIN/GERENTE/SUPER_ADMIN de su empresa? ──
CREATE OR REPLACE FUNCTION public.crm_es_privilegiado() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT privilegiado FROM public.pos_ctx() LIMIT 1), false);
$$;
REVOKE ALL ON FUNCTION public.crm_es_privilegiado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_es_privilegiado() TO authenticated;

-- Contexto del propio usuario para funciones SECURITY INVOKER (pos_ctx/pos_puede no son
-- ejecutables por clientes). Solo devuelve datos de quien llama.
CREATE OR REPLACE FUNCTION public.crm_ctx()
RETURNS TABLE(org text, usuario text, privilegiado boolean, puede_productos boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.org, c.usuario, c.privilegiado,
         public.pos_puede(c.privilegiado, c.perms, 'compras') OR public.pos_puede(c.privilegiado, c.perms, 'inventario_ajuste')
  FROM public.pos_ctx() c LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.crm_ctx() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ctx() TO authenticated;

-- ═════════════════════ 1. TAREAS Y RECORDATORIOS ═════════════════════
-- Una tarea es una actividad con fecha de seguimiento. Las actividades existentes con
-- fecha de seguimiento pasan a verse como tareas pendientes (no se modifica ningún dato).
ALTER TABLE public."ActividadesCRM"
  ADD COLUMN IF NOT EXISTS responsable      text,
  ADD COLUMN IF NOT EXISTS hora_seguimiento time,
  ADD COLUMN IF NOT EXISTS prioridad        text NOT NULL DEFAULT 'Normal',
  ADD COLUMN IF NOT EXISTS completada       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completada_en    timestamptz,
  ADD COLUMN IF NOT EXISTS completada_por   text;
DO $$ BEGIN
  ALTER TABLE public."ActividadesCRM" ADD CONSTRAINT actividadescrm_prioridad_chk CHECK (prioridad IN ('Baja', 'Normal', 'Alta'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Tareas generales (sin cliente/prospecto): tipo = 'General' y refId NULL.
ALTER TABLE public."ActividadesCRM" ALTER COLUMN "refId" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS ix_actividades_tareas
  ON public."ActividadesCRM" (organization_id, "fechaSeguimiento") WHERE "fechaSeguimiento" IS NOT NULL AND NOT completada;

-- Lista de tareas con el nombre del cliente/prospecto. SECURITY INVOKER: las RLS de
-- ActividadesCRM, Clientes y Prospectos siguen aplicando.
CREATE OR REPLACE FUNCTION public.crm_tareas(p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL,
                                             p_solo_mias boolean DEFAULT true, p_completadas boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_user text;
BEGIN
  SELECT usuario INTO v_user FROM public.crm_ctx() LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('ok', true, 'usuario', v_user, 'hoy', (now() AT TIME ZONE 'America/Guatemala')::date,
    'filas', COALESCE((SELECT jsonb_agg(x ORDER BY (x ->> 'completada')::boolean, x ->> 'fechaSeguimiento', x ->> 'hora') FROM (
      SELECT jsonb_build_object('id', a.id, 'tipo', a.tipo, 'refId', a."refId", 'categoria', a.categoria, 'titulo', a.titulo,
             'descripcion', a.descripcion, 'fecha', a.fecha, 'fechaSeguimiento', a."fechaSeguimiento", 'hora', a.hora_seguimiento,
             'prioridad', a.prioridad, 'responsable', COALESCE(NULLIF(a.responsable, ''), a.usuario), 'usuario', a.usuario,
             'completada', a.completada, 'completada_en', a.completada_en, 'completada_por', a.completada_por,
             'refNombre', COALESCE(cl.nombre, pr.nombre)) AS x
        FROM public."ActividadesCRM" a
        LEFT JOIN public."Clientes" cl ON a.tipo = 'Cliente' AND cl.id = a."refId"
        LEFT JOIN public."Prospectos" pr ON a.tipo = 'Prospecto' AND pr.id = a."refId"
       WHERE a."fechaSeguimiento" IS NOT NULL
         AND (p_completadas OR NOT a.completada)
         AND (p_desde IS NULL OR a."fechaSeguimiento" >= p_desde)
         AND (p_hasta IS NULL OR a."fechaSeguimiento" <= p_hasta)
         AND (NOT COALESCE(p_solo_mias, true) OR COALESCE(NULLIF(a.responsable, ''), a.usuario) = v_user)
       LIMIT 1000) q), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.crm_tareas(date, date, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_tareas(date, date, boolean, boolean) TO authenticated;

-- ═════════════════════ 2. PLANTILLAS DE MENSAJES ═════════════════════
CREATE TABLE IF NOT EXISTS public.crm_plantillas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL DEFAULT public.current_user_org_id(),
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 80),
  canal text NOT NULL CHECK (canal IN ('WhatsApp', 'Correo')),
  asunto text CHECK (asunto IS NULL OR length(asunto) <= 200),
  cuerpo text NOT NULL CHECK (length(btrim(cuerpo)) BETWEEN 1 AND 4000),
  activo boolean NOT NULL DEFAULT true,
  creado_por text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_plantillas_nombre_uq UNIQUE (organization_id, canal, nombre)
);
ALTER TABLE public.crm_plantillas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_plantillas FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_plantillas TO authenticated;
DROP POLICY IF EXISTS crm_plantillas_sel ON public.crm_plantillas;
CREATE POLICY crm_plantillas_sel ON public.crm_plantillas FOR SELECT TO authenticated
  USING (organization_id = public.current_user_org_id());
DROP POLICY IF EXISTS crm_plantillas_ins ON public.crm_plantillas;
CREATE POLICY crm_plantillas_ins ON public.crm_plantillas FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id() AND public.crm_es_privilegiado());
DROP POLICY IF EXISTS crm_plantillas_upd ON public.crm_plantillas;
CREATE POLICY crm_plantillas_upd ON public.crm_plantillas FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.crm_es_privilegiado())
  WITH CHECK (organization_id = public.current_user_org_id() AND public.crm_es_privilegiado());
DROP POLICY IF EXISTS crm_plantillas_del ON public.crm_plantillas;
CREATE POLICY crm_plantillas_del ON public.crm_plantillas FOR DELETE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.crm_es_privilegiado());

-- ═════════════════════ 3. VENTAS PENDIENTES DEL POS ═════════════════════
-- No son ventas: no mueven stock ni dinero. Se guardan para retomarlas desde cualquier equipo.
CREATE TABLE IF NOT EXISTS public.pos_ventas_pendientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL DEFAULT public.current_user_org_id(),
  sucursal_id text, usuario text, nota text CHECK (nota IS NULL OR length(nota) <= 120),
  datos jsonb NOT NULL CHECK (jsonb_typeof(datos) = 'object' AND pg_column_size(datos) < 200000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_pos_pend_org ON public.pos_ventas_pendientes (organization_id, created_at DESC);
CREATE OR REPLACE FUNCTION public.trg_fn_pos_pend_autor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- El autor y la empresa los fija el servidor (no se pueden suplantar desde el navegador).
  SELECT c.usuario, c.org INTO NEW.usuario, NEW.organization_id FROM public.pos_ctx() c LIMIT 1;
  IF NEW.organization_id IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  NEW.created_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_fn_pos_pend_autor() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_pos_pend_autor ON public.pos_ventas_pendientes;
CREATE TRIGGER trg_pos_pend_autor BEFORE INSERT ON public.pos_ventas_pendientes
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_pos_pend_autor();
ALTER TABLE public.pos_ventas_pendientes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_ventas_pendientes FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.pos_ventas_pendientes TO authenticated;
DROP POLICY IF EXISTS pos_pend_sel ON public.pos_ventas_pendientes;
CREATE POLICY pos_pend_sel ON public.pos_ventas_pendientes FOR SELECT TO authenticated
  USING (organization_id = public.current_user_org_id());
DROP POLICY IF EXISTS pos_pend_ins ON public.pos_ventas_pendientes;
CREATE POLICY pos_pend_ins ON public.pos_ventas_pendientes FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id());
DROP POLICY IF EXISTS pos_pend_del ON public.pos_ventas_pendientes;
CREATE POLICY pos_pend_del ON public.pos_ventas_pendientes FOR DELETE TO authenticated
  USING (organization_id = public.current_user_org_id());

-- ═════════════════════ 4. AUDITORÍA GENERAL ═════════════════════
CREATE TABLE IF NOT EXISTS public.crm_auditoria (
  id bigserial PRIMARY KEY, organization_id text, tabla text NOT NULL, registro_id text,
  accion text NOT NULL CHECK (accion IN ('INSERT', 'UPDATE', 'DELETE')),
  usuario text, cambios jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_crm_audit_org ON public.crm_auditoria (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_crm_audit_reg ON public.crm_auditoria (organization_id, tabla, registro_id);
ALTER TABLE public.crm_auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_auditoria FROM PUBLIC, anon, authenticated;   -- solo vía crm_listar_auditoria
DROP TRIGGER IF EXISTS trg_crm_audit_ro ON public.crm_auditoria;
CREATE TRIGGER trg_crm_audit_ro BEFORE UPDATE OR DELETE ON public.crm_auditoria
  FOR EACH ROW EXECUTE FUNCTION public.pos_bloquear_modif_auditoria();

CREATE OR REPLACE FUNCTION public.trg_fn_crm_auditoria() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  -- Nunca se copian credenciales ni datos derivados que cambian solos.
  excl text[] := ARRAY['contrasena', 'passwordHash', 'passwordSalt', 'fotoFileId', 'ultimaActividad', 'ultimaCompra',
                       'valorCotizado', 'valorGanado', 'valorPerdido', 'valorPotencial', 'valorPonderado', 'fechaPerfilActualizado',
                       'comEstado', 'comEstadoTexto', 'comFechaEstado'];
  o jsonb; n jsonb; diff jsonb := '{}'::jsonb; k text; v_user text; v_org text; v_id text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN o := to_jsonb(OLD) - excl; END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN n := to_jsonb(NEW) - excl; END IF;
  -- Las existencias tienen su propio kardex (inv_movimientos): no se duplican aquí.
  IF TG_TABLE_NAME = 'Inventario' THEN o := o - 'unidades' - 'estado'; n := n - 'unidades' - 'estado'; END IF;
  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(n) LOOP
      IF (o -> k) IS DISTINCT FROM (n -> k) THEN diff := diff || jsonb_build_object(k, jsonb_build_object('antes', o -> k, 'despues', n -> k)); END IF;
    END LOOP;
    IF diff = '{}'::jsonb THEN RETURN NEW; END IF;
  ELSIF TG_OP = 'INSERT' THEN diff := n;
  ELSE diff := o;
  END IF;
  v_org := COALESCE(n ->> 'organization_id', o ->> 'organization_id');
  v_id := COALESCE(n ->> 'id', o ->> 'id');
  SELECT usuario INTO v_user FROM public.pos_ctx() LIMIT 1;
  INSERT INTO public.crm_auditoria(organization_id, tabla, registro_id, accion, usuario, cambios)
  VALUES (v_org, TG_TABLE_NAME, v_id, TG_OP, COALESCE(v_user, CASE WHEN auth.uid() IS NULL THEN 'sistema' ELSE auth.uid()::text END), diff);
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE ALL ON FUNCTION public.trg_fn_crm_auditoria() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Clientes', 'Prospectos', 'Cotizaciones', 'Inventario', 'Usuarios', 'Transacciones', 'crm_plantillas'] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_crm_auditoria ON public.%I', t);
      EXECUTE format('CREATE TRIGGER trg_crm_auditoria AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trg_fn_crm_auditoria()', t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.crm_listar_auditoria(p_desde date, p_hasta date, p_tabla text DEFAULT NULL,
                                                       p_texto text DEFAULT NULL, p_limite integer DEFAULT 300)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT c.privilegiado THEN RAISE EXCEPTION 'Solo un administrador puede ver la auditoría.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('ok', true, 'filas', COALESCE((SELECT jsonb_agg(x) FROM (
    SELECT jsonb_build_object('id', a.id, 'fecha', a.created_at, 'tabla', a.tabla, 'registro_id', a.registro_id,
                              'accion', a.accion, 'usuario', a.usuario, 'cambios', a.cambios) AS x
      FROM public.crm_auditoria a
     WHERE a.organization_id = c.org
       AND (a.created_at AT TIME ZONE 'America/Guatemala')::date BETWEEN COALESCE(p_desde, current_date - 30) AND COALESCE(p_hasta, current_date)
       AND (NULLIF(p_tabla, '') IS NULL OR a.tabla = p_tabla)
       AND (NULLIF(p_texto, '') IS NULL OR a.usuario ILIKE '%' || p_texto || '%' OR a.registro_id = p_texto OR a.cambios::text ILIKE '%' || p_texto || '%')
     ORDER BY a.id DESC LIMIT LEAST(GREATEST(COALESCE(p_limite, 300), 1), 1000)) q), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.crm_listar_auditoria(date, date, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_listar_auditoria(date, date, text, text, integer) TO authenticated;

-- ═════════════════════ 5. METAS POR VENDEDOR ═════════════════════
CREATE TABLE IF NOT EXISTS public.crm_metas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL, usuario text NOT NULL,
  periodo date NOT NULL CHECK (extract(day FROM periodo) = 1),
  meta_ventas numeric(14,2) NOT NULL DEFAULT 0 CHECK (meta_ventas >= 0),
  meta_cotizaciones numeric(14,2) NOT NULL DEFAULT 0 CHECK (meta_cotizaciones >= 0),
  meta_actividades integer NOT NULL DEFAULT 0 CHECK (meta_actividades >= 0),
  actualizado_por text, updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_metas_uq UNIQUE (organization_id, usuario, periodo)
);
ALTER TABLE public.crm_metas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_metas FROM PUBLIC, anon, authenticated;   -- solo vía funciones
DROP TRIGGER IF EXISTS trg_crm_auditoria ON public.crm_metas;
CREATE TRIGGER trg_crm_auditoria AFTER INSERT OR UPDATE OR DELETE ON public.crm_metas
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_crm_auditoria();

CREATE OR REPLACE FUNCTION public.crm_meta_guardar(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; v_per date; v_user text;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT c.privilegiado THEN RAISE EXCEPTION 'Solo un administrador o gerente puede asignar metas.' USING ERRCODE = '42501'; END IF;
  v_user := NULLIF(btrim(p ->> 'usuario'), '');
  v_per := date_trunc('month', COALESCE(NULLIF(p ->> 'periodo', '')::date, current_date))::date;
  IF v_user IS NULL OR NOT EXISTS (SELECT 1 FROM public."Usuarios" u WHERE u.organization_id = c.org AND u.usuario = v_user) THEN
    RAISE EXCEPTION 'Usuario no encontrado en su empresa.' USING ERRCODE = '22023'; END IF;
  IF COALESCE((p ->> 'meta_ventas')::numeric, 0) < 0 OR COALESCE((p ->> 'meta_cotizaciones')::numeric, 0) < 0 OR COALESCE((p ->> 'meta_actividades')::numeric, 0) < 0 THEN
    RAISE EXCEPTION 'Las metas no pueden ser negativas.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.crm_metas(organization_id, usuario, periodo, meta_ventas, meta_cotizaciones, meta_actividades, actualizado_por, updated_at)
  VALUES (c.org, v_user, v_per, round(COALESCE((p ->> 'meta_ventas')::numeric, 0), 2), round(COALESCE((p ->> 'meta_cotizaciones')::numeric, 0), 2),
          COALESCE((p ->> 'meta_actividades')::numeric, 0)::integer, c.usuario, now())
  ON CONFLICT (organization_id, usuario, periodo) DO UPDATE
    SET meta_ventas = EXCLUDED.meta_ventas, meta_cotizaciones = EXCLUDED.meta_cotizaciones,
        meta_actividades = EXCLUDED.meta_actividades, actualizado_por = EXCLUDED.actualizado_por, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'usuario', v_user, 'periodo', v_per);
END $$;
REVOKE ALL ON FUNCTION public.crm_meta_guardar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_meta_guardar(jsonb) TO authenticated;

-- Avance del mes. Ventas = ventas POS netas sin IVA (misma base que comisiones) como cajero;
-- cotizaciones = total de cotizaciones Aprobadas creadas por el usuario con fecha en el mes;
-- actividades = actividades registradas por el usuario en el mes.
-- Administradores y quienes tienen permiso «reportes» ven a todos; los demás, solo su fila.
CREATE OR REPLACE FUNCTION public.crm_metas_progreso(p_periodo date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; v_ini date; v_fin date; v_todos boolean;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  v_ini := date_trunc('month', COALESCE(p_periodo, (now() AT TIME ZONE 'America/Guatemala')::date))::date;
  v_fin := (v_ini + interval '1 month - 1 day')::date;
  v_todos := public.pos_puede(c.privilegiado, c.perms, 'reportes');
  RETURN jsonb_build_object('ok', true, 'periodo', v_ini, 'todos', v_todos, 'puedeEditar', c.privilegiado,
    'filas', COALESCE((SELECT jsonb_agg(x ORDER BY (x ->> 'ventas')::numeric DESC, x ->> 'usuario') FROM (
      SELECT jsonb_build_object('usuario', u.usuario, 'nombre', u.nombre, 'rol', u.rol,
             'meta_ventas', COALESCE(m.meta_ventas, 0), 'meta_cotizaciones', COALESCE(m.meta_cotizaciones, 0), 'meta_actividades', COALESCE(m.meta_actividades, 0),
             'ventas', COALESCE(vs.base, 0), 'tickets', COALESCE(vs.tickets, 0),
             'cotizaciones', COALESCE(cs.monto, 0), 'cotizaciones_n', COALESCE(cs.n, 0),
             'actividades', COALESCE(acs.n, 0)) AS x
        FROM public."Usuarios" u
        LEFT JOIN public.crm_metas m ON m.organization_id = c.org AND m.usuario = u.usuario AND m.periodo = v_ini
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE v.estado <> 'Anulada') AS tickets,
                 round(sum((v.total - v.reembolsado) - CASE WHEN v.total > 0 THEN v.iva_monto * (v.total - v.reembolsado) / v.total ELSE 0 END), 2) AS base
            FROM public.pos_ventas v
           WHERE v.organization_id = c.org AND v.cajero = u.usuario
             AND (v.created_at AT TIME ZONE 'America/Guatemala')::date BETWEEN v_ini AND v_fin) vs ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS n, round(sum(q.total), 2) AS monto FROM public."Cotizaciones" q
           WHERE q.organization_id = c.org AND q."creadoPor" = u.usuario AND q.estado = 'Aprobada' AND q.fecha BETWEEN v_ini AND v_fin) cs ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS n FROM public."ActividadesCRM" a
           WHERE a.organization_id = c.org AND a.usuario = u.usuario AND a.fecha BETWEEN v_ini AND v_fin) acs ON true
       WHERE u.organization_id = c.org AND COALESCE(u.activo, true)
         AND (v_todos OR u.usuario = c.usuario)) q), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.crm_metas_progreso(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_metas_progreso(date) TO authenticated;

-- ═════════════════════ 6. IMPORTACIÓN CSV ═════════════════════
-- SECURITY INVOKER: se inserta con los permisos del usuario (RLS tenant_isolation aplica).
-- p_simular = true valida y cuenta sin escribir nada (vista previa).
-- Clave de coincidencia: NIT (distinto de CF), si no correo, si no nombre exacto.
CREATE OR REPLACE FUNCTION public.crm_importar_clientes(p_filas jsonb, p_actualizar boolean DEFAULT false, p_simular boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c record; r jsonb; i integer := 0; v_id uuid; v_nombre text; v_nit text; v_correo text;
  ins integer := 0; upd integer := 0; omit integer := 0; errs jsonb := '[]'::jsonb; nerr integer := 0;
  vistos text[] := ARRAY[]::text[]; v_key text;
BEGIN
  SELECT * INTO c FROM public.crm_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT c.privilegiado THEN RAISE EXCEPTION 'Solo un administrador o gerente puede importar clientes.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 THEN RAISE EXCEPTION 'El archivo no tiene filas.' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(p_filas) > 5000 THEN RAISE EXCEPTION 'Máximo 5000 filas por importación.' USING ERRCODE = '22023'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_filas) LOOP
    i := i + 1;
    v_nombre := NULLIF(btrim(r ->> 'nombre'), '');
    v_nit := upper(regexp_replace(COALESCE(r ->> 'nit', ''), '[\s-]', '', 'g'));
    IF v_nit IN ('', 'CF', 'C/F') THEN v_nit := NULL; END IF;
    v_correo := lower(NULLIF(btrim(r ->> 'correo'), ''));
    IF v_nombre IS NULL THEN
      nerr := nerr + 1; IF nerr <= 200 THEN errs := errs || jsonb_build_object('fila', i, 'error', 'Falta el nombre.'); END IF; CONTINUE;
    END IF;
    IF length(v_nombre) > 200 THEN
      nerr := nerr + 1; IF nerr <= 200 THEN errs := errs || jsonb_build_object('fila', i, 'error', 'Nombre demasiado largo.'); END IF; CONTINUE;
    END IF;
    IF v_correo IS NOT NULL AND v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      nerr := nerr + 1; IF nerr <= 200 THEN errs := errs || jsonb_build_object('fila', i, 'error', 'Correo inválido: ' || v_correo); END IF; CONTINUE;
    END IF;
    IF NULLIF(r ->> 'fecha_nacimiento', '') IS NOT NULL AND (r ->> 'fecha_nacimiento') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      nerr := nerr + 1; IF nerr <= 200 THEN errs := errs || jsonb_build_object('fila', i, 'error', 'Fecha de nacimiento inválida (use AAAA-MM-DD).'); END IF; CONTINUE;
    END IF;
    v_key := COALESCE('n:' || v_nit, 'c:' || v_correo, 'x:' || lower(v_nombre));
    IF v_key = ANY (vistos) THEN
      nerr := nerr + 1; IF nerr <= 200 THEN errs := errs || jsonb_build_object('fila', i, 'error', 'Duplicado dentro del archivo.'); END IF; CONTINUE;
    END IF;
    vistos := vistos || v_key;
    SELECT cl.id INTO v_id FROM public."Clientes" cl
     WHERE cl.organization_id = c.org AND cl."deletedAt" IS NULL
       AND CASE WHEN v_nit IS NOT NULL THEN upper(regexp_replace(cl.nit, '[\s-]', '', 'g')) = v_nit
                WHEN v_correo IS NOT NULL THEN lower(cl.correo) = v_correo
                ELSE lower(btrim(cl.nombre)) = lower(v_nombre) END
     LIMIT 1;
    IF v_id IS NULL THEN
      ins := ins + 1;
      IF NOT p_simular THEN
        INSERT INTO public."Clientes"(id, nombre, empresa, correo, telefono, direccion, nit, "razonSocial", ciudad, segmento, "tipoCliente", fuente, fecha_nacimiento, organization_id, "creadoPor", "fechaReg")
        VALUES (gen_random_uuid(), v_nombre, COALESCE(btrim(r ->> 'empresa'), ''), COALESCE(v_correo, ''), COALESCE(btrim(r ->> 'telefono'), ''),
                COALESCE(btrim(r ->> 'direccion'), ''), COALESCE(v_nit, ''), COALESCE(NULLIF(btrim(r ->> 'razonSocial'), ''), ''),
                COALESCE(btrim(r ->> 'ciudad'), ''), COALESCE(NULLIF(btrim(r ->> 'segmento'), ''), 'Estándar'),
                COALESCE(NULLIF(btrim(r ->> 'tipoCliente'), ''), 'Empresa'), COALESCE(NULLIF(btrim(r ->> 'fuente'), ''), 'Importación'),
                NULLIF(r ->> 'fecha_nacimiento', '')::date, c.org, c.usuario, now());
      END IF;
    ELSIF p_actualizar THEN
      upd := upd + 1;
      IF NOT p_simular THEN
        -- Solo se completan/actualizan los campos que vienen con valor en el archivo.
        UPDATE public."Clientes" cl SET
          nombre = v_nombre,
          empresa = COALESCE(NULLIF(btrim(r ->> 'empresa'), ''), cl.empresa),
          correo = COALESCE(v_correo, cl.correo),
          telefono = COALESCE(NULLIF(btrim(r ->> 'telefono'), ''), cl.telefono),
          direccion = COALESCE(NULLIF(btrim(r ->> 'direccion'), ''), cl.direccion),
          nit = COALESCE(v_nit, cl.nit),
          "razonSocial" = COALESCE(NULLIF(btrim(r ->> 'razonSocial'), ''), cl."razonSocial"),
          ciudad = COALESCE(NULLIF(btrim(r ->> 'ciudad'), ''), cl.ciudad),
          segmento = COALESCE(NULLIF(btrim(r ->> 'segmento'), ''), cl.segmento),
          fecha_nacimiento = COALESCE(NULLIF(r ->> 'fecha_nacimiento', '')::date, cl.fecha_nacimiento)
        WHERE cl.id = v_id;
      END IF;
    ELSE
      omit := omit + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'simulado', p_simular, 'filas', i, 'nuevos', ins, 'actualizados', upd,
                            'omitidos', omit, 'errores', nerr, 'detalleErrores', errs);
END $$;
REVOKE ALL ON FUNCTION public.crm_importar_clientes(jsonb, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_importar_clientes(jsonb, boolean, boolean) TO authenticated;

-- Productos. Clave: SKU, si no código de barras, si no nombre exacto.
-- Las existencias SOLO se cargan al crear el producto (queda en el kardex como «Importación»);
-- al actualizar no se tocan: para eso están Compras, Ajustes y Conteo físico.
CREATE OR REPLACE FUNCTION public.crm_importar_productos(p_filas jsonb, p_actualizar boolean DEFAULT false, p_simular boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c record; r jsonb; i integer := 0; v_id uuid; v_prod text; v_sku text; v_cb text; v_tipo text;
  v_precio numeric; v_costo numeric; v_stock numeric; v_min numeric;
  ins integer := 0; upd integer := 0; omit integer := 0; errs jsonb := '[]'::jsonb; nerr integer := 0;
  vistos text[] := ARRAY[]::text[]; v_key text; v_msg text;
BEGIN
  SELECT * INTO c FROM public.crm_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE(c.puede_productos, false) THEN
    RAISE EXCEPTION 'No tiene permiso para importar productos.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 THEN RAISE EXCEPTION 'El archivo no tiene filas.' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(p_filas) > 5000 THEN RAISE EXCEPTION 'Máximo 5000 filas por importación.' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.inv_tipo', 'Importación', true), set_config('app.inv_ref', 'CSV', true), set_config('app.inv_motivo', '', true);
  FOR r IN SELECT value FROM jsonb_array_elements(p_filas) LOOP
    i := i + 1; v_msg := NULL;
    v_prod := NULLIF(btrim(r ->> 'producto'), '');
    v_sku := NULLIF(btrim(r ->> 'sku'), '');
    v_cb := NULLIF(btrim(r ->> 'codigo_barras'), '');
    v_tipo := COALESCE(NULLIF(btrim(r ->> 'tipo'), ''), 'Producto');
    BEGIN
      v_precio := COALESCE(NULLIF(replace(r ->> 'precioUnit', ',', ''), '')::numeric, 0);
      v_costo := COALESCE(NULLIF(replace(r ->> 'costo_unit', ',', ''), '')::numeric, 0);
      v_stock := COALESCE(NULLIF(replace(r ->> 'unidades', ',', ''), '')::numeric, 0);
      v_min := COALESCE(NULLIF(replace(r ->> 'stock_minimo', ',', ''), '')::numeric, 0);
    EXCEPTION WHEN invalid_text_representation THEN v_msg := 'Número inválido en precio, costo, existencias o mínimo.';
    END;
    IF v_msg IS NULL AND v_prod IS NULL THEN v_msg := 'Falta el nombre del producto.'; END IF;
    IF v_msg IS NULL AND v_tipo NOT IN ('Producto', 'Servicio') THEN v_msg := 'Tipo debe ser Producto o Servicio.'; END IF;
    IF v_msg IS NULL AND (v_precio < 0 OR v_costo < 0 OR v_stock < 0 OR v_min < 0) THEN v_msg := 'No se permiten valores negativos.'; END IF;
    IF v_msg IS NULL THEN
      v_key := COALESCE('s:' || lower(v_sku), 'b:' || lower(v_cb), 'p:' || lower(v_prod));
      IF v_key = ANY (vistos) THEN v_msg := 'Duplicado dentro del archivo.'; END IF;
    END IF;
    IF v_msg IS NOT NULL THEN
      nerr := nerr + 1; IF nerr <= 200 THEN errs := errs || jsonb_build_object('fila', i, 'error', v_msg); END IF; CONTINUE;
    END IF;
    vistos := vistos || v_key;
    SELECT p.id INTO v_id FROM public."Inventario" p
     WHERE p.organization_id = c.org
       AND CASE WHEN v_sku IS NOT NULL THEN lower(p.sku) = lower(v_sku)
                WHEN v_cb IS NOT NULL THEN lower(p.codigo_barras) = lower(v_cb)
                ELSE lower(btrim(p.producto)) = lower(v_prod) END
     LIMIT 1;
    -- Un código de barras no puede pertenecer a otro producto (índice único por empresa).
    IF v_cb IS NOT NULL AND EXISTS (SELECT 1 FROM public."Inventario" p WHERE p.organization_id = c.org
                                     AND lower(p.codigo_barras) = lower(v_cb) AND p.id IS DISTINCT FROM v_id) THEN
      nerr := nerr + 1; IF nerr <= 200 THEN errs := errs || jsonb_build_object('fila', i, 'error', 'El código de barras ' || v_cb || ' ya pertenece a otro producto.'); END IF; CONTINUE;
    END IF;
    IF v_id IS NULL THEN
      ins := ins + 1;
      IF NOT p_simular THEN
        INSERT INTO public."Inventario"(id, producto, sku, codigo_barras, categoria, descripcion, unidad, tipo, "precioUnit", costo_unit,
                                        unidades, stock_minimo, activo, organization_id, "fechaReg")
        VALUES (gen_random_uuid(), v_prod, COALESCE(v_sku, ''), v_cb, COALESCE(NULLIF(btrim(r ->> 'categoria'), ''), 'Otro'),
                COALESCE(btrim(r ->> 'descripcion'), ''), COALESCE(NULLIF(btrim(r ->> 'unidad'), ''), 'Unidad'), v_tipo,
                round(v_precio, 2), round(v_costo, 4), CASE WHEN v_tipo = 'Servicio' THEN 0 ELSE v_stock END, v_min, true, c.org, now());
      END IF;
    ELSIF p_actualizar THEN
      upd := upd + 1;
      IF NOT p_simular THEN
        UPDATE public."Inventario" p SET
          producto = v_prod,
          codigo_barras = COALESCE(v_cb, p.codigo_barras),
          categoria = COALESCE(NULLIF(btrim(r ->> 'categoria'), ''), p.categoria),
          descripcion = COALESCE(NULLIF(btrim(r ->> 'descripcion'), ''), p.descripcion),
          unidad = COALESCE(NULLIF(btrim(r ->> 'unidad'), ''), p.unidad),
          "precioUnit" = CASE WHEN NULLIF(r ->> 'precioUnit', '') IS NULL THEN p."precioUnit" ELSE round(v_precio, 2) END,
          costo_unit = CASE WHEN NULLIF(r ->> 'costo_unit', '') IS NULL THEN p.costo_unit ELSE round(v_costo, 4) END,
          stock_minimo = CASE WHEN NULLIF(r ->> 'stock_minimo', '') IS NULL THEN p.stock_minimo ELSE v_min END
        WHERE p.id = v_id;
      END IF;
    ELSE
      omit := omit + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'simulado', p_simular, 'filas', i, 'nuevos', ins, 'actualizados', upd,
                            'omitidos', omit, 'errores', nerr, 'detalleErrores', errs,
                            'nota', 'Al actualizar productos existentes no se modifican las existencias (use Compras, Ajustes o Conteo).');
END $$;
REVOKE ALL ON FUNCTION public.crm_importar_productos(jsonb, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_importar_productos(jsonb, boolean, boolean) TO authenticated;
