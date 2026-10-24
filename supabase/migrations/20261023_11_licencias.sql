-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Lote 9 · Licencias.
-- Cada empresa necesita una licencia vigente (estado ASIGNADA y sin vencer) para usar el CRM.
-- La regla se aplica en el SERVIDOR: las funciones que resuelven la empresa del usuario
-- (current_user_org_id, get_my_org_id, pos_ctx) devuelven vacío si la licencia no está
-- vigente, y todas las políticas RLS que dependen de ellas niegan el acceso. Así ningún
-- cambio en el navegador puede saltarse la licencia. Las empresas INTERNAL (Azyvion) están exentas.
-- La licencia limita los usuarios ACTIVOS de la empresa (trigger en Usuarios).
-- Las empresas existentes reciben una licencia indefinida (decisión del propietario).
-- Reversión: 20261023_11_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════

-- ═════════════════════ 1. TABLA ═════════════════════
CREATE TABLE IF NOT EXISTS public.licencias (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave           text NOT NULL UNIQUE CHECK (clave ~ '^AZV-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$'),
  plan_id         text REFERENCES public.sub_planes(id),
  max_usuarios    integer NOT NULL DEFAULT 5 CHECK (max_usuarios BETWEEN 1 AND 100000),
  vence_en        date,
  estado          text NOT NULL DEFAULT 'DISPONIBLE' CHECK (estado IN ('DISPONIBLE', 'ASIGNADA', 'REVOCADA', 'REEMPLAZADA')),
  organization_id text REFERENCES public.sub_empresas(id) ON DELETE SET NULL,
  notas           text NOT NULL DEFAULT '' CHECK (char_length(notas) <= 500),
  creada_en       timestamptz NOT NULL DEFAULT now(),
  creada_por      text,
  asignada_en     timestamptz,
  actualizada_en  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT licencias_asignada_org_chk CHECK (estado <> 'ASIGNADA' OR organization_id IS NOT NULL),
  CONSTRAINT licencias_disponible_libre_chk CHECK (estado <> 'DISPONIBLE' OR organization_id IS NULL)
);
-- Una sola licencia en uso por empresa
CREATE UNIQUE INDEX IF NOT EXISTS ux_licencias_org_asignada ON public.licencias (organization_id) WHERE estado = 'ASIGNADA';

ALTER TABLE public.licencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.licencias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.licencias TO authenticated;          -- filtrado por la política (solo súper admin)
DROP POLICY IF EXISTS licencias_superadmin_select ON public.licencias;
CREATE POLICY licencias_superadmin_select ON public.licencias FOR SELECT TO authenticated USING (public.is_super_admin());
-- Las escrituras solo ocurren en las funciones de abajo (SECURITY DEFINER) o con la service role (registro).

-- ═════════════════════ 2. REGLA DE VIGENCIA ═════════════════════
CREATE OR REPLACE FUNCTION public.licencia_hoy() RETURNS date
LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT (now() AT TIME ZONE 'America/Guatemala')::date $$;

CREATE OR REPLACE FUNCTION public.licencia_org_vigente(p_org text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_org IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.sub_empresas s WHERE s.id = p_org AND s.estado = 'INTERNAL')
    OR EXISTS (SELECT 1 FROM public.licencias l
               WHERE l.organization_id = p_org AND l.estado = 'ASIGNADA'
                 AND (l.vence_en IS NULL OR l.vence_en >= public.licencia_hoy())));
$$;
REVOKE ALL ON FUNCTION public.licencia_org_vigente(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.licencia_org_vigente(text) TO authenticated, service_role;

-- Datos de contacto de ventas (única fuente en el servidor)
CREATE OR REPLACE FUNCTION public.licencia_contacto() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('telefono', '+502 5145 5610', 'correo', 'ventas@azyvion.com');
$$;

-- ═════════════════════ 3. BLOQUEO EN LAS FUNCIONES DE EMPRESA ═════════════════════
-- Mismo resultado que antes cuando la licencia está vigente; NULL / sin filas si no.
CREATE OR REPLACE FUNCTION public.current_user_org_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT x.org FROM (
    SELECT u.organization_id::text AS org
    FROM public."Usuarios" AS u
    WHERE u.auth_uid::text = auth.uid()::text OR u.id::text = auth.uid()::text
    LIMIT 1
  ) x WHERE public.licencia_org_vigente(x.org);
$$;

CREATE OR REPLACE FUNCTION public.get_my_org_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT x.org FROM (
    SELECT ur.organization_id AS org
    FROM public.user_roles AS ur
    WHERE ur.user_id = auth.uid() AND ur.organization_id IS NOT NULL
    LIMIT 1
  ) x WHERE public.licencia_org_vigente(x.org);
$$;

CREATE OR REPLACE FUNCTION public.pos_ctx()
RETURNS TABLE(org text, uid uuid, usuario text, nombre text, rol text, sucursal text, perms jsonb, privilegiado boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT x.org, x.uid, x.usuario, x.nombre, x.rol, x.sucursal, x.perms, x.privilegiado FROM (
    SELECT u.organization_id::text AS org, auth.uid() AS uid, u.usuario, u.nombre, u.rol, u.sucursal_id AS sucursal,
           COALESCE(u.permisos, '{}'::jsonb) AS perms,
           upper(u.rol) IN ('ADMIN', 'SUPER_ADMIN', 'GERENTE') AS privilegiado
    FROM public."Usuarios" u
    WHERE (u.auth_uid::text = auth.uid()::text OR u.id::text = auth.uid()::text)
      AND COALESCE(u.activo, true)
    LIMIT 1
  ) x WHERE public.licencia_org_vigente(x.org);
$$;

-- Políticas que consultaban Usuarios directamente: ahora usan current_user_org_id() (con licencia)
DROP POLICY IF EXISTS org_isolation_categorias_inventario ON public."CategoriasInventario";
CREATE POLICY org_isolation_categorias_inventario ON public."CategoriasInventario" FOR ALL
  USING (organization_id = public.current_user_org_id()) WITH CHECK (organization_id = public.current_user_org_id());
DROP POLICY IF EXISTS empleados_select_org ON public.empleados;
CREATE POLICY empleados_select_org ON public.empleados FOR SELECT USING (organization_id = public.current_user_org_id());
DROP POLICY IF EXISTS empleados_insert_org ON public.empleados;
CREATE POLICY empleados_insert_org ON public.empleados FOR INSERT WITH CHECK (organization_id = public.current_user_org_id());
DROP POLICY IF EXISTS empleados_update_org ON public.empleados;
CREATE POLICY empleados_update_org ON public.empleados FOR UPDATE
  USING (organization_id = public.current_user_org_id()) WITH CHECK (organization_id = public.current_user_org_id());
DROP POLICY IF EXISTS empleados_delete_org ON public.empleados;
CREATE POLICY empleados_delete_org ON public.empleados FOR DELETE USING (organization_id = public.current_user_org_id());

-- ═════════════════════ 4. LÍMITE DE USUARIOS ═════════════════════
CREATE OR REPLACE FUNCTION public.trg_fn_usuarios_licencia() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_max integer; v_n integer;
BEGIN
  IF NOT COALESCE(NEW.activo, true) OR NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  -- Solo cuenta cuando aparece un usuario activo nuevo en la empresa
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.activo, true) AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.sub_empresas s WHERE s.id = NEW.organization_id::text AND s.estado = 'INTERNAL') THEN RETURN NEW; END IF;

  -- Bloquea la licencia: dos altas simultáneas no pueden pasarse del límite
  SELECT l.max_usuarios INTO v_max FROM public.licencias l
  WHERE l.organization_id = NEW.organization_id::text AND l.estado = 'ASIGNADA'
    AND (l.vence_en IS NULL OR l.vence_en >= public.licencia_hoy())
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La empresa no tiene una licencia vigente. Contacte a ventas: % · %',
      public.licencia_contacto() ->> 'telefono', public.licencia_contacto() ->> 'correo' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public."Usuarios" u
  WHERE u.organization_id = NEW.organization_id AND COALESCE(u.activo, true) AND u.id IS DISTINCT FROM NEW.id;
  IF v_n >= v_max THEN
    RAISE EXCEPTION 'Su licencia permite % usuario(s) activo(s) y ya están en uso. Desactive uno o amplíe la licencia con ventas: % · %',
      v_max, public.licencia_contacto() ->> 'telefono', public.licencia_contacto() ->> 'correo' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_usuarios_licencia ON public."Usuarios";
CREATE TRIGGER trg_usuarios_licencia BEFORE INSERT OR UPDATE OF activo, organization_id ON public."Usuarios"
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_usuarios_licencia();

-- ═════════════════════ 5. FUNCIONES ═════════════════════
-- Normaliza lo que escribe el usuario: mayúsculas, sin espacios, guiones en su lugar
CREATE OR REPLACE FUNCTION public.licencia_normalizar(p_clave text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN length(c) = 15 AND left(c, 3) = 'AZV'
              THEN 'AZV-' || substr(c, 4, 4) || '-' || substr(c, 8, 4) || '-' || substr(c, 12, 4)
              ELSE NULL END
  FROM (SELECT regexp_replace(upper(COALESCE(p_clave, '')), '[^0-9A-Z]', '', 'g') AS c) t;
$$;

-- Empresa y rol del usuario actual SIN el filtro de licencia (para poder informar y renovar)
CREATE OR REPLACE FUNCTION public.licencia_mi_org(OUT org text, OUT rol text, OUT usuario text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.organization_id::text, upper(COALESCE(u.rol, '')), u.usuario
  FROM public."Usuarios" u
  WHERE (u.auth_uid::text = auth.uid()::text OR u.id::text = auth.uid()::text) AND COALESCE(u.activo, true)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.licencia_mi_org() FROM PUBLIC, anon, authenticated;

-- Estado de la licencia de mi empresa (lo usa el panel para bloquear o avisar)
CREATE OR REPLACE FUNCTION public.mi_licencia() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m record; l public.licencias; v_interna boolean; v_activos integer; v_plan text;
BEGIN
  SELECT * INTO m FROM public.licencia_mi_org();
  IF m.org IS NULL THEN
    IF public.is_super_admin() THEN RETURN jsonb_build_object('ok', true, 'vigente', true, 'interna', true); END IF;
    RETURN jsonb_build_object('ok', true, 'vigente', false, 'motivo', 'SIN_EMPRESA', 'contacto', public.licencia_contacto());
  END IF;
  SELECT s.estado = 'INTERNAL' INTO v_interna FROM public.sub_empresas s WHERE s.id = m.org;
  IF COALESCE(v_interna, false) THEN RETURN jsonb_build_object('ok', true, 'vigente', true, 'interna', true); END IF;

  SELECT * INTO l FROM public.licencias WHERE organization_id = m.org AND estado = 'ASIGNADA';
  SELECT count(*) INTO v_activos FROM public."Usuarios" WHERE organization_id::text = m.org AND COALESCE(activo, true);
  SELECT p.nombre INTO v_plan FROM public.sub_planes p WHERE p.id = l.plan_id;
  RETURN jsonb_build_object(
    'ok', true,
    'vigente', l.id IS NOT NULL AND (l.vence_en IS NULL OR l.vence_en >= public.licencia_hoy()),
    'motivo', CASE WHEN l.id IS NULL THEN 'SIN_LICENCIA' WHEN l.vence_en < public.licencia_hoy() THEN 'VENCIDA' END,
    'plan', v_plan, 'vence_en', l.vence_en,
    'dias_restantes', CASE WHEN l.vence_en IS NOT NULL THEN l.vence_en - public.licencia_hoy() END,
    'max_usuarios', l.max_usuarios, 'usuarios_activos', v_activos,
    'clave', CASE WHEN l.id IS NOT NULL THEN 'AZV-••••-••••-' || right(l.clave, 4) END,
    'puede_activar', m.rol IN ('ADMIN', 'SUPER_ADMIN', 'GERENTE'),
    'contacto', public.licencia_contacto());
END $$;
REVOKE ALL ON FUNCTION public.mi_licencia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_licencia() TO authenticated;

-- Activar una licencia nueva en mi empresa (renovación). Solo administradores.
CREATE OR REPLACE FUNCTION public.licencia_activar(p_clave text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m record; v_clave text := public.licencia_normalizar(p_clave); v_id uuid;
BEGIN
  SELECT * INTO m FROM public.licencia_mi_org();
  IF m.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF m.rol NOT IN ('ADMIN', 'SUPER_ADMIN', 'GERENTE') THEN
    RAISE EXCEPTION 'Solo un administrador puede activar la licencia.' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_id FROM public.licencias
  WHERE clave = v_clave AND estado = 'DISPONIBLE' AND (vence_en IS NULL OR vence_en >= public.licencia_hoy())
  FOR UPDATE;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'La licencia no es válida, ya fue usada o está vencida.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.licencias SET estado = 'REEMPLAZADA', actualizada_en = now() WHERE organization_id = m.org AND estado = 'ASIGNADA';
  UPDATE public.licencias SET estado = 'ASIGNADA', organization_id = m.org, asignada_en = now(), actualizada_en = now(),
         notas = btrim(notas || ' Activada por ' || COALESCE(m.usuario, '?') || '.')
  WHERE id = v_id;
  UPDATE public.sub_empresas s SET estado = 'ACTIVE', plan_id = COALESCE(l.plan_id, s.plan_id), fecha_actualizado = now()
  FROM public.licencias l WHERE l.id = v_id AND s.id = m.org AND s.estado <> 'INTERNAL';
  RETURN public.mi_licencia();
END $$;
REVOKE ALL ON FUNCTION public.licencia_activar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.licencia_activar(text) TO authenticated;

-- ── Súper admin: generar, editar, revocar, restaurar y asignar ──
CREATE OR REPLACE FUNCTION public.licencia_nueva_clave() RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE abc constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; b bytea; s text; i int;
BEGIN
  LOOP
    b := extensions.gen_random_bytes(12); s := '';
    FOR i IN 0..11 LOOP s := s || substr(abc, (get_byte(b, i) % 31) + 1, 1); END LOOP;
    s := 'AZV-' || substr(s, 1, 4) || '-' || substr(s, 5, 4) || '-' || substr(s, 9, 4);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.licencias WHERE clave = s);
  END LOOP;
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public.licencia_nueva_clave() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.licencia_admin(p_accion text, p_datos jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user text; l public.licencias; v_n int; v_claves jsonb := '[]'::jsonb; i int;
        v_plan text; v_max int; v_vence date; v_org text; v_max_plan int;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Solo el súper administrador gestiona licencias.' USING ERRCODE = '42501'; END IF;
  SELECT usuario INTO v_user FROM public.licencia_mi_org();
  v_plan  := NULLIF(p_datos ->> 'plan_id', '');
  v_vence := NULLIF(p_datos ->> 'vence_en', '')::date;
  IF v_plan IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sub_planes WHERE id = v_plan) THEN
    RAISE EXCEPTION 'Plan inexistente.' USING ERRCODE = '22023';
  END IF;
  SELECT max_usuarios INTO v_max_plan FROM public.sub_planes WHERE id = v_plan;
  v_max := COALESCE(NULLIF(p_datos ->> 'max_usuarios', '')::int, v_max_plan, 5);

  IF p_accion = 'generar' THEN
    v_n := COALESCE(NULLIF(p_datos ->> 'cantidad', '')::int, 1);
    IF v_n NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Cantidad entre 1 y 50.' USING ERRCODE = '22023'; END IF;
    IF v_vence IS NOT NULL AND v_vence < public.licencia_hoy() THEN RAISE EXCEPTION 'La fecha de vencimiento ya pasó.' USING ERRCODE = '22023'; END IF;
    FOR i IN 1..v_n LOOP
      INSERT INTO public.licencias(clave, plan_id, max_usuarios, vence_en, notas, creada_por)
      VALUES (public.licencia_nueva_clave(), v_plan, v_max, v_vence, COALESCE(p_datos ->> 'notas', ''), v_user)
      RETURNING * INTO l;
      v_claves := v_claves || to_jsonb(l.clave);
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'claves', v_claves);
  END IF;

  SELECT * INTO l FROM public.licencias WHERE id = (p_datos ->> 'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Licencia no encontrada.' USING ERRCODE = 'P0002'; END IF;

  IF p_accion = 'editar' THEN
    UPDATE public.licencias SET
      plan_id = CASE WHEN p_datos ? 'plan_id' THEN v_plan ELSE plan_id END,
      max_usuarios = CASE WHEN p_datos ? 'max_usuarios' THEN v_max ELSE max_usuarios END,
      vence_en = CASE WHEN p_datos ? 'vence_en' THEN v_vence ELSE vence_en END,
      notas = CASE WHEN p_datos ? 'notas' THEN COALESCE(p_datos ->> 'notas', '') ELSE notas END,
      actualizada_en = now()
    WHERE id = l.id;
  ELSIF p_accion = 'revocar' THEN
    IF l.estado NOT IN ('DISPONIBLE', 'ASIGNADA') THEN RAISE EXCEPTION 'La licencia ya no está en uso.' USING ERRCODE = '22023'; END IF;
    UPDATE public.licencias SET estado = 'REVOCADA', actualizada_en = now() WHERE id = l.id;
  ELSIF p_accion = 'restaurar' THEN
    IF l.estado <> 'REVOCADA' THEN RAISE EXCEPTION 'Solo se restauran licencias revocadas.' USING ERRCODE = '22023'; END IF;
    IF l.organization_id IS NULL THEN
      UPDATE public.licencias SET estado = 'DISPONIBLE', actualizada_en = now() WHERE id = l.id;
    ELSE
      IF EXISTS (SELECT 1 FROM public.licencias WHERE organization_id = l.organization_id AND estado = 'ASIGNADA') THEN
        RAISE EXCEPTION 'La empresa ya tiene otra licencia en uso.' USING ERRCODE = '23505';
      END IF;
      UPDATE public.licencias SET estado = 'ASIGNADA', actualizada_en = now() WHERE id = l.id;
    END IF;
  ELSIF p_accion = 'asignar' THEN
    v_org := NULLIF(p_datos ->> 'organization_id', '');
    IF v_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.sub_empresas WHERE id = v_org) THEN RAISE EXCEPTION 'Empresa inexistente.' USING ERRCODE = '22023'; END IF;
    IF l.estado <> 'DISPONIBLE' THEN RAISE EXCEPTION 'Solo se asignan licencias disponibles.' USING ERRCODE = '22023'; END IF;
    UPDATE public.licencias SET estado = 'REEMPLAZADA', actualizada_en = now() WHERE organization_id = v_org AND estado = 'ASIGNADA';
    UPDATE public.licencias SET estado = 'ASIGNADA', organization_id = v_org, asignada_en = now(), actualizada_en = now() WHERE id = l.id;
    UPDATE public.sub_empresas SET estado = 'ACTIVE', plan_id = COALESCE(l.plan_id, plan_id), fecha_actualizado = now()
    WHERE id = v_org AND estado <> 'INTERNAL';
  ELSE
    RAISE EXCEPTION 'Acción inválida.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sub_auditoria(id, admin_usuario, accion, empresa_id, detalle, datos_anteriores, datos_nuevos)
  SELECT 'aud_lic_' || replace(gen_random_uuid()::text, '-', ''), v_user,'Licencia: ' || p_accion, x.organization_id, x.clave, to_jsonb(l), to_jsonb(x)
  FROM public.licencias x WHERE x.id = l.id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.licencia_admin(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.licencia_admin(text, jsonb) TO authenticated;

-- ═════════════════════ 6. EMPRESAS EXISTENTES ═════════════════════
-- Licencia indefinida para cada empresa no interna que aún no tenga una (límite = el de su plan, o 5).
-- Si ya tienen más usuarios activos que ese límite, el límite sube a esa cantidad para no bloquear a nadie.
INSERT INTO public.licencias(clave, plan_id, max_usuarios, vence_en, estado, organization_id, notas, creada_por, asignada_en)
SELECT public.licencia_nueva_clave(), s.plan_id,
       GREATEST(COALESCE(p.max_usuarios, 5), (SELECT count(*) FROM public."Usuarios" u WHERE u.organization_id::text = s.id AND COALESCE(u.activo, true))::int),
       NULL, 'ASIGNADA', s.id, 'Migración Lote 9: empresa existente al activar licencias.', 'sistema', now()
FROM public.sub_empresas s LEFT JOIN public.sub_planes p ON p.id = s.plan_id
WHERE s.estado <> 'INTERNAL'
  AND NOT EXISTS (SELECT 1 FROM public.licencias l WHERE l.organization_id = s.id AND l.estado = 'ASIGNADA');
