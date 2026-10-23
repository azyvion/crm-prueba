-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Migración de endurecimiento de seguridad (Lote 1 de auditoría)
-- Estado: PROPUESTA — NO APLICADA. Requiere confirmación explícita.
-- Cada sección es independiente y referencia un ID del registro de defectos
-- (docs/audit/DEFECT-REGISTER.md). Revertir: ver 20261023_01_rollback.sql
-- Probada contra el esquema real del proyecto dwtykzporgjjvdustjfq (2026-10-23).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── §A · SEC-01 (CRÍTICO) Lectura anónima de datos de negocio ────────────
-- Cualquiera con la clave pública podía leer Clientes, Prospectos, Cotizaciones,
-- Transacciones, Inventario y Actividad de org_azyvion_001 sin iniciar sesión.
-- Si la "Sala de equipo" necesita KPIs, debe usar una sesión autenticada o una
-- RPC que devuelva solo agregados (ver §J opcional).
DROP POLICY IF EXISTS sala_anon_select ON public."Clientes";
DROP POLICY IF EXISTS sala_anon_select ON public."Prospectos";
DROP POLICY IF EXISTS sala_anon_select ON public."Cotizaciones";
DROP POLICY IF EXISTS sala_anon_select ON public."Transacciones";
DROP POLICY IF EXISTS sala_anon_select ON public."Inventario";
DROP POLICY IF EXISTS sala_anon_select ON public."Actividad";
DROP POLICY IF EXISTS sala_anon_select ON public."Usuarios";   -- ya era USING(false)

-- ── §B · SEC-04 (ALTO) RPC que confía en el "caller" enviado por el cliente ─
-- admin_create_usuario_profile recibe p_caller_auth_uid como parámetro y era
-- ejecutable por anon/authenticated. Solo la Edge Function (service_role) la usa.
REVOKE EXECUTE ON FUNCTION public.admin_create_usuario_profile(uuid,uuid,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_insert_usuario(uuid,text,text,text,text,text,text,text) FROM PUBLIC, anon;
-- Funciones de trigger: no deben ser invocables por la API REST
REVOKE EXECUTE ON FUNCTION public.trg_auto_assign_org_id()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_usuarios_protect_cols() FROM PUBLIC, anon, authenticated;

-- ── §C · SEC-12 (BAJO) search_path mutable en funciones SECURITY DEFINER ──
-- Solo fija search_path; NO cambia el cuerpo de is_super_admin().
ALTER FUNCTION public.is_super_admin()          SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_auto_assign_org_id()  SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at()          SET search_path = public, pg_temp;

-- ── §D · SEC-06 (ALTO) Políticas "OR organization_id IS NULL" para {public} ─
-- Permitían a anon y a cualquier tenant leer/escribir filas sin organización.
-- Cada tabla conserva su política tenant_isolation / *_select|insert|update|delete.
DROP POLICY IF EXISTS cotizacion_items_isolation_policy    ON public."CotizacionItems";
DROP POLICY IF EXISTS sucursales_isolation_policy          ON public."Sucursales";
DROP POLICY IF EXISTS empleados_isolation_policy           ON public.empleados;
DROP POLICY IF EXISTS familiasinventario_isolation_policy  ON public."FamiliasInventario";
DROP POLICY IF EXISTS lineasinventario_isolation_policy    ON public."LineasInventario";
DROP POLICY IF EXISTS marcasinventario_isolation_policy    ON public."MarcasInventario";
DROP POLICY IF EXISTS tiposproducto_isolation_policy       ON public."TiposProducto";
DROP POLICY IF EXISTS unidadesnegocio_isolation_policy     ON public."UnidadesNegocio";
DROP POLICY IF EXISTS encuesta_preguntas_manage_org        ON public.encuesta_preguntas;
-- Preguntas de TODAS las organizaciones eran legibles sin login. La página
-- pública usa get_public_survey() (SECURITY DEFINER), que no necesita esto.
DROP POLICY IF EXISTS encuesta_preguntas_select_public     ON public.encuesta_preguntas;

-- ── §E · FN-04 (ALTO, DATOS) Encuesta Freelancer sin organización ─────────
-- La encuesta, sus 5 preguntas y sus 6 envíos tienen organization_id NULL:
-- ningún usuario del CRM puede verlos. SUPUESTO a confirmar: pertenecen a
-- org_azyvion_001 (los registros paralelos en TestReclutamiento sí lo están).
UPDATE public.encuestas           SET organization_id = 'org_azyvion_001' WHERE id = '96371cc3-3790-4dc3-8f3b-a7bc9138825f' AND organization_id IS NULL;
UPDATE public.encuesta_preguntas  SET organization_id = 'org_azyvion_001' WHERE encuesta_id = '96371cc3-3790-4dc3-8f3b-a7bc9138825f' AND organization_id IS NULL;
UPDATE public.encuesta_envios     SET organization_id = 'org_azyvion_001' WHERE encuesta_id = '96371cc3-3790-4dc3-8f3b-a7bc9138825f' AND organization_id IS NULL;
UPDATE public.encuesta_respuestas SET organization_id = 'org_azyvion_001' WHERE encuesta_id = '96371cc3-3790-4dc3-8f3b-a7bc9138825f' AND organization_id IS NULL;

-- ── §F · FN-05 (ALTO, DATOS) Empresas auto-registradas sin user_roles ────
-- register-crm crea Usuarios(rol='Admin') pero no user_roles → get_my_org_id()
-- devuelve NULL y módulos con políticas basadas en user_roles quedan vacíos;
-- admin-user-manager responde 500. Además user_roles y los catálogos de
-- inventario tienen FK a sub_empresas, donde register-crm nunca escribe.
-- Backfill idempotente (1) sub_empresas desde Organizations, (2) user_roles:
INSERT INTO public.sub_empresas (id, nombre, correo, estado)
SELECT o.id, COALESCE(NULLIF(o.nombre,''), o.id), o.correo, 'TRIAL'
FROM public."Organizations" o
WHERE NOT EXISTS (SELECT 1 FROM public.sub_empresas s WHERE s.id = o.id);

INSERT INTO public.user_roles (user_id, role, organization_id)
SELECT u.auth_uid, 'ADMIN', u.organization_id
FROM public."Usuarios" u
WHERE u.auth_uid IS NOT NULL AND u.rol = 'Admin' AND u.organization_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.auth_uid AND r.organization_id = u.organization_id);

-- ── §G · SEC-05 (ALTO) Storage sin aislamiento por organización ──────────
-- fotos-perfil: anon tenía ALL (subir/sobrescribir/borrar). logos-empresa:
-- cualquier usuario de cualquier empresa podía sobrescribir/borrar logos ajenos.
-- Las rutas actuales ya codifican el dueño: logo_org_<org>_*, prod_<org>_*, perfil_<usuario>_*.
DROP POLICY IF EXISTS "acceso publico fotos-perfil" ON storage.objects;
DROP POLICY IF EXISTS "Permitir subir logos"        ON storage.objects;
DROP POLICY IF EXISTS "Permitir actualizar logos"   ON storage.objects;
DROP POLICY IF EXISTS "Permitir eliminar logos"     ON storage.objects;
DROP POLICY IF EXISTS customer_logos_insert ON storage.objects;
DROP POLICY IF EXISTS customer_logos_update ON storage.objects;
DROP POLICY IF EXISTS customer_logos_delete ON storage.objects;

CREATE POLICY fotos_perfil_read  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'fotos-perfil');
CREATE POLICY fotos_perfil_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fotos-perfil' AND starts_with(name, 'perfil_' || public.get_my_username() || '_'));
CREATE POLICY fotos_perfil_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'fotos-perfil' AND starts_with(name, 'perfil_' || public.get_my_username() || '_'))
  WITH CHECK (bucket_id = 'fotos-perfil' AND starts_with(name, 'perfil_' || public.get_my_username() || '_'));
CREATE POLICY fotos_perfil_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'fotos-perfil' AND starts_with(name, 'perfil_' || public.get_my_username() || '_'));

CREATE POLICY logos_org_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'logos-empresa' AND (
       starts_with(name, 'logo_org_' || public.current_user_org_id() || '_')
    OR starts_with(name, 'prod_' || public.current_user_org_id() || '_')));
CREATE POLICY logos_org_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'logos-empresa' AND (
       starts_with(name, 'logo_org_' || public.current_user_org_id() || '_')
    OR starts_with(name, 'prod_' || public.current_user_org_id() || '_')))
  WITH CHECK (bucket_id = 'logos-empresa' AND (
       starts_with(name, 'logo_org_' || public.current_user_org_id() || '_')
    OR starts_with(name, 'prod_' || public.current_user_org_id() || '_')));
CREATE POLICY logos_org_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'logos-empresa' AND (
       starts_with(name, 'logo_org_' || public.current_user_org_id() || '_')
    OR starts_with(name, 'prod_' || public.current_user_org_id() || '_')));
-- customer-logos: no se usa en el frontend actual → queda solo lectura autenticada.

-- ── §H · SEC-07 (MEDIO) Cualquier miembro podía editar/borrar a otros usuarios ─
-- tenant_isolation (ALL) en Usuarios permitía a un AGENTE desactivar o borrar
-- al ADMIN de su empresa, o cambiar sus permisos. Se separa por operación:
DROP POLICY IF EXISTS tenant_isolation ON public."Usuarios";
CREATE POLICY usuarios_select ON public."Usuarios" FOR SELECT TO authenticated
  USING (organization_id = public.current_user_org_id() OR public.is_super_admin());
CREATE POLICY usuarios_update_self ON public."Usuarios" FOR UPDATE TO authenticated
  USING (auth_uid = auth.uid()) WITH CHECK (auth_uid = auth.uid());
CREATE POLICY usuarios_admin_write ON public."Usuarios" FOR ALL TO authenticated
  USING (public.is_super_admin() OR (organization_id = public.get_my_org_id() AND public.get_my_role(organization_id) = 'ADMIN'))
  WITH CHECK (public.is_super_admin() OR (organization_id = public.get_my_org_id() AND public.get_my_role(organization_id) = 'ADMIN'));
-- (El trigger trg_protect_usuarios_cols sigue impidiendo cambios de rol/org/auth_uid.)

-- ── §I · FN-03 (MEDIO) get_public_survey no devuelve opciones ────────────
-- Preguntas de opción múltiple se mostraban sin opciones. Cambio aditivo,
-- misma firma, mismo SECURITY DEFINER y search_path.
CREATE OR REPLACE FUNCTION public.get_public_survey(p_token text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', e.id, 'nombre', e.nombre, 'notas', e.notas,
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', q.id, 'titulo', q.titulo, 'tipo', q.tipo_respuesta,
          'orden', q.orden, 'opciones', q.opciones) ORDER BY q.orden)
      FROM public.encuesta_preguntas AS q WHERE q.encuesta_id = e.id), '[]'::jsonb))
  FROM public.encuestas AS e
  WHERE e.token_publico = p_token AND e.estado = 'Activa'
  LIMIT 1;
$function$;

-- ── §J · FN-09 (MEDIO) No se pueden crear usuarios Vendedor ──────────────
-- admin-user-manager permite VENDEDOR y Usuarios_rol_check acepta 'Vendedor',
-- pero admin_create_usuario_profile lo rechazaba ("Rol legacy inválido").
-- Mismo cuerpo que la versión actual; solo se añade 'Vendedor' a las listas.
CREATE OR REPLACE FUNCTION public.admin_create_usuario_profile(p_caller_auth_uid uuid, p_auth_uid uuid, p_usuario text, p_nombre text, p_rol_legacy text, p_correo text, p_telefono text, p_cargo text, p_organization_id text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT; v_caller_org_id TEXT; v_new_id UUID; v_existing_uid UUID;
BEGIN
  IF p_rol_legacy NOT IN ('Admin', 'Gerente', 'Agente', 'Vendedor') THEN
    RAISE EXCEPTION 'Rol legacy inválido: %', p_rol_legacy;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_caller_auth_uid) THEN
    RAISE EXCEPTION 'El caller_auth_uid no corresponde a ningún usuario de auth.users.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_auth_uid) THEN
    RAISE EXCEPTION 'El auth_uid indicado no existe en auth.users.';
  END IF;
  SELECT role, organization_id INTO v_caller_role, v_caller_org_id
  FROM public.user_roles WHERE user_id = p_caller_auth_uid AND role = 'SUPER_ADMIN' AND organization_id IS NULL LIMIT 1;
  IF v_caller_role IS NULL THEN
    SELECT role, organization_id INTO v_caller_role, v_caller_org_id
    FROM public.user_roles WHERE user_id = p_caller_auth_uid AND organization_id IS NOT NULL
    ORDER BY CASE role WHEN 'ADMIN' THEN 1 WHEN 'GERENTE' THEN 2 ELSE 3 END LIMIT 1;
  END IF;
  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'No se encontró un rol asignado al solicitante en user_roles.';
  END IF;
  IF v_caller_role NOT IN ('SUPER_ADMIN', 'ADMIN') THEN
    RAISE EXCEPTION 'No autorizado para crear usuarios. Rol del solicitante: %', v_caller_role;
  END IF;
  IF v_caller_role = 'ADMIN' THEN
    IF p_rol_legacy NOT IN ('Gerente', 'Agente', 'Vendedor') THEN
      RAISE EXCEPTION 'ADMIN solo puede crear usuarios con rol Gerente, Agente o Vendedor.';
    END IF;
    IF p_organization_id IS DISTINCT FROM v_caller_org_id THEN
      RAISE EXCEPTION 'ADMIN no puede crear usuarios en otra organización.';
    END IF;
  END IF;
  SELECT id INTO v_existing_uid FROM public."Usuarios" WHERE auth_uid = p_auth_uid LIMIT 1;
  IF v_existing_uid IS NOT NULL THEN
    RAISE EXCEPTION 'El auth_uid ya está vinculado a un usuario existente.';
  END IF;
  v_new_id := gen_random_uuid();
  INSERT INTO public."Usuarios" (id, usuario, nombre, rol, activo, correo, telefono, cargo, auth_uid, organization_id,
    "fechaReg", "fotoUrl", "fotoFileId", tema, "paginaInicio", "densidadTabla", "copiarmeCotizaciones", "alertaStockCritico")
  VALUES (v_new_id, p_usuario, p_nombre, p_rol_legacy, TRUE, p_correo, COALESCE(p_telefono, ''), COALESCE(p_cargo, ''),
    p_auth_uid, p_organization_id, NOW(), '', '', 'claro', 'overview', 'comoda', FALSE, FALSE);
  RETURN v_new_id;
END;
$function$;
-- CREATE OR REPLACE conserva los GRANT/REVOKE de §B.

COMMIT;
