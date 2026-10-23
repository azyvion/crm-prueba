-- Reversión de 20261023_02_org_settings_fel.sql
-- ATENCIÓN: si ya se guardaron credenciales FEL en org_fel_secrets, este script
-- las devuelve a Organizations (visibles de nuevo para los miembros). Úsalo solo
-- si la migración rompe algo y con la aprobación del propietario.
BEGIN;

DROP POLICY IF EXISTS org_select ON public."Organizations";
DROP POLICY IF EXISTS org_update ON public."Organizations";
DROP POLICY IF EXISTS org_insert ON public."Organizations";
DROP POLICY IF EXISTS org_delete ON public."Organizations";
CREATE POLICY tenant_isolation ON public."Organizations" FOR ALL TO public
  USING (id = public.current_user_org_id()) WITH CHECK (id = public.current_user_org_id());
GRANT ALL ON public."Organizations" TO anon;

DROP TRIGGER IF EXISTS trg_org_fel_secrets ON public."Organizations";
ALTER TABLE public."Organizations" DROP CONSTRAINT IF EXISTS organizations_no_fel_secrets_chk;
UPDATE public."Organizations" o
   SET fel_usuario_certificador = s.fel_usuario_certificador, fel_api_key = s.fel_api_key
  FROM public.org_fel_secrets s WHERE s.organization_id = o.id;

DROP FUNCTION IF EXISTS public.set_fel_credentials(text, text, text, boolean);
DROP FUNCTION IF EXISTS public.get_fel_credentials_status(text);
DROP FUNCTION IF EXISTS public.trg_fn_org_fel_secrets();
DROP TABLE IF EXISTS public.org_fel_secrets;

-- iva_modalidad se conserva (aditiva; el frontend la usa). Para quitarla:
-- ALTER TABLE public."Organizations" DROP COLUMN iva_modalidad;

-- Restaurar trg_fn_usuarios_protect_cols anterior
DO $$ DECLARE d text; BEGIN
  SELECT def INTO d FROM audit_backup.lote2_functions WHERE fn = 'trg_fn_usuarios_protect_cols' LIMIT 1;
  IF d IS NOT NULL THEN EXECUTE d; END IF;
END $$;

COMMIT;
