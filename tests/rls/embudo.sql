-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Regresión Lote 8: embudo de ventas (etapa Ganado, motivo de pérdida,
-- fecha de cierre y conversión atómica a cliente). Requiere 09 y 10. Datos sintéticos;
-- SIEMPRE termina en RAISE EXCEPTION (todo se revierte). Resultado: "EMB_RESULTS: PASS=n FAIL=m".
-- ═══════════════════════════════════════════════════════════════════════
DO $s$
DECLARE
  res text := ''; pass int := 0; fail int := 0; ok boolean; r jsonb; n int; n2 int; p public."Prospectos"; c public."Clientes";
  org text := 'org_azyvion_001';
  agt text := '9ed2cc01-79ce-46ed-88c2-000640635e6c';
  u_agt text; org_otra text; legado uuid;
  pr uuid := gen_random_uuid(); pr2 uuid := gen_random_uuid(); ajeno uuid := gen_random_uuid();
BEGIN
  SELECT usuario INTO u_agt FROM public."Usuarios" WHERE auth_uid::text = agt;
  SELECT organization_id INTO org_otra FROM public."Usuarios" WHERE organization_id <> org AND organization_id IS NOT NULL LIMIT 1;
  SELECT id INTO legado FROM public."Prospectos" WHERE organization_id = org AND etapa = 'Perdido' AND motivo_perdida IS NULL LIMIT 1;
  -- Prospecto de otra empresa (creado sin RLS, como lo haría esa empresa)
  IF org_otra IS NOT NULL THEN
    INSERT INTO public."Prospectos"(id, nombre, etapa, organization_id) VALUES (ajeno, 'QA ajeno', 'Nuevo', org_otra);
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- ── E01 alta abierta con fecha de cierre estimada ────────────────────
  INSERT INTO public."Prospectos"(id, nombre, empresa, etapa, "valorEstimado", probabilidad, fecha_cierre_estimada, motivo_perdida, organization_id)
  VALUES (pr, 'QA Embudo', 'QA SA', 'Propuesta', 5000, 60, current_date + 20, 'Precio', org);
  SELECT * INTO p FROM public."Prospectos" WHERE id = pr;
  IF p.fecha_cierre_estimada = current_date + 20 AND p.cerrado_en IS NULL AND p.motivo_perdida IS NULL AND p.probabilidad = 60
  THEN pass:=pass+1; res:=res||'E01 PASS | '; ELSE fail:=fail+1; res:=res||'E01 FAIL alta abierta | '; END IF;

  -- ── E02 pasar a Perdido sin motivo se rechaza ────────────────────────
  BEGIN UPDATE public."Prospectos" SET etapa = 'Perdido' WHERE id = pr; ok := false;
  EXCEPTION WHEN check_violation THEN ok := SQLERRM LIKE '%motivo%'; END;
  BEGIN UPDATE public."Prospectos" SET etapa = 'Perdido', motivo_perdida = '   ' WHERE id = pr; ok := ok AND false;
  EXCEPTION WHEN check_violation THEN ok := ok AND true; END;
  IF ok THEN pass:=pass+1; res:=res||'E02 PASS | '; ELSE fail:=fail+1; res:=res||'E02 FAIL perdido sin motivo | '; END IF;

  -- ── E03 Perdido con motivo: fija cierre, autor y probabilidad 0 ──────
  UPDATE public."Prospectos" SET etapa = 'Perdido', motivo_perdida = 'Precio', motivo_perdida_detalle = 'Competencia 10% más barata' WHERE id = pr;
  SELECT * INTO p FROM public."Prospectos" WHERE id = pr;
  IF p.cerrado_en IS NOT NULL AND p.cerrado_por = u_agt AND p.probabilidad = 0 AND p.motivo_perdida = 'Precio'
  THEN pass:=pass+1; res:=res||'E03 PASS | '; ELSE fail:=fail+1; res:=res||'E03 FAIL cierre perdido por='||COALESCE(p.cerrado_por,'∅')||' prob='||p.probabilidad||' | '; END IF;

  -- ── E04 reabrir limpia cierre y motivo ───────────────────────────────
  UPDATE public."Prospectos" SET etapa = 'Negociación', probabilidad = 80 WHERE id = pr;
  SELECT * INTO p FROM public."Prospectos" WHERE id = pr;
  IF p.cerrado_en IS NULL AND p.motivo_perdida IS NULL AND p.motivo_perdida_detalle IS NULL AND p.probabilidad = 80
  THEN pass:=pass+1; res:=res||'E04 PASS | '; ELSE fail:=fail+1; res:=res||'E04 FAIL reabrir | '; END IF;

  -- ── E05 un Perdido anterior (sin motivo) se puede seguir editando ────
  IF legado IS NOT NULL THEN
    UPDATE public."Prospectos" SET notas = COALESCE(notas, '') || ' QA' WHERE id = legado;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 1 THEN pass:=pass+1; res:=res||'E05 PASS | '; ELSE fail:=fail+1; res:=res||'E05 FAIL legado n='||n||' | '; END IF;
  ELSE res := res || 'E05 SKIP | '; END IF;

  -- ── E06 etapa y probabilidad inválidas ───────────────────────────────
  BEGIN UPDATE public."Prospectos" SET etapa = 'Casi ganado' WHERE id = pr; ok := false; EXCEPTION WHEN check_violation THEN ok := true; END;
  BEGIN UPDATE public."Prospectos" SET probabilidad = 150 WHERE id = pr; ok := ok AND false; EXCEPTION WHEN check_violation THEN ok := ok AND true; END;
  BEGIN UPDATE public."Prospectos" SET "valorEstimado" = -1 WHERE id = pr; ok := ok AND false; EXCEPTION WHEN check_violation THEN ok := ok AND true; END;
  IF ok THEN pass:=pass+1; res:=res||'E06 PASS | '; ELSE fail:=fail+1; res:=res||'E06 FAIL validaciones | '; END IF;

  -- ── E07 convertir: crea el cliente y conserva el prospecto como Ganado ─
  r := public.crm_convertir_prospecto(pr, 'Premium', 'Activo', 4800);
  SELECT * INTO p FROM public."Prospectos" WHERE id = pr;
  SELECT * INTO c FROM public."Clientes" WHERE id = (r ->> 'cliente_id')::uuid;
  IF p.etapa = 'Ganado' AND p."clienteId" = c.id AND p.probabilidad = 100 AND p.cerrado_en IS NOT NULL AND p."valorEstimado" = 4800
     AND c."prospectoOrigenId" = pr AND c.organization_id = org AND c.segmento = 'Premium' AND c."valorTotal" = 4800
  THEN pass:=pass+1; res:=res||'E07 PASS | '; ELSE fail:=fail+1; res:=res||'E07 FAIL convertir '||COALESCE(r::text,'∅')||' | '; END IF;

  -- ── E08 no se puede convertir dos veces ──────────────────────────────
  BEGIN PERFORM public.crm_convertir_prospecto(pr); ok := false; EXCEPTION WHEN unique_violation THEN ok := true; END;
  SELECT count(*) INTO n FROM public."Clientes" WHERE "prospectoOrigenId" = pr;
  IF ok AND n = 1 THEN pass:=pass+1; res:=res||'E08 PASS | '; ELSE fail:=fail+1; res:=res||'E08 FAIL doble conversión n='||n||' | '; END IF;

  -- ── E09 estado inválido: no crea nada (atómico) ──────────────────────
  INSERT INTO public."Prospectos"(id, nombre, etapa, organization_id) VALUES (pr2, 'QA Embudo 2', 'Calificado', org);
  BEGIN PERFORM public.crm_convertir_prospecto(pr2, NULL, 'Borrado'); ok := false; EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  SELECT count(*) INTO n FROM public."Clientes" WHERE "prospectoOrigenId" = pr2;
  SELECT * INTO p FROM public."Prospectos" WHERE id = pr2;
  IF ok AND n = 0 AND p.etapa = 'Calificado' THEN pass:=pass+1; res:=res||'E09 PASS | '; ELSE fail:=fail+1; res:=res||'E09 FAIL atomicidad | '; END IF;

  -- ── E10 Ganado a mano: probabilidad 100 y sin motivo ─────────────────
  UPDATE public."Prospectos" SET etapa = 'Ganado', motivo_perdida = 'Precio', probabilidad = 30 WHERE id = pr2;
  SELECT * INTO p FROM public."Prospectos" WHERE id = pr2;
  IF p.probabilidad = 100 AND p.motivo_perdida IS NULL AND p.cerrado_en IS NOT NULL AND p."clienteId" IS NULL
  THEN pass:=pass+1; res:=res||'E10 PASS | '; ELSE fail:=fail+1; res:=res||'E10 FAIL ganado manual | '; END IF;

  -- ── E11 aislamiento: no ve ni convierte prospectos de otra empresa ───
  IF org_otra IS NOT NULL THEN
    SELECT count(*) INTO n FROM public."Prospectos" WHERE id = ajeno;
    BEGIN PERFORM public.crm_convertir_prospecto(ajeno); ok := false; EXCEPTION WHEN no_data_found THEN ok := true; END;
    UPDATE public."Prospectos" SET etapa = 'Perdido', motivo_perdida = 'QA' WHERE id = ajeno;
    RESET ROLE;
    SELECT * INTO p FROM public."Prospectos" WHERE id = ajeno;
    SELECT count(*) INTO n2 FROM public."Clientes" WHERE "prospectoOrigenId" = ajeno;
    IF n = 0 AND ok AND p.etapa = 'Nuevo' AND n2 = 0 THEN pass:=pass+1; res:=res||'E11 PASS | '; ELSE fail:=fail+1; res:=res||'E11 FAIL aislamiento | '; END IF;
  ELSE RESET ROLE; res := res || 'E11 SKIP | '; END IF;

  -- ── E12 anon no puede convertir ──────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN PERFORM public.crm_convertir_prospecto(pr2); ok := false; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  IF ok THEN pass:=pass+1; res:=res||'E12 PASS | '; ELSE fail:=fail+1; res:=res||'E12 FAIL anon | '; END IF;

  RAISE EXCEPTION 'EMB_RESULTS: PASS=% FAIL=% | %', pass, fail, res;
END $s$;
