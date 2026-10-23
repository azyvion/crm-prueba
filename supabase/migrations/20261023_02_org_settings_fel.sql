-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Lote 2 · Configuración de empresa y credenciales FEL
-- Corrige: SEC-09 (cualquier miembro lee/modifica Organizations, incl. FEL),
--          FN-13 (columna iva_modalidad inexistente → guardar Ajustes falla),
--          SEC-14 (INSERT en Usuarios no valida auth_uid / rol Admin).
-- Aditiva salvo el reemplazo de la política tenant_isolation de Organizations.
-- Reversión: 20261023_02_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════

-- §0 Respaldo de lo que se reemplaza
CREATE TABLE IF NOT EXISTS audit_backup.lote2_policies AS
  SELECT now() AS backed_up_at, p.* FROM pg_policies p
  WHERE p.schemaname = 'public' AND p.tablename = 'Organizations';
CREATE TABLE IF NOT EXISTS audit_backup.lote2_functions AS
  SELECT now() AS backed_up_at, 'trg_fn_usuarios_protect_cols'::text AS fn,
         pg_get_functiondef('public.trg_fn_usuarios_protect_cols'::regproc) AS def;

-- §A FN-13 · iva_modalidad (el frontend ya la envía y la lee)
ALTER TABLE public."Organizations"
  ADD COLUMN IF NOT EXISTS iva_modalidad text NOT NULL DEFAULT 'incluido';
DO $$ BEGIN
  ALTER TABLE public."Organizations" ADD CONSTRAINT organizations_iva_modalidad_chk
    CHECK (iva_modalidad IN ('incluido','sobre','exento'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- §B SEC-09 · Secretos FEL fuera de la tabla legible por el cliente
CREATE TABLE IF NOT EXISTS public.org_fel_secrets (
  organization_id          text PRIMARY KEY
                           REFERENCES public."Organizations"(id) ON DELETE CASCADE
                           DEFERRABLE INITIALLY DEFERRED,
  fel_usuario_certificador text,
  fel_api_key              text,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid
);
ALTER TABLE public.org_fel_secrets ENABLE ROW LEVEL SECURITY;
-- Sin políticas y sin permisos: solo service_role / funciones SECURITY DEFINER.
REVOKE ALL ON public.org_fel_secrets FROM PUBLIC, anon, authenticated;

INSERT INTO public.org_fel_secrets (organization_id, fel_usuario_certificador, fel_api_key)
SELECT id, NULLIF(fel_usuario_certificador, ''), NULLIF(fel_api_key, '')
FROM public."Organizations"
WHERE COALESCE(fel_usuario_certificador, '') <> '' OR COALESCE(fel_api_key, '') <> ''
ON CONFLICT (organization_id) DO NOTHING;

UPDATE public."Organizations"
   SET fel_usuario_certificador = NULL, fel_api_key = NULL
 WHERE fel_usuario_certificador IS NOT NULL OR fel_api_key IS NOT NULL;

-- Compatibilidad con el frontend anterior: si alguien escribe credenciales en
-- Organizations, se mueven a org_fel_secrets (solo ADMIN) y nunca se guardan ahí.
CREATE OR REPLACE FUNCTION public.trg_fn_org_fel_secrets()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user text := NULLIF(btrim(NEW.fel_usuario_certificador), '');
  v_key  text := NULLIF(btrim(NEW.fel_api_key), '');
BEGIN
  NEW.fel_usuario_certificador := NULL;
  NEW.fel_api_key := NULL;
  IF v_user IS NULL AND v_key IS NULL THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL
     AND NOT COALESCE(public.is_super_admin() OR public.get_my_role(NEW.id) = 'ADMIN', false) THEN
    RAISE EXCEPTION 'Solo un ADMIN puede modificar las credenciales FEL.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.org_fel_secrets AS s (organization_id, fel_usuario_certificador, fel_api_key, updated_at, updated_by)
  VALUES (NEW.id, v_user, v_key, now(), auth.uid())
  ON CONFLICT (organization_id) DO UPDATE SET
    fel_usuario_certificador = COALESCE(EXCLUDED.fel_usuario_certificador, s.fel_usuario_certificador),
    fel_api_key              = COALESCE(EXCLUDED.fel_api_key, s.fel_api_key),
    updated_at = now(), updated_by = auth.uid();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_fn_org_fel_secrets() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_org_fel_secrets ON public."Organizations";
CREATE TRIGGER trg_org_fel_secrets
  BEFORE INSERT OR UPDATE ON public."Organizations"
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_org_fel_secrets();

DO $$ BEGIN
  ALTER TABLE public."Organizations" ADD CONSTRAINT organizations_no_fel_secrets_chk
    CHECK (fel_usuario_certificador IS NULL AND fel_api_key IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Estado enmascarado (nunca devuelve el secreto).
-- COALESCE en las guardas: get_my_role() es NULL para una org ajena y NOT(NULL) no deniega.
CREATE OR REPLACE FUNCTION public.get_fel_credentials_status(p_org_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_org text := COALESCE(NULLIF(p_org_id, ''), public.get_my_org_id());
  s public.org_fel_secrets;
BEGIN
  IF v_org IS NULL OR NOT COALESCE(public.is_super_admin() OR public.get_my_role(v_org) = 'ADMIN', false) THEN
    RETURN jsonb_build_object('authorized', false);
  END IF;
  SELECT * INTO s FROM public.org_fel_secrets WHERE organization_id = v_org;
  RETURN jsonb_build_object(
    'authorized', true,
    'organization_id', v_org,
    'has_usuario', s.fel_usuario_certificador IS NOT NULL,
    'has_api_key', s.fel_api_key IS NOT NULL,
    'usuario_hint', CASE WHEN s.fel_usuario_certificador IS NULL THEN NULL
                         ELSE left(s.fel_usuario_certificador, 2) || '••••' END,
    'api_key_hint', CASE WHEN s.fel_api_key IS NULL THEN NULL
                         WHEN length(s.fel_api_key) < 8 THEN '••••'
                         ELSE '••••' || right(s.fel_api_key, 4) END,
    'updated_at', s.updated_at);
END $$;

-- Guardar / borrar credenciales (solo ADMIN de la org o SUPER_ADMIN)
--   NULL o '' en un campo = conservar el valor actual; p_clear = borrar ambos.
CREATE OR REPLACE FUNCTION public.set_fel_credentials(
  p_org_id text, p_usuario text DEFAULT NULL, p_api_key text DEFAULT NULL, p_clear boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_org text := COALESCE(NULLIF(p_org_id, ''), public.get_my_org_id());
  v_user text := NULLIF(btrim(p_usuario), '');
  v_key  text := NULLIF(btrim(p_api_key), '');
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL
     OR NOT COALESCE(public.is_super_admin() OR public.get_my_role(v_org) = 'ADMIN', false) THEN
    RAISE EXCEPTION 'Solo un ADMIN puede modificar las credenciales FEL.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."Organizations" WHERE id = v_org) THEN
    RAISE EXCEPTION 'Primero guarda la configuración de la empresa.' USING ERRCODE = 'P0002';
  END IF;
  IF length(COALESCE(v_user, '')) > 200 OR length(COALESCE(v_key, '')) > 500 THEN
    RAISE EXCEPTION 'Credencial demasiado larga.' USING ERRCODE = '22001';
  END IF;
  IF p_clear THEN
    DELETE FROM public.org_fel_secrets WHERE organization_id = v_org;
  ELSIF v_user IS NOT NULL OR v_key IS NOT NULL THEN
    INSERT INTO public.org_fel_secrets AS s (organization_id, fel_usuario_certificador, fel_api_key, updated_at, updated_by)
    VALUES (v_org, v_user, v_key, now(), auth.uid())
    ON CONFLICT (organization_id) DO UPDATE SET
      fel_usuario_certificador = COALESCE(EXCLUDED.fel_usuario_certificador, s.fel_usuario_certificador),
      fel_api_key              = COALESCE(EXCLUDED.fel_api_key, s.fel_api_key),
      updated_at = now(), updated_by = auth.uid();
  END IF;
  RETURN public.get_fel_credentials_status(v_org);
END $$;

REVOKE ALL ON FUNCTION public.get_fel_credentials_status(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_fel_credentials(text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fel_credentials_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_fel_credentials(text, text, text, boolean) TO authenticated;

-- §C SEC-09 · Organizations: lectura para miembros, escritura solo ADMIN/GERENTE
DROP POLICY IF EXISTS tenant_isolation ON public."Organizations";
CREATE POLICY org_select ON public."Organizations" FOR SELECT TO authenticated
  USING (id = public.get_my_org_id() OR id = public.current_user_org_id() OR public.is_super_admin());
CREATE POLICY org_update ON public."Organizations" FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR public.get_my_role(id) IN ('ADMIN','GERENTE'))
  WITH CHECK (public.is_super_admin() OR public.get_my_role(id) IN ('ADMIN','GERENTE'));
CREATE POLICY org_insert ON public."Organizations" FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR public.get_my_role(id) = 'ADMIN');
CREATE POLICY org_delete ON public."Organizations" FOR DELETE TO authenticated
  USING (public.is_super_admin());
REVOKE ALL ON public."Organizations" FROM anon;

-- §D SEC-14 · Usuarios: en INSERT desde un cliente (no service_role) se valida
--   que auth_uid pertenezca a la misma organización y que ADMIN no cree 'Admin'.
CREATE OR REPLACE FUNCTION public.trg_fn_usuarios_protect_cols()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_role text;
BEGIN
  -- Determinar rol desde user_roles, nunca desde Usuarios.rol
  IF public.is_super_admin() THEN
    v_role := 'SUPER_ADMIN';
  ELSE
    v_role := public.get_my_role(public.get_my_org_id());
  END IF;

  -- INSERT:
  -- La policy RLS controla qué puede insertar cada rol. service_role (auth.uid()
  -- NULL: Edge Functions) no se restringe aquí. [AUDIT SEC-14]
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND v_role IS DISTINCT FROM 'SUPER_ADMIN' THEN
      IF NEW.rol = 'Admin' THEN
        RAISE EXCEPTION 'No autorizado: ADMIN no puede asignar el rol Admin';
      END IF;
      IF NEW.auth_uid IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = NEW.auth_uid AND ur.organization_id = NEW.organization_id) THEN
        RAISE EXCEPTION 'No autorizado: auth_uid no pertenece a esta organización';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Backend de confianza (service_role / SQL): sin restricción. A partir de aquí
  -- se usa IS DISTINCT FROM: con v_role NULL, "<>" daba NULL y no bloqueaba.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- auth_uid: únicamente SUPER_ADMIN puede modificarlo.
  IF OLD.auth_uid IS DISTINCT FROM NEW.auth_uid THEN
    IF v_role IS DISTINCT FROM 'SUPER_ADMIN' THEN
      RAISE EXCEPTION 'No autorizado: solo SUPER_ADMIN puede modificar auth_uid';
    END IF;
  END IF;

  -- organization_id: únicamente SUPER_ADMIN puede modificarlo.
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
    IF v_role IS DISTINCT FROM 'SUPER_ADMIN' THEN
      RAISE EXCEPTION 'No autorizado: solo SUPER_ADMIN puede modificar organization_id';
    END IF;
  END IF;

  -- rol histórico de Usuarios:
  IF OLD.rol IS DISTINCT FROM NEW.rol THEN
    IF v_role = 'SUPER_ADMIN' THEN
      NULL;
    ELSIF v_role = 'ADMIN' THEN
      IF OLD.rol = 'Admin' THEN
        RAISE EXCEPTION 'No autorizado: ADMIN no puede modificar el rol de otro Admin';
      END IF;
      IF NEW.rol = 'Admin' THEN
        RAISE EXCEPTION 'No autorizado: ADMIN no puede asignar el rol Admin';
      END IF;
    ELSE
      RAISE EXCEPTION 'No autorizado: no tiene permisos para cambiar roles de usuario';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
