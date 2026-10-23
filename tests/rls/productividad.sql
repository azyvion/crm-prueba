-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Regresión Lote 7: tareas, plantillas, ventas pendientes POS, auditoría general,
-- metas e importación CSV. Requiere 06, 07, 08 y 09. Datos sintéticos; SIEMPRE termina en
-- RAISE EXCEPTION (todo se revierte). Resultado: "PROD_RESULTS: PASS=n FAIL=m".
-- ═══════════════════════════════════════════════════════════════════════
CREATE FUNCTION pg_temp.setperm(p jsonb) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE prev text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public."Usuarios" SET permisos = p WHERE auth_uid::text = '9ed2cc01-79ce-46ed-88c2-000640635e6c';
  PERFORM set_config('request.jwt.claims', COALESCE(prev, ''), true);
END $f$;

DO $s$
DECLARE
  res text := ''; pass int := 0; fail int := 0; ok boolean; ok2 boolean; r jsonb; n int; v numeric; t text; e numeric;
  org text := 'org_azyvion_001';
  adm text := 'c4477277-66a8-4a3f-8379-38b3b72eafed';
  agt text := '9ed2cc01-79ce-46ed-88c2-000640635e6c';
  otro text; u_agt text; u_adm text;
  tarea uuid := gen_random_uuid(); cli uuid := gen_random_uuid(); prod uuid := gen_random_uuid(); pend uuid; plant uuid;
BEGIN
  SELECT usuario INTO u_agt FROM public."Usuarios" WHERE auth_uid::text = agt;
  SELECT usuario INTO u_adm FROM public."Usuarios" WHERE auth_uid::text = adm;
  SELECT u.auth_uid::text INTO otro FROM public."Usuarios" u WHERE u.organization_id <> org AND u.auth_uid IS NOT NULL LIMIT 1;
  PERFORM pg_temp.setperm('{"submenus":[],"pos":[]}'::jsonb);

  -- ── P01 helper de privilegio ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := public.crm_es_privilegiado();
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok2 := public.crm_es_privilegiado();
  IF ok AND NOT ok2 THEN pass:=pass+1; res:=res||'P01 PASS | '; ELSE fail:=fail+1; res:=res||'P01 FAIL privilegio adm='||ok||' agt='||ok2||' | '; END IF;

  -- ── P02 tarea general (sin cliente) creada por el agente ─────────────
  INSERT INTO public."ActividadesCRM"(id, tipo, "refId", categoria, titulo, fecha, "fechaSeguimiento", hora_seguimiento, prioridad, usuario, organization_id)
  VALUES (tarea, 'General', NULL, 'Tarea', 'QA llamar proveedor', current_date, current_date, '09:30', 'Alta', u_agt, org);
  r := public.crm_tareas(NULL, NULL, true, false);
  SELECT count(*) INTO n FROM jsonb_array_elements(r -> 'filas') x WHERE x ->> 'id' = tarea::text AND x ->> 'responsable' = u_agt AND x ->> 'prioridad' = 'Alta';
  IF n = 1 THEN pass:=pass+1; res:=res||'P02 PASS | '; ELSE fail:=fail+1; res:=res||'P02 FAIL tarea propia n='||n||' | '; END IF;

  -- ── P03 completar: desaparece de pendientes, aparece con p_completadas
  UPDATE public."ActividadesCRM" SET completada = true, completada_en = now(), completada_por = u_agt WHERE id = tarea;
  r := public.crm_tareas(NULL, NULL, true, false);
  SELECT count(*) INTO n FROM jsonb_array_elements(r -> 'filas') x WHERE x ->> 'id' = tarea::text;
  r := public.crm_tareas(NULL, NULL, true, true);
  SELECT count(*) INTO v FROM jsonb_array_elements(r -> 'filas') x WHERE x ->> 'id' = tarea::text AND (x ->> 'completada')::boolean;
  IF n = 0 AND v = 1 THEN pass:=pass+1; res:=res||'P03 PASS | '; ELSE fail:=fail+1; res:=res||'P03 FAIL completar n='||n||' v='||v||' | '; END IF;
  UPDATE public."ActividadesCRM" SET completada = false WHERE id = tarea;

  -- ── P04 prioridad inválida ────────────────────────────────────────────
  BEGIN UPDATE public."ActividadesCRM" SET prioridad = 'Urgentísima' WHERE id = tarea; ok := false; EXCEPTION WHEN check_violation THEN ok := true; END;
  IF ok THEN pass:=pass+1; res:=res||'P04 PASS | '; ELSE fail:=fail+1; res:=res||'P04 FAIL prioridad libre | '; END IF;

  -- ── P05 plantillas: solo privilegiados escriben, todos leen ──────────
  BEGIN INSERT INTO public.crm_plantillas(nombre, canal, cuerpo) VALUES ('QA agente', 'WhatsApp', 'Hola {nombre}'); ok := false;
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.crm_plantillas(nombre, canal, cuerpo, creado_por) VALUES ('QA saludo', 'WhatsApp', 'Hola {nombre}, gracias por su compra.', u_adm) RETURNING id INTO plant;
  BEGIN INSERT INTO public.crm_plantillas(nombre, canal, cuerpo, organization_id) VALUES ('QA otra org', 'Correo', 'x', 'org_que_no_es_mia'); ok := ok AND false;
  EXCEPTION WHEN insufficient_privilege THEN ok := ok AND true; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.crm_plantillas WHERE id = plant;
  UPDATE public.crm_plantillas SET cuerpo = 'hackeado' WHERE id = plant;
  GET DIAGNOSTICS v = ROW_COUNT;
  IF ok AND n = 1 AND v = 0 THEN pass:=pass+1; res:=res||'P05 PASS | '; ELSE fail:=fail+1; res:=res||'P05 FAIL plantillas ok='||ok||' n='||n||' upd='||v||' | '; END IF;

  -- ── P06 ventas pendientes: autor y empresa los fija el servidor ──────
  INSERT INTO public.pos_ventas_pendientes(usuario, organization_id, nota, datos)
  VALUES ('suplantado', 'org_que_no_es_mia', 'Mesa 4', '{"items":[{"id":"x","cantidad":2}]}') RETURNING id INTO pend;
  BEGIN
    INSERT INTO public.pos_ventas_pendientes(nota, datos) VALUES ('x', '[1,2]');   -- datos debe ser objeto
    ok := false;
  EXCEPTION WHEN check_violation THEN ok := true; END;
  RESET ROLE;
  SELECT usuario || '@' || organization_id INTO t FROM public.pos_ventas_pendientes WHERE id = pend;
  IF t = u_agt || '@' || org THEN pass:=pass+1; res:=res||'P06 PASS | '; ELSE fail:=fail+1; res:=res||'P06 FAIL autor@org='||COALESCE(t,'∅')||' | '; END IF;
  IF ok THEN pass:=pass+1; res:=res||'P07 PASS | '; ELSE fail:=fail+1; res:=res||'P07 FAIL datos no-objeto aceptados | '; END IF;

  -- ── P08 auditoría: alta y cambio de cliente con diferencia mínima ────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public."Clientes"(id, nombre, telefono, organization_id) VALUES (cli, 'QA Cliente Auditoría', '5555-0000', org);
  UPDATE public."Clientes" SET telefono = '5555-9999', "ultimaActividad" = now() WHERE id = cli;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.crm_auditoria WHERE tabla = 'Clientes' AND registro_id = cli::text AND accion = 'INSERT' AND usuario = u_adm AND organization_id = org;
  SELECT cambios INTO r FROM public.crm_auditoria WHERE tabla = 'Clientes' AND registro_id = cli::text AND accion = 'UPDATE';
  IF n = 1 AND r = jsonb_build_object('telefono', jsonb_build_object('antes', '5555-0000', 'despues', '5555-9999'))
  THEN pass:=pass+1; res:=res||'P08 PASS | '; ELSE fail:=fail+1; res:=res||'P08 FAIL auditoría cliente n='||n||' diff='||COALESCE(r::text,'∅')||' | '; END IF;

  -- ── P09 sin ruido ni secretos: existencias (kardex) y contraseñas ────
  INSERT INTO public."Inventario"(id, producto, tipo, unidades, "precioUnit", organization_id, activo, categoria) VALUES (prod, 'QA PROD aud', 'Producto', 5, 10, org, true, 'QA');
  SELECT count(*) INTO n FROM public.crm_auditoria WHERE registro_id = prod::text;
  UPDATE public."Inventario" SET unidades = 7 WHERE id = prod;
  SELECT count(*) INTO v FROM public.crm_auditoria WHERE registro_id = prod::text;
  RESET ROLE;
  UPDATE public."Usuarios" SET contrasena = 'qa-no-debe-verse' WHERE auth_uid::text = agt;
  SELECT count(*) INTO t FROM public.crm_auditoria WHERE tabla = 'Usuarios' AND cambios::text LIKE '%qa-no-debe-verse%';
  IF n = 1 AND v = 1 AND t::int = 0 THEN pass:=pass+1; res:=res||'P09 PASS | '; ELSE fail:=fail+1; res:=res||'P09 FAIL ruido inv='||n||'/'||v||' secreto='||t||' | '; END IF;

  -- ── P10 auditoría: solo admin la lee, nadie la modifica ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.crm_listar_auditoria(current_date, current_date); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  BEGIN SELECT count(*) INTO n FROM public.crm_auditoria; ok := ok AND false; EXCEPTION WHEN insufficient_privilege THEN ok := ok AND true; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.crm_listar_auditoria(current_date, current_date, 'Clientes', cli::text);
  RESET ROLE;
  BEGIN UPDATE public.crm_auditoria SET usuario = 'x' WHERE registro_id = cli::text; ok2 := false; EXCEPTION WHEN OTHERS THEN ok2 := true; END;
  IF ok AND ok2 AND jsonb_array_length(r -> 'filas') = 2 THEN pass:=pass+1; res:=res||'P10 PASS | '; ELSE fail:=fail+1; res:=res||'P10 FAIL lectura/inmutabilidad ok='||ok||' ok2='||ok2||' filas='||jsonb_array_length(r -> 'filas')||' | '; END IF;

  -- ── P11 metas: permisos y validaciones ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.crm_meta_guardar(jsonb_build_object('usuario', u_agt, 'meta_ventas', 1)); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.crm_meta_guardar(jsonb_build_object('usuario', u_agt, 'meta_ventas', -1)); ok := ok AND false; EXCEPTION WHEN OTHERS THEN ok := ok AND SQLSTATE = '22023'; END;
  BEGIN PERFORM public.crm_meta_guardar(jsonb_build_object('usuario', 'qa_no_existe', 'meta_ventas', 1)); ok := ok AND false; EXCEPTION WHEN OTHERS THEN ok := ok AND SQLSTATE = '22023'; END;
  r := public.crm_meta_guardar(jsonb_build_object('usuario', u_agt, 'periodo', to_char(current_date, 'YYYY-MM-15'), 'meta_ventas', 1000, 'meta_cotizaciones', 2000, 'meta_actividades', 5));
  r := public.crm_meta_guardar(jsonb_build_object('usuario', u_agt, 'meta_ventas', 1500, 'meta_cotizaciones', 2000, 'meta_actividades', 5));   -- actualiza (mismo mes)
  RESET ROLE;
  SELECT count(*), max(meta_ventas) INTO n, v FROM public.crm_metas WHERE organization_id = org AND usuario = u_agt AND periodo = date_trunc('month', current_date)::date;
  IF ok AND n = 1 AND v = 1500 THEN pass:=pass+1; res:=res||'P11 PASS | '; ELSE fail:=fail+1; res:=res||'P11 FAIL metas ok='||ok||' n='||n||' v='||v||' | '; END IF;

  -- ── P12 avance: cotización aprobada + actividades; el agente solo se ve a sí mismo
  INSERT INTO public."Cotizaciones"(id, numero, cliente, fecha, total, estado, "creadoPor", organization_id)
  VALUES (gen_random_uuid(), 'QA-PROD-0001', 'QA', current_date, 500, 'Aprobada', u_agt, org),
         (gen_random_uuid(), 'QA-PROD-0002', 'QA', current_date, 900, 'Borrador', u_agt, org);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.crm_metas_progreso(NULL);
  RESET ROLE;
  SELECT x INTO r FROM jsonb_array_elements(r -> 'filas') x WHERE x ->> 'usuario' = u_agt;
  ok := (r ->> 'meta_ventas')::numeric = 1500 AND (r ->> 'cotizaciones')::numeric >= 500 AND (r ->> 'actividades')::int >= 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT jsonb_array_length(public.crm_metas_progreso(NULL) -> 'filas') INTO n;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT jsonb_array_length(public.crm_metas_progreso(NULL) -> 'filas') INTO v;
  RESET ROLE;
  IF ok AND n = 1 AND v > 1 THEN pass:=pass+1; res:=res||'P12 PASS | '; ELSE fail:=fail+1; res:=res||'P12 FAIL avance ok='||ok||' agt='||n||' adm='||v||' fila='||COALESCE(r::text,'∅')||' | '; END IF;

  -- ── P13 importar clientes: simulación no escribe y reporta errores ───
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.crm_importar_clientes(jsonb_build_array(
        jsonb_build_object('nombre', 'QA Imp Uno', 'nit', '999001-1', 'correo', 'uno@qa.test'),
        jsonb_build_object('nombre', 'QA Imp Dos', 'correo', 'dos@qa.test', 'fecha_nacimiento', '1990-05-20'),
        jsonb_build_object('nombre', '', 'correo', 'x@qa.test'),
        jsonb_build_object('nombre', 'QA Mal Correo', 'correo', 'no-es-correo'),
        jsonb_build_object('nombre', 'QA Imp Uno bis', 'nit', '999001-1')), false, true);
  SELECT count(*) INTO n FROM public."Clientes" WHERE organization_id = org AND nombre LIKE 'QA Imp%';
  IF (r ->> 'nuevos')::int = 2 AND (r ->> 'errores')::int = 3 AND n = 0 AND (r ->> 'simulado')::boolean
  THEN pass:=pass+1; res:=res||'P13 PASS | '; ELSE fail:=fail+1; res:=res||'P13 FAIL simulación '||r::text||' n='||n||' | '; END IF;

  -- ── P14 importar de verdad, re-importar (omitir) y actualizar ────────
  r := public.crm_importar_clientes(jsonb_build_array(
        jsonb_build_object('nombre', 'QA Imp Uno', 'nit', '999001-1', 'correo', 'uno@qa.test', 'ciudad', 'Antigua'),
        jsonb_build_object('nombre', 'QA Imp Dos', 'correo', 'dos@qa.test', 'fecha_nacimiento', '1990-05-20')), false, false);
  ok := (r ->> 'nuevos')::int = 2;
  r := public.crm_importar_clientes(jsonb_build_array(jsonb_build_object('nombre', 'QA Imp Uno', 'nit', '999001-1')), false, false);
  ok := ok AND (r ->> 'omitidos')::int = 1;
  r := public.crm_importar_clientes(jsonb_build_array(jsonb_build_object('nombre', 'QA Imp Uno SA', 'nit', '9990011', 'telefono', '4444-1234')), true, false);
  ok := ok AND (r ->> 'actualizados')::int = 1;
  RESET ROLE;
  SELECT count(*) INTO n FROM public."Clientes" WHERE organization_id = org AND nit = '9990011' AND nombre = 'QA Imp Uno SA' AND telefono = '4444-1234' AND ciudad = 'Antigua' AND correo = 'uno@qa.test';
  SELECT count(*) INTO v FROM public."Clientes" WHERE organization_id = org AND correo = 'dos@qa.test' AND fecha_nacimiento = '1990-05-20' AND fuente = 'Importación';
  IF ok AND n = 1 AND v = 1 THEN pass:=pass+1; res:=res||'P14 PASS | '; ELSE fail:=fail+1; res:=res||'P14 FAIL importación real ok='||ok||' n='||n||' v='||v||' | '; END IF;

  -- ── P15 el agente no importa clientes ────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.crm_importar_clientes('[{"nombre":"x"}]'::jsonb, false, true); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  BEGIN PERFORM public.crm_importar_productos('[{"producto":"x"}]'::jsonb, false, true); ok := ok AND false; EXCEPTION WHEN OTHERS THEN ok := ok AND SQLSTATE = '42501'; END;
  RESET ROLE;
  IF ok THEN pass:=pass+1; res:=res||'P15 PASS | '; ELSE fail:=fail+1; res:=res||'P15 FAIL agente importó | '; END IF;

  -- ── P16 importar productos: stock inicial al kardex, actualizar no toca existencias
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.crm_importar_productos(jsonb_build_array(
        jsonb_build_object('producto', 'QA Imp Prod', 'sku', 'QA-IMP-1', 'codigo_barras', 'QA7790001', 'precioUnit', '25.50', 'costo_unit', '12', 'unidades', '8', 'stock_minimo', '3'),
        jsonb_build_object('producto', 'QA Imp Serv', 'tipo', 'Servicio', 'precioUnit', '100', 'unidades', '50'),
        jsonb_build_object('producto', 'QA Malo', 'precioUnit', 'abc'),
        jsonb_build_object('producto', 'QA Neg', 'precioUnit', '-1')), false, false);
  ok := (r ->> 'nuevos')::int = 2 AND (r ->> 'errores')::int = 2;
  r := public.crm_importar_productos(jsonb_build_array(jsonb_build_object('producto', 'QA Imp Prod v2', 'sku', 'qa-imp-1', 'precioUnit', '30', 'unidades', '999')), true, false);
  ok := ok AND (r ->> 'actualizados')::int = 1;
  r := public.crm_importar_productos(jsonb_build_array(jsonb_build_object('producto', 'QA Choque', 'sku', 'QA-IMP-2', 'codigo_barras', 'qa7790001')), false, true);
  ok := ok AND (r ->> 'errores')::int = 1;
  RESET ROLE;
  SELECT count(*) INTO n FROM public."Inventario" WHERE organization_id = org AND sku = 'QA-IMP-1' AND producto = 'QA Imp Prod v2' AND unidades = 8 AND "precioUnit" = 30 AND stock_minimo = 3 AND costo_unit = 12;
  SELECT count(*) INTO v FROM public.inv_movimientos m JOIN public."Inventario" p ON p.id = m.producto_id WHERE p.sku = 'QA-IMP-1' AND p.organization_id = org AND m.tipo = 'Importación' AND m.cantidad = 8;
  SELECT count(*) INTO t FROM public."Inventario" WHERE organization_id = org AND producto = 'QA Imp Serv' AND unidades = 0;
  IF ok AND n = 1 AND v = 1 AND t::int = 1 THEN pass:=pass+1; res:=res||'P16 PASS | '; ELSE fail:=fail+1; res:=res||'P16 FAIL productos ok='||ok||' n='||n||' kardex='||v||' serv='||t||' | '; END IF;

  -- ── P17 aislamiento entre empresas ───────────────────────────────────
  SELECT u.auth_uid::text INTO otro FROM public."Usuarios" u WHERE u.organization_id <> org AND u.auth_uid IS NOT NULL LIMIT 1;
  IF otro IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub',otro,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    r := public.crm_tareas(NULL, NULL, false, true);
    SELECT count(*) INTO n FROM jsonb_array_elements(r -> 'filas') x WHERE x ->> 'id' = tarea::text;
    SELECT count(*) INTO v FROM public.crm_plantillas WHERE id = plant;
    SELECT count(*) INTO t FROM public.pos_ventas_pendientes WHERE id = pend;
    DELETE FROM public.pos_ventas_pendientes WHERE id = pend;
    RESET ROLE;
    SELECT count(*) INTO e FROM public.pos_ventas_pendientes WHERE id = pend;
    IF n = 0 AND v = 0 AND t::int = 0 AND e = 1 THEN pass:=pass+1; res:=res||'P17 PASS | '; ELSE fail:=fail+1; res:=res||'P17 FAIL aislamiento tarea='||n||' plantilla='||v||' pend='||t||' tras borrar='||e||' | '; END IF;
  ELSE res := res || 'P17 SKIP | '; END IF;

  -- ── P18 anon sin acceso ──────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN PERFORM public.crm_tareas(); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  BEGIN SELECT count(*) INTO n FROM public.crm_plantillas; ok := ok AND false; EXCEPTION WHEN insufficient_privilege THEN ok := ok AND true; END;
  BEGIN SELECT count(*) INTO n FROM public.pos_ventas_pendientes; ok := ok AND false; EXCEPTION WHEN insufficient_privilege THEN ok := ok AND true; END;
  RESET ROLE;
  IF ok THEN pass:=pass+1; res:=res||'P18 PASS | '; ELSE fail:=fail+1; res:=res||'P18 FAIL anon | '; END IF;

  -- ── P19 el agente sí puede retomar (borrar) una venta pendiente de su empresa
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.pos_ventas_pendientes WHERE id = pend;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n = 1 THEN pass:=pass+1; res:=res||'P19 PASS | '; ELSE fail:=fail+1; res:=res||'P19 FAIL borrar pendiente n='||n||' | '; END IF;

  RAISE EXCEPTION 'PROD_RESULTS: PASS=% FAIL=% | %', pass, fail, res;
END $s$;
