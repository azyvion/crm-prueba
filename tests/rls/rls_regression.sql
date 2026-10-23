-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Pruebas de regresión RLS / aislamiento multi-tenant
-- Se ejecuta como un único bloque que SIEMPRE termina en RAISE EXCEPTION,
-- de modo que cualquier escritura de prueba se revierte (seguro en producción).
-- El resultado se lee en el mensaje de error: "RLS_RESULTS: PASS=n FAIL=m | ..."
-- Usuarios usados (cuentas de prueba / roles conocidos, no se modifican):
--   AGENTE  test_agente_azyvion 9ed2cc01-79ce-46ed-88c2-000640635e6c (org_azyvion_001)
--   ADMIN   otra empresa        a35d2732-d702-463a-af94-af372753886e (org_concreta_001)
--   ADMIN   auto-registrado     e7887efe-a658-4df2-8a3d-9f3705234adf (coca-cola-muysseyy)
-- ═══════════════════════════════════════════════════════════════════════
DO $rls$
DECLARE
  res text := ''; pass int := 0; fail int := 0;
  n bigint; ok boolean; v text;
  hector_usuario_id uuid := 'd5eeea11-c118-4d36-aab4-3abb47fed8d5';
  agente_uid  text := '9ed2cc01-79ce-46ed-88c2-000640635e6c';
  concreta_uid text := 'a35d2732-d702-463a-af94-af372753886e';
  selfreg_uid text := 'e7887efe-a658-4df2-8a3d-9f3705234adf';
  total_azy_clientes bigint;

BEGIN
  SELECT count(*) INTO total_azy_clientes FROM public."Clientes" WHERE organization_id='org_azyvion_001';

  -- helper inline: act as a role/user
  -- ── T01 anon no lee datos de negocio ──
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  SELECT (SELECT count(*) FROM public."Clientes") + (SELECT count(*) FROM public."Prospectos")
       + (SELECT count(*) FROM public."Cotizaciones") + (SELECT count(*) FROM public."Transacciones")
       + (SELECT count(*) FROM public."Inventario") + (SELECT count(*) FROM public."Actividad") INTO n;
  IF n = 0 THEN pass:=pass+1; res:=res||'T01 PASS | '; ELSE fail:=fail+1; res:=res||'T01 FAIL anon_rows='||n||' | '; END IF;

  -- ── T02 anon no lee preguntas de encuestas directamente ──
  SELECT count(*) INTO n FROM public.encuesta_preguntas;
  IF n = 0 THEN pass:=pass+1; res:=res||'T02 PASS | '; ELSE fail:=fail+1; res:=res||'T02 FAIL rows='||n||' | '; END IF;

  -- ── T03 encuesta pública sigue funcionando por RPC (con opciones) ──
  SELECT (public.get_public_survey('ed4950ef-7464-43a7-9929-7dfd582aa3a2')->'questions'->0) ? 'opciones' INTO ok;
  IF ok THEN pass:=pass+1; res:=res||'T03 PASS | '; ELSE fail:=fail+1; res:=res||'T03 FAIL | '; END IF;

  -- ── T04 anon no puede ejecutar admin_create_usuario_profile ──
  BEGIN
    PERFORM public.admin_create_usuario_profile(agente_uid::uuid, agente_uid::uuid,'x','x','Agente','x','','','org_azyvion_001');
    fail:=fail+1; res:=res||'T04 FAIL ejecutó | ';
  EXCEPTION WHEN insufficient_privilege THEN pass:=pass+1; res:=res||'T04 PASS | ';
            WHEN OTHERS THEN fail:=fail+1; res:=res||'T04 FAIL '||SQLSTATE||' | ';
  END;
  RESET ROLE;

  -- ── T05 AGENTE ve los clientes de su organización (caso positivo) ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agente_uid,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public."Clientes";
  IF n = total_azy_clientes AND n > 0 THEN pass:=pass+1; res:=res||'T05 PASS | '; ELSE fail:=fail+1; res:=res||'T05 FAIL ve='||n||' esperado='||total_azy_clientes||' | '; END IF;

  -- ── T06 AGENTE no puede modificar al ADMIN de su empresa ──
  UPDATE public."Usuarios" SET activo = false WHERE id = hector_usuario_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN pass:=pass+1; res:=res||'T06 PASS | '; ELSE fail:=fail+1; res:=res||'T06 FAIL updated='||n||' | '; END IF;

  -- ── T07 AGENTE no puede borrar usuarios ──
  DELETE FROM public."Usuarios" WHERE id = hector_usuario_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN pass:=pass+1; res:=res||'T07 PASS | '; ELSE fail:=fail+1; res:=res||'T07 FAIL deleted='||n||' | '; END IF;

  -- ── T08 AGENTE sí puede actualizar sus propias preferencias ──
  UPDATE public."Usuarios" SET tema = tema WHERE auth_uid = agente_uid::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN pass:=pass+1; res:=res||'T08 PASS | '; ELSE fail:=fail+1; res:=res||'T08 FAIL updated='||n||' | '; END IF;

  -- ── T09 AGENTE no puede subir logo a nombre de otra empresa ──
  BEGIN
    INSERT INTO storage.objects(bucket_id, name, owner) VALUES ('logos-empresa','logo_org_org_concreta_001_qa.png', agente_uid::uuid);
    fail:=fail+1; res:=res||'T09 FAIL insertó | ';
  EXCEPTION WHEN insufficient_privilege THEN pass:=pass+1; res:=res||'T09 PASS | ';
            WHEN OTHERS THEN fail:=fail+1; res:=res||'T09 FAIL '||SQLSTATE||' '||SQLERRM||' | ';
  END;

  -- ── T10 AGENTE sí puede subir logo de su propia empresa ──
  BEGIN
    INSERT INTO storage.objects(bucket_id, name, owner) VALUES ('logos-empresa','logo_org_org_azyvion_001_qa.png', agente_uid::uuid);
    pass:=pass+1; res:=res||'T10 PASS | ';
  EXCEPTION WHEN OTHERS THEN fail:=fail+1; res:=res||'T10 FAIL '||SQLSTATE||' '||SQLERRM||' | ';
  END;
  RESET ROLE;

  -- ── T11 ADMIN de otra empresa no ve ni modifica datos de Azyvion ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub',concreta_uid,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public."Clientes" WHERE organization_id='org_azyvion_001';
  IF n = 0 THEN pass:=pass+1; res:=res||'T11 PASS | '; ELSE fail:=fail+1; res:=res||'T11 FAIL ve='||n||' | '; END IF;
  UPDATE public."Clientes" SET organization_id = organization_id WHERE organization_id='org_azyvion_001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN pass:=pass+1; res:=res||'T12 PASS | '; ELSE fail:=fail+1; res:=res||'T12 FAIL updated='||n||' | '; END IF;
  SELECT count(*) INTO n FROM public."Usuarios" WHERE organization_id='org_azyvion_001';
  IF n = 0 THEN pass:=pass+1; res:=res||'T13 PASS | '; ELSE fail:=fail+1; res:=res||'T13 FAIL ve_usuarios='||n||' | '; END IF;
  RESET ROLE;

  -- ── T14 ADMIN auto-registrado obtiene organización vía user_roles ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub',selfreg_uid,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT public.get_my_org_id() INTO v;
  IF v = 'coca-cola-muysseyy' THEN pass:=pass+1; res:=res||'T14 PASS | '; ELSE fail:=fail+1; res:=res||'T14 FAIL org='||coalesce(v,'NULL')||' | '; END IF;
  RESET ROLE;

  RAISE EXCEPTION 'RLS_RESULTS: PASS=% FAIL=% | %', pass, fail, res;
END
$rls$;

-- ═══ Bloque 2: casos positivos de ADMIN y encuestas (añadido tras aplicar la migración) ═══
DO $x$
DECLARE res text := ''; pass int := 0; fail int := 0; n bigint; qid text;
 hector text := 'c4477277-66a8-4a3f-8379-38b3b72eafed';
 agente text := '9ed2cc01-79ce-46ed-88c2-000640635e6c';
 concreta text := 'a35d2732-d702-463a-af94-af372753886e';
BEGIN
 SELECT id::text INTO qid FROM public.encuesta_preguntas WHERE encuesta_id='96371cc3-3790-4dc3-8f3b-a7bc9138825f' ORDER BY orden LIMIT 1;
 -- T15 authenticated no ejecuta admin_create_usuario_profile
 PERFORM set_config('request.jwt.claims', json_build_object('sub',agente,'role','authenticated')::text, true);
 SET LOCAL ROLE authenticated;
 BEGIN PERFORM public.admin_create_usuario_profile(agente::uuid, agente::uuid,'x','x','Agente','x','','','org_azyvion_001');
   fail:=fail+1; res:=res||'T15 FAIL | ';
 EXCEPTION WHEN insufficient_privilege THEN pass:=pass+1; res:=res||'T15 PASS | '; WHEN OTHERS THEN fail:=fail+1; res:=res||'T15 FAIL '||SQLSTATE||' | '; END;
 -- T16 agente no puede subirse el rol legacy
 BEGIN UPDATE public."Usuarios" SET rol='Admin' WHERE auth_uid=agente::uuid;
   fail:=fail+1; res:=res||'T16 FAIL | ';
 EXCEPTION WHEN OTHERS THEN pass:=pass+1; res:=res||'T16 PASS | '; END;
 RESET ROLE;
 -- T17 ADMIN edita usuarios de su org / T18 ve la encuesta Freelancer (6 envíos)
 PERFORM set_config('request.jwt.claims', json_build_object('sub',hector,'role','authenticated')::text, true);
 SET LOCAL ROLE authenticated;
 UPDATE public."Usuarios" SET cargo = cargo WHERE auth_uid = agente::uuid;
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n=1 THEN pass:=pass+1; res:=res||'T17 PASS | '; ELSE fail:=fail+1; res:=res||'T17 FAIL n='||n||' | '; END IF;
 SELECT count(*) INTO n FROM public.encuesta_envios WHERE encuesta_id='96371cc3-3790-4dc3-8f3b-a7bc9138825f';
 IF n>=6 THEN pass:=pass+1; res:=res||'T18 PASS | '; ELSE fail:=fail+1; res:=res||'T18 FAIL n='||n||' | '; END IF;
 RESET ROLE;
 -- T19 otra empresa no ve esos envíos
 PERFORM set_config('request.jwt.claims', json_build_object('sub',concreta,'role','authenticated')::text, true);
 SET LOCAL ROLE authenticated;
 SELECT count(*) INTO n FROM public.encuesta_envios WHERE encuesta_id='96371cc3-3790-4dc3-8f3b-a7bc9138825f';
 IF n=0 THEN pass:=pass+1; res:=res||'T19 PASS | '; ELSE fail:=fail+1; res:=res||'T19 FAIL n='||n||' | '; END IF;
 RESET ROLE;
 -- T20 envío público anónimo funciona y queda en la org correcta (se revierte)
 PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
 SET LOCAL ROLE anon;
 PERFORM public.submit_public_survey('ed4950ef-7464-43a7-9929-7dfd582aa3a2','QA_TMP','','QA', jsonb_build_object(qid,'ok'));
 RESET ROLE;
 SELECT count(*) INTO n FROM public.encuesta_envios WHERE nombre_candidato='QA_TMP' AND organization_id='org_azyvion_001';
 IF n=1 THEN pass:=pass+1; res:=res||'T20 PASS | '; ELSE fail:=fail+1; res:=res||'T20 FAIL n='||n||' | '; END IF;
 RAISE EXCEPTION 'EXTRA_RESULTS: PASS=% FAIL=% | %', pass, fail, res;
END $x$;
