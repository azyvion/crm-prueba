-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Regresión Lote 9: licencias. Requiere 06–11. Datos sintéticos; SIEMPRE
-- termina en RAISE EXCEPTION (todo se revierte). Resultado: "LIC_RESULTS: PASS=n FAIL=m".
-- Usa la empresa Coca Cola (no interna) y Azyvion (interna, exenta).
-- ═══════════════════════════════════════════════════════════════════════
CREATE FUNCTION pg_temp.como(p_sub text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE 'RESET ROLE';
  IF p_sub IS NULL THEN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true); EXECUTE 'SET LOCAL ROLE anon';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
  END IF;
END $f$;
CREATE FUNCTION pg_temp.servidor() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); END $f$;

DO $s$
DECLARE
  res text := ''; pass int := 0; fail int := 0; ok boolean; r jsonb; n int; n2 int; t text; lic public.licencias;
  sup text := 'c4477277-66a8-4a3f-8379-38b3b72eafed';   -- súper admin (Azyvion)
  agt text := '9ed2cc01-79ce-46ed-88c2-000640635e6c';   -- agente de Azyvion (interna)
  coca_adm text := 'e7887efe-a658-4df2-8a3d-9f3705234adf';
  coca text := 'coca-cola-muysseyy';
  vend_uid uuid := gen_random_uuid(); vend_id uuid := gen_random_uuid(); extra_id uuid := gen_random_uuid();
  cli uuid := gen_random_uuid(); k1 text; k2 text;
BEGIN
  PERFORM pg_temp.servidor();
  -- Cliente sintético de Coca Cola para comprobar acceso a datos
  INSERT INTO public."Clientes"(id, nombre, organization_id) VALUES (cli, 'QA Licencia', coca);

  -- ── L01 empresas existentes: una licencia en uso cada una; Azyvion ninguna ──
  SELECT count(*) INTO n FROM public.sub_empresas s WHERE s.estado <> 'INTERNAL'
    AND (SELECT count(*) FROM public.licencias l WHERE l.organization_id = s.id AND l.estado = 'ASIGNADA') <> 1;
  SELECT count(*) INTO n2 FROM public.licencias WHERE organization_id = 'org_azyvion_001';
  IF n = 0 AND n2 = 0 THEN pass:=pass+1; res:=res||'L01 PASS | '; ELSE fail:=fail+1; res:=res||'L01 FAIL backfill n='||n||' az='||n2||' | '; END IF;

  -- ── L02 con licencia: acceso normal ───────────────────────────────────
  PERFORM pg_temp.como(coca_adm);
  SELECT count(*) INTO n FROM public."Clientes" WHERE id = cli;
  r := public.mi_licencia();
  IF public.current_user_org_id() = coca AND public.get_my_org_id() = coca AND (SELECT count(*) FROM public.crm_ctx()) = 1
     AND n = 1 AND (r ->> 'vigente')::boolean AND (r ->> 'puede_activar')::boolean
  THEN pass:=pass+1; res:=res||'L02 PASS | '; ELSE fail:=fail+1; res:=res||'L02 FAIL acceso con licencia '||r::text||' | '; END IF;

  -- ── L03 sin licencia: el servidor no entrega ni acepta datos ─────────
  PERFORM pg_temp.servidor();
  UPDATE public.licencias SET estado = 'REVOCADA' WHERE organization_id = coca AND estado = 'ASIGNADA';
  PERFORM pg_temp.como(coca_adm);
  SELECT count(*) INTO n FROM public."Clientes" WHERE id = cli;
  BEGIN INSERT INTO public."Clientes"(id, nombre, organization_id) VALUES (gen_random_uuid(), 'QA intruso', coca); ok := false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  r := public.mi_licencia();
  IF public.current_user_org_id() IS NULL AND public.get_my_org_id() IS NULL AND (SELECT count(*) FROM public.crm_ctx()) = 0
     AND n = 0 AND ok AND NOT (r ->> 'vigente')::boolean AND r ->> 'motivo' = 'SIN_LICENCIA'
     AND r -> 'contacto' ->> 'telefono' = '+502 5145 5610' AND r -> 'contacto' ->> 'correo' = 'ventas@azyvion.com'
  THEN pass:=pass+1; res:=res||'L03 PASS | '; ELSE fail:=fail+1; res:=res||'L03 FAIL bloqueo n='||n||' ins='||ok||' '||r::text||' | '; END IF;

  -- ── L04 vencimiento: ayer bloquea, hoy todavía vale ──────────────────
  PERFORM pg_temp.servidor();
  UPDATE public.licencias SET estado = 'ASIGNADA', vence_en = public.licencia_hoy() - 1 WHERE organization_id = coca AND estado = 'REVOCADA';
  PERFORM pg_temp.como(coca_adm);
  r := public.mi_licencia(); ok := public.current_user_org_id() IS NULL AND r ->> 'motivo' = 'VENCIDA';
  PERFORM pg_temp.servidor();
  UPDATE public.licencias SET vence_en = public.licencia_hoy() WHERE organization_id = coca AND estado = 'ASIGNADA';
  PERFORM pg_temp.como(coca_adm);
  r := public.mi_licencia();
  IF ok AND public.current_user_org_id() = coca AND (r ->> 'dias_restantes')::int = 0 THEN pass:=pass+1; res:=res||'L04 PASS | ';
  ELSE fail:=fail+1; res:=res||'L04 FAIL vencimiento '||r::text||' | '; END IF;

  -- ── L05 Azyvion (interna) no necesita licencia ───────────────────────
  PERFORM pg_temp.como(agt);
  r := public.mi_licencia();
  IF public.current_user_org_id() = 'org_azyvion_001' AND (r ->> 'interna')::boolean AND (SELECT count(*) FROM public.crm_ctx()) = 1
  THEN pass:=pass+1; res:=res||'L05 PASS | '; ELSE fail:=fail+1; res:=res||'L05 FAIL interna | '; END IF;

  -- ── L06 límite de usuarios activos ────────────────────────────────────
  PERFORM pg_temp.servidor();
  SELECT count(*) INTO n FROM public."Usuarios" WHERE organization_id = coca AND COALESCE(activo, true);
  UPDATE public.licencias SET max_usuarios = n + 1, vence_en = NULL WHERE organization_id = coca AND estado = 'ASIGNADA';
  INSERT INTO public."Usuarios"(id, usuario, nombre, rol, organization_id, activo, auth_uid)
  VALUES (vend_id, 'qa_lic_vend', 'QA Vendedor', 'Vendedor', coca, true, vend_uid);       -- llena el cupo
  BEGIN INSERT INTO public."Usuarios"(id, usuario, nombre, rol, organization_id, activo) VALUES (extra_id, 'qa_lic_extra', 'QA Extra', 'Vendedor', coca, true); ok := false;
  EXCEPTION WHEN raise_exception THEN ok := SQLERRM LIKE 'Su licencia permite%'; END;
  INSERT INTO public."Usuarios"(id, usuario, nombre, rol, organization_id, activo) VALUES (extra_id, 'qa_lic_extra', 'QA Extra', 'Vendedor', coca, false); -- inactivo: sí
  BEGIN UPDATE public."Usuarios" SET activo = true WHERE id = extra_id; ok := ok AND false;
  EXCEPTION WHEN raise_exception THEN ok := ok AND true; END;
  UPDATE public."Usuarios" SET nombre = 'QA Vendedor 2' WHERE id = vend_id;                -- editar sin cambiar el cupo: sí
  UPDATE public."Usuarios" SET activo = false WHERE id = vend_id;                          -- libera cupo
  UPDATE public."Usuarios" SET activo = true WHERE id = extra_id;                          -- ahora sí
  IF ok THEN pass:=pass+1; res:=res||'L06 PASS | '; ELSE fail:=fail+1; res:=res||'L06 FAIL límite | '; END IF;
  UPDATE public."Usuarios" SET activo = false WHERE id = extra_id;
  UPDATE public."Usuarios" SET activo = true WHERE id = vend_id;

  -- ── L07 sin licencia no se pueden crear usuarios ─────────────────────
  UPDATE public.licencias SET estado = 'REVOCADA' WHERE organization_id = coca AND estado = 'ASIGNADA';
  BEGIN INSERT INTO public."Usuarios"(usuario, nombre, rol, organization_id, activo) VALUES ('qa_lic_x', 'QA X', 'Vendedor', coca, true); ok := false;
  EXCEPTION WHEN raise_exception THEN ok := SQLERRM LIKE '%no tiene una licencia vigente%ventas@azyvion.com%'; END;
  IF ok THEN pass:=pass+1; res:=res||'L07 PASS | '; ELSE fail:=fail+1; res:=res||'L07 FAIL alta sin licencia | '; END IF;

  -- ── L08 súper admin genera; el admin de la empresa activa (renueva) ──
  PERFORM pg_temp.como(sup);
  r := public.licencia_admin('generar', jsonb_build_object('plan_id', 'plan_pro', 'cantidad', 2, 'notas', 'QA'));
  k1 := r -> 'claves' ->> 0; k2 := r -> 'claves' ->> 1;
  SELECT * INTO lic FROM public.licencias WHERE clave = k1;
  ok := jsonb_array_length(r -> 'claves') = 2 AND k1 ~ '^AZV-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$'
        AND lic.estado = 'DISPONIBLE' AND lic.max_usuarios = 20 AND lic.creada_por IS NOT NULL;
  PERFORM pg_temp.como(coca_adm);
  r := public.licencia_activar(lower(replace(k1, '-', ' ')));           -- tolera minúsculas y espacios
  ok := ok AND public.current_user_org_id() = coca;
  PERFORM pg_temp.servidor();
  SELECT count(*) INTO n FROM public.licencias WHERE organization_id = coca AND estado = 'ASIGNADA' AND clave = k1;
  PERFORM pg_temp.como(coca_adm);
  IF ok AND (r ->> 'vigente')::boolean AND r ->> 'plan' = 'Pro' AND n = 1
  THEN pass:=pass+1; res:=res||'L08 PASS | '; ELSE fail:=fail+1; res:=res||'L08 FAIL generar/activar '||COALESCE(r::text,'∅')||' | '; END IF;

  -- ── L09 una clave usada no sirve otra vez; una clave inventada tampoco ─
  BEGIN PERFORM public.licencia_activar(k1); ok := false; EXCEPTION WHEN no_data_found THEN ok := true; END;
  BEGIN PERFORM public.licencia_activar('AZV-2222-2222-2222'); ok := ok AND false; EXCEPTION WHEN no_data_found THEN ok := ok AND true; END;
  -- al activar la segunda, la primera queda REEMPLAZADA (nunca dos en uso)
  PERFORM public.licencia_activar(k2);
  PERFORM pg_temp.servidor();
  SELECT count(*) INTO n FROM public.licencias WHERE organization_id = coca AND estado = 'ASIGNADA';
  SELECT estado INTO t FROM public.licencias WHERE clave = k1;
  IF ok AND n = 1 AND t = 'REEMPLAZADA' THEN pass:=pass+1; res:=res||'L09 PASS | '; ELSE fail:=fail+1; res:=res||'L09 FAIL reuso n='||n||' t='||t||' | '; END IF;

  -- ── L10 un vendedor no puede activar licencias ───────────────────────
  PERFORM pg_temp.como(vend_uid::text);
  BEGIN PERFORM public.licencia_activar('AZV-2222-2222-2222'); ok := false; EXCEPTION WHEN insufficient_privilege THEN ok := SQLERRM LIKE 'Solo un administrador%'; END;
  r := public.mi_licencia();
  IF ok AND NOT (r ->> 'puede_activar')::boolean THEN pass:=pass+1; res:=res||'L10 PASS | '; ELSE fail:=fail+1; res:=res||'L10 FAIL vendedor | '; END IF;

  -- ── L11 solo el súper admin ve y gestiona licencias ──────────────────
  PERFORM pg_temp.como(coca_adm);
  SELECT count(*) INTO n FROM public.licencias;
  BEGIN PERFORM public.licencia_admin('generar', '{}'::jsonb); ok := false; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  BEGIN UPDATE public.licencias SET estado = 'ASIGNADA'; ok := ok AND false; EXCEPTION WHEN insufficient_privilege THEN ok := ok AND true; END;
  PERFORM pg_temp.como(NULL);
  BEGIN PERFORM public.mi_licencia(); ok := ok AND false; EXCEPTION WHEN insufficient_privilege THEN ok := ok AND true; END;
  BEGIN SELECT count(*) INTO n2 FROM public.licencias; ok := ok AND false; EXCEPTION WHEN insufficient_privilege THEN ok := ok AND true; END;
  IF ok AND n = 0 THEN pass:=pass+1; res:=res||'L11 PASS | '; ELSE fail:=fail+1; res:=res||'L11 FAIL permisos n='||n||' | '; END IF;

  -- ── L12 súper admin: editar, revocar, restaurar, asignar y auditoría ──
  PERFORM pg_temp.como(sup);
  SELECT * INTO lic FROM public.licencias WHERE organization_id = coca AND estado = 'ASIGNADA';
  PERFORM public.licencia_admin('editar', jsonb_build_object('id', lic.id, 'vence_en', (public.licencia_hoy() + 30)::text, 'max_usuarios', 7));
  PERFORM public.licencia_admin('revocar', jsonb_build_object('id', lic.id));
  ok := NOT public.licencia_org_vigente(coca);
  PERFORM public.licencia_admin('restaurar', jsonb_build_object('id', lic.id));
  ok := ok AND public.licencia_org_vigente(coca);
  r := public.licencia_admin('generar', jsonb_build_object('max_usuarios', 3));
  PERFORM public.licencia_admin('asignar', jsonb_build_object('id', (SELECT id FROM public.licencias WHERE clave = r -> 'claves' ->> 0), 'organization_id', coca));
  BEGIN PERFORM public.licencia_admin('restaurar', jsonb_build_object('id', lic.id)); ok := ok AND false; EXCEPTION WHEN OTHERS THEN ok := ok AND true; END;
  PERFORM pg_temp.servidor();
  SELECT * INTO lic FROM public.licencias WHERE id = lic.id;
  SELECT count(*) INTO n FROM public.sub_auditoria WHERE accion LIKE 'Licencia:%' AND fecha > now() - interval '1 minute';
  SELECT max_usuarios INTO n2 FROM public.licencias WHERE organization_id = coca AND estado = 'ASIGNADA';
  IF ok AND lic.estado = 'REEMPLAZADA' AND lic.max_usuarios = 7 AND lic.vence_en = public.licencia_hoy() + 30 AND n >= 4 AND n2 = 3
  THEN pass:=pass+1; res:=res||'L12 PASS | '; ELSE fail:=fail+1; res:=res||'L12 FAIL admin est='||lic.estado||' aud='||n||' | '; END IF;

  -- ── L13 aislamiento entre empresas intacto ───────────────────────────
  PERFORM pg_temp.como(coca_adm);
  SELECT count(*) INTO n FROM public."Prospectos" WHERE organization_id = 'org_azyvion_001';
  SELECT count(*) INTO n2 FROM public."Clientes" WHERE id = cli;
  PERFORM pg_temp.servidor();
  IF n = 0 AND n2 = 1 THEN pass:=pass+1; res:=res||'L13 PASS | '; ELSE fail:=fail+1; res:=res||'L13 FAIL aislamiento n='||n||' | '; END IF;

  -- ── L14 normalización de claves ──────────────────────────────────────
  IF public.licencia_normalizar(' azv-ab12 cd34-EF56 ') = 'AZV-AB12-CD34-EF56' AND public.licencia_normalizar('AZV-123') IS NULL
     AND public.licencia_normalizar(NULL) IS NULL
  THEN pass:=pass+1; res:=res||'L14 PASS | '; ELSE fail:=fail+1; res:=res||'L14 FAIL normalizar | '; END IF;

  RAISE EXCEPTION 'LIC_RESULTS: PASS=% FAIL=% | %', pass, fail, res;
END $s$;
