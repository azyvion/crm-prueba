-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Regresión Lote 2: Organizations, credenciales FEL, Usuarios INSERT
-- Siempre termina en RAISE EXCEPTION → todo se revierte (seguro en producción).
-- Resultado: "LOTE2_RESULTS: PASS=n FAIL=m | ..."
-- Cuentas (no se modifican): AGENTE azyvion 9ed2cc01…, ADMIN coca-cola e7887efe…,
--   ADMIN concreta a35d2732…
-- ═══════════════════════════════════════════════════════════════════════
DO $l2$
DECLARE
  res text := ''; pass int := 0; fail int := 0; n bigint; j jsonb; v text;
  agente  text := '9ed2cc01-79ce-46ed-88c2-000640635e6c';
  cocaadm text := 'e7887efe-a658-4df2-8a3d-9f3705234adf';
  concreta text := 'a35d2732-d702-463a-af94-af372753886e';
BEGIN
  -- ── AGENTE (miembro sin privilegios) ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agente,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public."Organizations";
  IF n = 1 THEN pass:=pass+1; res:=res||'F01 PASS | '; ELSE fail:=fail+1; res:=res||'F01 FAIL ve='||n||' | '; END IF;
  UPDATE public."Organizations" SET nombre = nombre;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN pass:=pass+1; res:=res||'F02 PASS | '; ELSE fail:=fail+1; res:=res||'F02 FAIL updated='||n||' | '; END IF;
  j := public.get_fel_credentials_status(NULL);
  IF (j->>'authorized')::boolean = false THEN pass:=pass+1; res:=res||'F03 PASS | '; ELSE fail:=fail+1; res:=res||'F03 FAIL | '; END IF;
  BEGIN
    PERFORM public.set_fel_credentials('org_azyvion_001','u','KEYKEYKEY1');
    fail:=fail+1; res:=res||'F04 FAIL guardó | ';
  EXCEPTION WHEN insufficient_privilege THEN pass:=pass+1; res:=res||'F04 PASS | ';
            WHEN OTHERS THEN fail:=fail+1; res:=res||'F04 FAIL '||SQLSTATE||' | ';
  END;
  BEGIN
    SELECT count(*) INTO n FROM public.org_fel_secrets;
    fail:=fail+1; res:=res||'F12 FAIL leyó | ';
  EXCEPTION WHEN insufficient_privilege THEN pass:=pass+1; res:=res||'F12 PASS | ';
  END;
  RESET ROLE;

  -- ── ADMIN de coca-cola ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub',cocaadm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  j := public.set_fel_credentials('coca-cola-muysseyy','qa_user','QASECRET12345');
  IF (j->>'has_api_key')::boolean AND j->>'api_key_hint' = '••••2345' AND NOT (j::text LIKE '%QASECRET%')
    THEN pass:=pass+1; res:=res||'F05 PASS | '; ELSE fail:=fail+1; res:=res||'F05 FAIL '||j::text||' | '; END IF;
  SELECT fel_api_key INTO v FROM public."Organizations" WHERE id='coca-cola-muysseyy';
  IF v IS NULL THEN pass:=pass+1; res:=res||'F06 PASS | '; ELSE fail:=fail+1; res:=res||'F06 FAIL | '; END IF;
  BEGIN
    PERFORM public.set_fel_credentials('org_azyvion_001','x','XXXXXXXXXX');
    fail:=fail+1; res:=res||'F07 FAIL guardó en otra org | ';
  EXCEPTION WHEN insufficient_privilege THEN pass:=pass+1; res:=res||'F07 PASS | ';
  END;
  BEGIN
    UPDATE public."Organizations" SET fel_api_key='ZZZZZZZZZZ' WHERE id='org_azyvion_001';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN pass:=pass+1; res:=res||'F19 PASS | '; ELSE fail:=fail+1; res:=res||'F19 FAIL | '; END IF;
  EXCEPTION WHEN insufficient_privilege THEN pass:=pass+1; res:=res||'F19 PASS | ';
  END;
  -- ruta heredada (frontend antiguo escribe en Organizations)
  UPDATE public."Organizations" SET fel_api_key='LEGACYKEY999' WHERE id='coca-cola-muysseyy';
  SELECT fel_api_key INTO v FROM public."Organizations" WHERE id='coca-cola-muysseyy';
  j := public.get_fel_credentials_status(NULL);
  IF v IS NULL AND j->>'api_key_hint'='••••Y999' THEN pass:=pass+1; res:=res||'F09 PASS | '; ELSE fail:=fail+1; res:=res||'F09 FAIL '||j::text||' | '; END IF;
  -- '' no borra el secreto
  UPDATE public."Organizations" SET fel_api_key='' WHERE id='coca-cola-muysseyy';
  j := public.get_fel_credentials_status(NULL);
  IF (j->>'has_api_key')::boolean THEN pass:=pass+1; res:=res||'F16 PASS | '; ELSE fail:=fail+1; res:=res||'F16 FAIL | '; END IF;
  UPDATE public."Organizations" SET iva_modalidad='sobre' WHERE id='coca-cola-muysseyy';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN pass:=pass+1; res:=res||'F13 PASS | '; ELSE fail:=fail+1; res:=res||'F13 FAIL n='||n||' | '; END IF;
  BEGIN
    INSERT INTO public."Usuarios"(usuario,nombre,rol,organization_id,auth_uid)
    VALUES ('qa_tmp_l2_a','QA','Agente','coca-cola-muysseyy', agente::uuid);
    fail:=fail+1; res:=res||'F14 FAIL insertó auth_uid ajeno | ';
  EXCEPTION WHEN OTHERS THEN pass:=pass+1; res:=res||'F14 PASS | ';
  END;
  BEGIN
    INSERT INTO public."Usuarios"(usuario,nombre,rol,organization_id)
    VALUES ('qa_tmp_l2_b','QA','Admin','coca-cola-muysseyy');
    fail:=fail+1; res:=res||'F15 FAIL creó Admin | ';
  EXCEPTION WHEN OTHERS THEN pass:=pass+1; res:=res||'F15 PASS | ';
  END;
  BEGIN
    INSERT INTO public."Usuarios"(usuario,nombre,rol,organization_id)
    VALUES ('qa_tmp_l2_c','QA','Agente','coca-cola-muysseyy');
    pass:=pass+1; res:=res||'F17 PASS | ';
  EXCEPTION WHEN OTHERS THEN fail:=fail+1; res:=res||'F17 FAIL '||SQLERRM||' | ';
  END;
  RESET ROLE;

  -- ── ADMIN de otra empresa no ve configuración ajena ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub',concreta,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public."Organizations" WHERE id='coca-cola-muysseyy';
  j := public.get_fel_credentials_status('coca-cola-muysseyy');
  IF n = 0 AND (j->>'authorized')::boolean = false THEN pass:=pass+1; res:=res||'F08 PASS | '; ELSE fail:=fail+1; res:=res||'F08 FAIL n='||n||' | '; END IF;
  UPDATE public."Organizations" SET nombre='hack' WHERE id='coca-cola-muysseyy';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN pass:=pass+1; res:=res||'F10 PASS | '; ELSE fail:=fail+1; res:=res||'F10 FAIL | '; END IF;
  RESET ROLE;

  -- ── anon ──
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO n FROM public."Organizations";
    IF n = 0 THEN pass:=pass+1; res:=res||'F11 PASS | '; ELSE fail:=fail+1; res:=res||'F11 FAIL n='||n||' | '; END IF;
  EXCEPTION WHEN insufficient_privilege THEN pass:=pass+1; res:=res||'F11 PASS | ';
  END;
  BEGIN
    PERFORM public.get_fel_credentials_status(NULL);
    fail:=fail+1; res:=res||'F18 FAIL anon ejecutó | ';
  EXCEPTION WHEN insufficient_privilege THEN pass:=pass+1; res:=res||'F18 PASS | ';
  END;
  RESET ROLE;

  RAISE EXCEPTION 'LOTE2_RESULTS: PASS=% FAIL=% | %', pass, fail, res;
END
$l2$;
