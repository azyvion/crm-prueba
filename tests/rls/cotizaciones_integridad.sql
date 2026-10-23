-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Regresión: integridad de cotizaciones (FN-17, FN-18)
-- Siempre termina en RAISE EXCEPTION → todo se revierte (seguro en producción).
-- Resultado: "COT_RESULTS: PASS=n FAIL=m | ..."
-- ═══════════════════════════════════════════════════════════════════════
DO $q$
DECLARE res text := ''; pass int := 0; fail int := 0; n int; cid uuid; before int; s numeric;
  agente text := '9ed2cc01-79ce-46ed-88c2-000640635e6c';
  concreta text := 'a35d2732-d702-463a-af94-af372753886e';
BEGIN
  SELECT c.id INTO cid FROM public."Cotizaciones" c WHERE c.organization_id='org_azyvion_001'
    AND EXISTS (SELECT 1 FROM public."CotizacionItems" i WHERE i."cotizacionId"=c.id) LIMIT 1;
  SELECT count(*) INTO before FROM public."CotizacionItems" WHERE "cotizacionId"=cid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agente,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  n := public.replace_cotizacion_items(cid, '[{"descripcion":"A","cantidad":3,"precioUnit":10.005,"descuentoPct":10,"total":999},{"descripcion":"B","tipo":"Servicio","cantidad":1,"precioUnit":100}]'::jsonb);
  SELECT sum(total) INTO s FROM public."CotizacionItems" WHERE "cotizacionId"=cid;
  -- A: 3*10.005=30.015 *0.9 = 27.0135 -> 27.01 ; B: 100 -> 127.01 (el 999 del cliente se ignora)
  IF n=2 AND s=127.01 THEN pass:=pass+1; res:=res||'Q01 PASS | '; ELSE fail:=fail+1; res:=res||'Q01 FAIL n='||n||' s='||s||' | '; END IF;
  BEGIN
    PERFORM public.replace_cotizacion_items(cid, '[{"descripcion":"X","cantidad":0,"precioUnit":5}]'::jsonb);
    fail:=fail+1; res:=res||'Q02 FAIL aceptó cantidad 0 | ';
  EXCEPTION WHEN invalid_parameter_value THEN pass:=pass+1; res:=res||'Q02 PASS | ';
  END;
  SELECT count(*) INTO n FROM public."CotizacionItems" WHERE "cotizacionId"=cid;
  IF n=2 THEN pass:=pass+1; res:=res||'Q03 PASS | '; ELSE fail:=fail+1; res:=res||'Q03 FAIL n='||n||' | '; END IF;
  BEGIN
    PERFORM public.replace_cotizacion_items(cid, '[]'::jsonb);
    fail:=fail+1; res:=res||'Q04 FAIL | ';
  EXCEPTION WHEN invalid_parameter_value THEN pass:=pass+1; res:=res||'Q04 PASS | ';
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',concreta,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.replace_cotizacion_items(cid, '[{"descripcion":"hack","cantidad":1,"precioUnit":1}]'::jsonb);
    fail:=fail+1; res:=res||'Q05 FAIL otra org modificó | ';
  EXCEPTION WHEN no_data_found THEN pass:=pass+1; res:=res||'Q05 PASS | ';
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.replace_cotizacion_items(cid, '[{"descripcion":"x","cantidad":1,"precioUnit":1}]'::jsonb);
    fail:=fail+1; res:=res||'Q06 FAIL anon | ';
  EXCEPTION WHEN insufficient_privilege THEN pass:=pass+1; res:=res||'Q06 PASS | ';
  END;
  RESET ROLE;
  BEGIN
    INSERT INTO public."Cotizaciones"(id, numero, cliente, organization_id)
    SELECT gen_random_uuid(), numero, 'dup', organization_id FROM public."Cotizaciones" WHERE id=cid;
    fail:=fail+1; res:=res||'Q07 FAIL número duplicado aceptado | ';
  EXCEPTION WHEN unique_violation THEN pass:=pass+1; res:=res||'Q07 PASS | ';
  END;
  RAISE EXCEPTION 'COT_RESULTS: PASS=% FAIL=% | items_antes=% | %', pass, fail, before, res;
END $q$;
