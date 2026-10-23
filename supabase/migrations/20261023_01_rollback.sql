-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK de 20261023_01_security_hardening.sql
-- Restaura las políticas/permisos tal como estaban el 2026-10-23 (copiados de
-- pg_policies del proyecto). Las secciones de DATOS (§E, §F) no se revierten
-- automáticamente: ver notas al final.
-- ═══════════════════════════════════════════════════════════════════════
BEGIN;

-- §A
CREATE POLICY sala_anon_select ON public."Clientes"      FOR SELECT TO anon USING (organization_id = 'org_azyvion_001');
CREATE POLICY sala_anon_select ON public."Prospectos"    FOR SELECT TO anon USING (organization_id = 'org_azyvion_001');
CREATE POLICY sala_anon_select ON public."Cotizaciones"  FOR SELECT TO anon USING (organization_id = 'org_azyvion_001');
CREATE POLICY sala_anon_select ON public."Transacciones" FOR SELECT TO anon USING (organization_id = 'org_azyvion_001');
CREATE POLICY sala_anon_select ON public."Inventario"    FOR SELECT TO anon USING (organization_id = 'org_azyvion_001');
CREATE POLICY sala_anon_select ON public."Actividad"     FOR SELECT TO anon USING (organization_id = 'org_azyvion_001');
CREATE POLICY sala_anon_select ON public."Usuarios"      FOR SELECT TO anon USING (false);

-- §B
GRANT EXECUTE ON FUNCTION public.admin_create_usuario_profile(uuid,uuid,text,text,text,text,text,text,text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_insert_usuario(uuid,text,text,text,text,text,text,text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trg_auto_assign_org_id()       TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_fn_usuarios_protect_cols() TO PUBLIC, anon, authenticated;

-- §C
ALTER FUNCTION public.is_super_admin()         RESET search_path;
ALTER FUNCTION public.trg_auto_assign_org_id() RESET search_path;
ALTER FUNCTION public.set_updated_at()         RESET search_path;

-- §D
CREATE POLICY cotizacion_items_isolation_policy   ON public."CotizacionItems"   FOR ALL TO public USING ((organization_id = current_user_org_id()) OR (organization_id IS NULL)) WITH CHECK ((organization_id = current_user_org_id()) OR (organization_id IS NULL));
CREATE POLICY sucursales_isolation_policy         ON public."Sucursales"        FOR ALL TO public USING ((organization_id = current_user_org_id()) OR (organization_id IS NULL)) WITH CHECK ((organization_id = current_user_org_id()) OR (organization_id IS NULL));
CREATE POLICY empleados_isolation_policy          ON public.empleados           FOR ALL TO public USING ((organization_id = current_user_org_id()) OR (organization_id IS NULL)) WITH CHECK ((organization_id = current_user_org_id()) OR (organization_id IS NULL));
CREATE POLICY familiasinventario_isolation_policy ON public."FamiliasInventario" FOR ALL TO public USING ((organization_id = current_user_org_id()) OR (organization_id IS NULL)) WITH CHECK ((organization_id = current_user_org_id()) OR (organization_id IS NULL));
CREATE POLICY lineasinventario_isolation_policy   ON public."LineasInventario"  FOR ALL TO public USING ((organization_id = current_user_org_id()) OR (organization_id IS NULL)) WITH CHECK ((organization_id = current_user_org_id()) OR (organization_id IS NULL));
CREATE POLICY marcasinventario_isolation_policy   ON public."MarcasInventario"  FOR ALL TO public USING ((organization_id = current_user_org_id()) OR (organization_id IS NULL)) WITH CHECK ((organization_id = current_user_org_id()) OR (organization_id IS NULL));
CREATE POLICY tiposproducto_isolation_policy      ON public."TiposProducto"     FOR ALL TO public USING ((organization_id = current_user_org_id()) OR (organization_id IS NULL)) WITH CHECK ((organization_id = current_user_org_id()) OR (organization_id IS NULL));
CREATE POLICY unidadesnegocio_isolation_policy    ON public."UnidadesNegocio"   FOR ALL TO public USING ((organization_id = current_user_org_id()) OR (organization_id IS NULL)) WITH CHECK ((organization_id = current_user_org_id()) OR (organization_id IS NULL));
CREATE POLICY encuesta_preguntas_manage_org       ON public.encuesta_preguntas  FOR ALL TO public USING ((organization_id = current_user_org_id()) OR (organization_id IS NULL)) WITH CHECK ((organization_id = current_user_org_id()) OR (organization_id IS NULL));
CREATE POLICY encuesta_preguntas_select_public    ON public.encuesta_preguntas  FOR SELECT TO public USING (true);

-- §G
DROP POLICY IF EXISTS fotos_perfil_read   ON storage.objects;
DROP POLICY IF EXISTS fotos_perfil_write  ON storage.objects;
DROP POLICY IF EXISTS fotos_perfil_update ON storage.objects;
DROP POLICY IF EXISTS fotos_perfil_delete ON storage.objects;
DROP POLICY IF EXISTS logos_org_write     ON storage.objects;
DROP POLICY IF EXISTS logos_org_update    ON storage.objects;
DROP POLICY IF EXISTS logos_org_delete    ON storage.objects;
CREATE POLICY "acceso publico fotos-perfil" ON storage.objects FOR ALL TO anon USING (bucket_id = 'fotos-perfil') WITH CHECK (bucket_id = 'fotos-perfil');
CREATE POLICY "Permitir subir logos"        ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'logos-empresa');
CREATE POLICY "Permitir actualizar logos"   ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'logos-empresa') WITH CHECK (bucket_id = 'logos-empresa');
CREATE POLICY "Permitir eliminar logos"     ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'logos-empresa');
CREATE POLICY customer_logos_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'customer-logos');
CREATE POLICY customer_logos_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'customer-logos');
CREATE POLICY customer_logos_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'customer-logos');

-- §H
DROP POLICY IF EXISTS usuarios_select      ON public."Usuarios";
DROP POLICY IF EXISTS usuarios_update_self ON public."Usuarios";
DROP POLICY IF EXISTS usuarios_admin_write ON public."Usuarios";
CREATE POLICY tenant_isolation ON public."Usuarios" FOR ALL TO public USING (organization_id = current_user_org_id()) WITH CHECK (organization_id = current_user_org_id());

-- §I / §J: las versiones nuevas de get_public_survey y admin_create_usuario_profile
-- son compatibles hacia atrás (campo extra 'opciones'; rol 'Vendedor' aceptado). No se revierten.

COMMIT;

-- ── Reversión de DATOS (opcional, exacta) usando el respaldo audit_backup ──
-- Ejecutar solo si también se quiere deshacer §E/§F.
-- BEGIN;
-- -- §E: restaurar organization_id original (NULL) de la encuesta Freelancer
-- UPDATE public.encuestas t           SET organization_id = b.organization_id FROM audit_backup.encuesta_org_20261023 b WHERE b.tabla='encuestas'           AND t.id=b.id;
-- UPDATE public.encuesta_preguntas t  SET organization_id = b.organization_id FROM audit_backup.encuesta_org_20261023 b WHERE b.tabla='encuesta_preguntas'  AND t.id=b.id;
-- UPDATE public.encuesta_envios t     SET organization_id = b.organization_id FROM audit_backup.encuesta_org_20261023 b WHERE b.tabla='encuesta_envios'     AND t.id=b.id;
-- UPDATE public.encuesta_respuestas t SET organization_id = b.organization_id FROM audit_backup.encuesta_org_20261023 b WHERE b.tabla='encuesta_respuestas' AND t.id=b.id;
-- -- §F: quitar filas añadidas
-- DELETE FROM public.user_roles r WHERE NOT EXISTS (SELECT 1 FROM audit_backup.user_roles_20261023 b WHERE b.id = r.id);
-- DELETE FROM public.sub_empresas s WHERE NOT EXISTS (SELECT 1 FROM audit_backup.sub_empresas_ids_20261023 b WHERE b.id = s.id);
-- COMMIT;
-- (Ojo: el DELETE de user_roles también quitaría roles de usuarios creados DESPUÉS de la migración.)
--
-- Edge Functions: redesplegar supabase/backup/20261023/admin-user-manager.v5.index.ts (verify_jwt=true)
-- y register-crm.v4.index.ts (verify_jwt=false).
-- Definiciones originales de funciones/políticas/permisos: audit_backup.functions_20261023,
-- audit_backup.policies_20261023, audit_backup.routine_grants_20261023.
