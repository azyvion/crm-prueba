-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Regresión FN-19: descuento atómico de inventario (pos_mover_stock)
-- Usa productos sintéticos creados dentro del bloque; siempre termina en
-- RAISE EXCEPTION → todo se revierte (seguro en producción).
-- ═══════════════════════════════════════════════════════════════════════
DO $s$
DECLARE res text := ''; pass int := 0; fail int := 0; n int; v numeric;
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  agente text := '9ed2cc01-79ce-46ed-88c2-000640635e6c';
  concreta text := 'a35d2732-d702-463a-af94-af372753886e';
BEGIN
  INSERT INTO public."Inventario"(id, producto, tipo, unidades, "stockMax", organization_id)
  VALUES (p1, 'QA stock A', 'Producto', 10, 100, 'org_azyvion_001'),
         (p2, 'QA stock B', 'Producto', 5, 100, 'org_azyvion_001');

  PERFORM set_config('request.jwt.claims', json_build_object('sub',agente,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- S01 dos líneas del mismo producto se agrupan
  n := public.pos_mover_stock(jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1), jsonb_build_object('id',p1,'cantidad',2)));
  SELECT unidades INTO v FROM public."Inventario" WHERE id=p1;
  IF n=1 AND v=7 THEN pass:=pass+1; res:=res||'S01 PASS | '; ELSE fail:=fail+1; res:=res||'S01 FAIL n='||n||' v='||coalesce(v::text,'null')||' | '; END IF;
  -- S02 sobreventa: no descuenta nada (tampoco el otro producto)
  BEGIN
    PERFORM public.pos_mover_stock(jsonb_build_array(jsonb_build_object('id',p2,'cantidad',1), jsonb_build_object('id',p1,'cantidad',8)));
    fail:=fail+1; res:=res||'S02 FAIL sobreventa aceptada | ';
  EXCEPTION WHEN raise_exception THEN
    SELECT unidades INTO v FROM public."Inventario" WHERE id=p2;
    IF v=5 THEN pass:=pass+1; res:=res||'S02 PASS | '; ELSE fail:=fail+1; res:=res||'S02 FAIL descuento parcial | '; END IF;
  END;
  -- S03 devolución (compensación)
  n := public.pos_mover_stock(jsonb_build_array(jsonb_build_object('id',p1,'cantidad',3)), true);
  SELECT unidades INTO v FROM public."Inventario" WHERE id=p1;
  IF v=10 THEN pass:=pass+1; res:=res||'S03 PASS | '; ELSE fail:=fail+1; res:=res||'S03 FAIL v='||coalesce(v::text,'null')||' | '; END IF;
  -- S04 cantidad negativa rechazada
  BEGIN
    PERFORM public.pos_mover_stock(jsonb_build_array(jsonb_build_object('id',p1,'cantidad',-5)));
    fail:=fail+1; res:=res||'S04 FAIL negativo aceptado | ';
  EXCEPTION WHEN invalid_parameter_value THEN pass:=pass+1; res:=res||'S04 PASS | ';
  END;
  -- S05 vender exactamente la existencia deja 0
  n := public.pos_mover_stock(jsonb_build_array(jsonb_build_object('id',p2,'cantidad',5)));
  SELECT unidades INTO v FROM public."Inventario" WHERE id=p2;
  IF v=0 THEN pass:=pass+1; res:=res||'S05 PASS | '; ELSE fail:=fail+1; res:=res||'S05 FAIL v='||coalesce(v::text,'null')||' | '; END IF;
  RESET ROLE;
  -- S06 otra organización no puede descontar inventario ajeno
  PERFORM set_config('request.jwt.claims', json_build_object('sub',concreta,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.pos_mover_stock(jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)));
    fail:=fail+1; res:=res||'S06 FAIL otra org descontó | ';
  EXCEPTION WHEN raise_exception THEN pass:=pass+1; res:=res||'S06 PASS | ';
  END;
  RESET ROLE;
  SELECT unidades INTO v FROM public."Inventario" WHERE id=p1;
  IF v=10 THEN pass:=pass+1; res:=res||'S07 PASS | '; ELSE fail:=fail+1; res:=res||'S07 FAIL v='||coalesce(v::text,'null')||' | '; END IF;
  -- S08 anon sin acceso
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.pos_mover_stock(jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)));
    fail:=fail+1; res:=res||'S08 FAIL anon | ';
  EXCEPTION WHEN insufficient_privilege THEN pass:=pass+1; res:=res||'S08 PASS | ';
  END;
  RESET ROLE;
  RAISE EXCEPTION 'STOCK_RESULTS: PASS=% FAIL=% | %', pass, fail, res;
END $s$;
