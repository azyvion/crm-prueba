-- ═══════════════════════════════════════════════════════════════════════
-- Reversión de 20261023_11_licencias.sql: restaura las funciones y políticas originales
-- (copiadas de producción el 2026-10-23) y elimina las licencias.
-- ATENCIÓN: borra la tabla licencias (claves generadas y asignaciones). Respáldela antes.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.current_user_org_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
    SELECT u.organization_id::text
    FROM public."Usuarios" AS u
    WHERE u.auth_uid::text = auth.uid()::text
       OR u.id::text = auth.uid()::text
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_org_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT ur.organization_id
  FROM public.user_roles AS ur
  WHERE ur.user_id = auth.uid()
    AND ur.organization_id IS NOT NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.pos_ctx()
RETURNS TABLE(org text, uid uuid, usuario text, nombre text, rol text, sucursal text, perms jsonb, privilegiado boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT u.organization_id::text, auth.uid(), u.usuario, u.nombre, u.rol, u.sucursal_id,
         COALESCE(u.permisos, '{}'::jsonb),
         upper(u.rol) IN ('ADMIN', 'SUPER_ADMIN', 'GERENTE')
  FROM public."Usuarios" u
  WHERE (u.auth_uid::text = auth.uid()::text OR u.id::text = auth.uid()::text)
    AND COALESCE(u.activo, true)
  LIMIT 1;
$$;

DROP POLICY IF EXISTS org_isolation_categorias_inventario ON public."CategoriasInventario";
CREATE POLICY org_isolation_categorias_inventario ON public."CategoriasInventario" FOR ALL
  USING (organization_id = (SELECT u.organization_id FROM public."Usuarios" u WHERE u.auth_uid = auth.uid() LIMIT 1))
  WITH CHECK (organization_id = (SELECT u.organization_id FROM public."Usuarios" u WHERE u.auth_uid = auth.uid() LIMIT 1));
DROP POLICY IF EXISTS empleados_select_org ON public.empleados;
CREATE POLICY empleados_select_org ON public.empleados FOR SELECT
  USING (organization_id IN (SELECT "Usuarios".organization_id FROM public."Usuarios" WHERE "Usuarios".auth_uid = auth.uid()));
DROP POLICY IF EXISTS empleados_insert_org ON public.empleados;
CREATE POLICY empleados_insert_org ON public.empleados FOR INSERT
  WITH CHECK (organization_id IN (SELECT "Usuarios".organization_id FROM public."Usuarios" WHERE "Usuarios".auth_uid = auth.uid()));
DROP POLICY IF EXISTS empleados_update_org ON public.empleados;
CREATE POLICY empleados_update_org ON public.empleados FOR UPDATE
  USING (organization_id IN (SELECT u.organization_id FROM public."Usuarios" u WHERE u.auth_uid = auth.uid()))
  WITH CHECK (organization_id IN (SELECT u.organization_id FROM public."Usuarios" u WHERE u.auth_uid = auth.uid()));
DROP POLICY IF EXISTS empleados_delete_org ON public.empleados;
CREATE POLICY empleados_delete_org ON public.empleados FOR DELETE
  USING (organization_id IN (SELECT "Usuarios".organization_id FROM public."Usuarios" WHERE "Usuarios".auth_uid = auth.uid()));

DROP TRIGGER IF EXISTS trg_usuarios_licencia ON public."Usuarios";
DROP FUNCTION IF EXISTS public.trg_fn_usuarios_licencia();
DROP FUNCTION IF EXISTS public.licencia_admin(text, jsonb);
DROP FUNCTION IF EXISTS public.licencia_activar(text);
DROP FUNCTION IF EXISTS public.mi_licencia();
DROP FUNCTION IF EXISTS public.licencia_mi_org();
DROP FUNCTION IF EXISTS public.licencia_nueva_clave();
DROP FUNCTION IF EXISTS public.licencia_normalizar(text);
DROP FUNCTION IF EXISTS public.licencia_org_vigente(text);
DROP FUNCTION IF EXISTS public.licencia_contacto();
DROP FUNCTION IF EXISTS public.licencia_hoy();
DROP TABLE IF EXISTS public.licencias;
