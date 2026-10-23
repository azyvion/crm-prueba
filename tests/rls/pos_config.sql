-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Regresión Lote 5: configuración del POS por empresa
-- Requiere 20261023_06_pos_ventas.sql y 20261023_07_pos_config.sql.
-- Datos sintéticos dentro del bloque; SIEMPRE termina en RAISE EXCEPTION (todo se revierte).
-- Resultado: "POSCFG_RESULTS: PASS=n FAIL=m".
-- ═══════════════════════════════════════════════════════════════════════
CREATE FUNCTION pg_temp.setcfg(c jsonb, r jsonb DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE prev text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);       -- backend de confianza
  UPDATE public."Organizations" SET pos_config = c, redes_sociales = COALESCE(r, redes_sociales) WHERE id = 'org_azyvion_001';
  PERFORM set_config('request.jwt.claims', COALESCE(prev, ''), true);   -- conserva la identidad de la prueba
END $f$;
CREATE FUNCTION pg_temp.setperm(p jsonb) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE prev text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public."Usuarios" SET permisos = p WHERE auth_uid::text = '9ed2cc01-79ce-46ed-88c2-000640635e6c';
  PERFORM set_config('request.jwt.claims', COALESCE(prev, ''), true);
END $f$;

DO $s$
DECLARE
  res text := ''; pass int := 0; fail int := 0; ok boolean; r jsonb; n int; v numeric; t text; e numeric;
  org text := 'org_azyvion_001';
  adm text := 'c4477277-66a8-4a3f-8379-38b3b72eafed';
  agt text := '9ed2cc01-79ce-46ed-88c2-000640635e6c';
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  caja text; v1 uuid; it1 uuid; tk jsonb;
  pagoE jsonb := jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',100000));
BEGIN
  INSERT INTO public."Inventario"(id, producto, tipo, unidades, "stockMax", "precioUnit", organization_id, activo)
  VALUES (p1, 'QA CFG A', 'Producto', 50, 100, 100.10, org, true), (p2, 'QA CFG B', 'Producto', 0, 100, 50, org, true);

  -- ── Validación de la configuración ────────────────────────────────────
  SELECT public.pos_cfg(org) ->> 'descuento_max_default' INTO t;
  IF t = '10' THEN pass:=pass+1; res:=res||'K01 PASS | '; ELSE fail:=fail+1; res:=res||'K01 FAIL defaults '||coalesce(t,'null')||' | '; END IF;
  FOREACH t IN ARRAY ARRAY['{"descuento_max_default":150}','{"metodos_habilitados":[]}','{"vender_sin_stock":"quiza"}','{"ticket_copias":"2"}','{"redondeo_efectivo":0.07}','{"metodos_habilitados":["Bitcoin"]}'] LOOP
    BEGIN PERFORM pg_temp.setcfg(t::jsonb); ok := false; EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
    IF NOT ok THEN fail:=fail+1; res:=res||'K02 FAIL aceptó '||t||' | '; END IF;
  END LOOP;
  pass:=pass+1; res:=res||'K02 PASS | ';
  PERFORM pg_temp.setcfg('{"foo":1,"stock_bajo_umbral":3}'::jsonb, '{"facebook":" fb.com/mi ","myspace":"x","instagram":"","tiktok":"@mi"}'::jsonb);
  SELECT (pos_config = '{"stock_bajo_umbral": 3}'::jsonb AND redes_sociales = '{"facebook":"fb.com/mi","tiktok":"@mi"}'::jsonb) INTO ok FROM public."Organizations" WHERE id = org;
  IF ok THEN pass:=pass+1; res:=res||'K03 PASS | '; ELSE fail:=fail+1; res:=res||'K03 FAIL limpieza | '; END IF;
  BEGIN PERFORM pg_temp.setcfg('{}'::jsonb, ('{"facebook":"'||repeat('x',200)||'"}')::jsonb); ok := false; EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF ok THEN pass:=pass+1; res:=res||'K04 PASS | '; ELSE fail:=fail+1; res:=res||'K04 FAIL red social larga | '; END IF;
  PERFORM pg_temp.setcfg('{}'::jsonb);

  -- Solo admin/gerente editan la configuración (RLS)
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public."Organizations" SET pos_config = '{"descuento_max_default":100}'::jsonb WHERE id = org;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n = 0 THEN pass:=pass+1; res:=res||'K05 PASS | '; ELSE fail:=fail+1; res:=res||'K05 FAIL agente editó la configuración | '; END IF;

  -- Caja abierta por el admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  caja := (public.pos_abrir_caja(100, 'QA')) ->> 'cajaId';
  RESET ROLE;

  -- ── Descuento máximo por defecto de la empresa ────────────────────────
  PERFORM pg_temp.setcfg('{"descuento_max_default":3}'::jsonb);
  PERFORM pg_temp.setperm('{"submenus":[],"pos":["descuento"]}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-desc-001','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),'descuentoPct',4,'pagos',pagoE)); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-desc-002','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),'descuentoPct',3,'pagos',pagoE));
  ok := ok AND (r -> 'ticket' ->> 'descuentoPct')::numeric = 3;
  IF ok THEN pass:=pass+1; res:=res||'K06 PASS | '; ELSE fail:=fail+1; res:=res||'K06 FAIL tope de empresa | '; END IF;
  v1 := (r -> 'ticket' ->> 'ventaId')::uuid;
  r := public.pos_mis_permisos();
  IF (r ->> 'descuentoMax')::numeric = 3 AND (r -> 'config' ->> 'descuento_max_default')::numeric = 3 THEN pass:=pass+1; res:=res||'K07 PASS | '; ELSE fail:=fail+1; res:=res||'K07 FAIL mis_permisos | '; END IF;
  RESET ROLE;

  -- ── Vender sin existencias: no / permiso / si ─────────────────────────
  PERFORM pg_temp.setcfg('{"vender_sin_stock":"no"}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-ss-001','items',jsonb_build_array(jsonb_build_object('id',p2,'cantidad',1)),'pagos',pagoE)); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%Existencia insuficiente%'; END;
  IF ok THEN pass:=pass+1; res:=res||'K08 PASS | '; ELSE fail:=fail+1; res:=res||'K08 FAIL "no" permitió sobreventa | '; END IF;
  RESET ROLE; PERFORM pg_temp.setcfg('{"vender_sin_stock":"permiso"}'::jsonb); PERFORM pg_temp.setperm('{"submenus":[],"pos":[]}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-ss-002','items',jsonb_build_array(jsonb_build_object('id',p2,'cantidad',1)),'pagos',pagoE)); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%Existencia insuficiente%'; END;
  IF ok THEN pass:=pass+1; res:=res||'K09 PASS | '; ELSE fail:=fail+1; res:=res||'K09 FAIL "permiso" sin permiso vendió | '; END IF;
  RESET ROLE; PERFORM pg_temp.setperm('{"submenus":[],"pos":["sin_stock"]}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-ss-003','items',jsonb_build_array(jsonb_build_object('id',p2,'cantidad',2)),'pagos',pagoE));
  SELECT unidades INTO v FROM public."Inventario" WHERE id = p2;
  IF (r ->> 'ok')::boolean AND v = -2 AND (public.pos_mis_permisos() ->> 'puedeVenderSinStock')::boolean THEN pass:=pass+1; res:=res||'K10 PASS | '; ELSE fail:=fail+1; res:=res||'K10 FAIL "permiso" con permiso v='||coalesce(v::text,'null')||' | '; END IF;
  RESET ROLE;

  -- ── Redondeo de efectivo (0.25) ───────────────────────────────────────
  PERFORM pg_temp.setcfg('{"redondeo_efectivo":0.25}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-red-001','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),
        'pagos',jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',150))));
  tk := r -> 'ticket';
  e := round(round((tk ->> 'total')::numeric / 0.25, 0) * 0.25, 2);
  SELECT monto INTO v FROM public.pos_venta_pagos WHERE venta_id = (tk ->> 'ventaId')::uuid;
  IF v = e AND (tk ->> 'redondeo')::numeric = round(e - (tk ->> 'total')::numeric, 2) AND (tk ->> 'cambio')::numeric = round(150 - e, 2) THEN pass:=pass+1; res:=res||'K11 PASS | '; ELSE fail:=fail+1; res:=res||'K11 FAIL redondeo monto='||v||' esp='||e||' | '; END IF;
  RESET ROLE;

  -- ── NIT obligatorio desde un monto ────────────────────────────────────
  PERFORM pg_temp.setcfg('{"nit_obligatorio_desde":100}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-nit-001','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',2)),'pagos',pagoE)); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%requiere el NIT%'; END;
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-nit-002','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',2)),'clienteNombre','QA NIT','nit','7777777-1','pagos',pagoE));
  ok := ok AND (r ->> 'ok')::boolean;
  IF ok THEN pass:=pass+1; res:=res||'K12 PASS | '; ELSE fail:=fail+1; res:=res||'K12 FAIL NIT obligatorio | '; END IF;
  RESET ROLE;

  -- ── Propina ───────────────────────────────────────────────────────────
  PERFORM pg_temp.setcfg('{}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-tip-001','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),'propina',10,'pagos',pagoE)); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%no está habilitada%'; END;
  IF ok THEN pass:=pass+1; res:=res||'K13 PASS | '; ELSE fail:=fail+1; res:=res||'K13 FAIL propina sin habilitar | '; END IF;
  RESET ROLE; PERFORM pg_temp.setcfg('{"propina_habilitada":true}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-tip-002','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),'propina',10,
        'pagos',jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',200))));
  tk := r -> 'ticket';
  SELECT monto INTO v FROM public.pos_venta_pagos WHERE venta_id = (tk ->> 'ventaId')::uuid;
  IF (tk ->> 'propina')::numeric = 10 AND v = round((tk ->> 'total')::numeric + 10, 2) AND (tk ->> 'cambio')::numeric = round(200 - v, 2) THEN pass:=pass+1; res:=res||'K14 PASS | '; ELSE fail:=fail+1; res:=res||'K14 FAIL propina cobrada | '; END IF;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-tip-003','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),'propina',10,
        'pagos',jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',100.10)))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%insuficiente%'; END;
  IF ok THEN pass:=pass+1; res:=res||'K15 PASS | '; ELSE fail:=fail+1; res:=res||'K15 FAIL propina no incluida en el cobro | '; END IF;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-tip-004','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),'propina',-5,'pagos',pagoE)); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%Propina inválida%'; END;
  IF ok THEN pass:=pass+1; res:=res||'K16 PASS | '; ELSE fail:=fail+1; res:=res||'K16 FAIL propina negativa | '; END IF;
  RESET ROLE;

  -- ── Métodos de pago habilitados ───────────────────────────────────────
  PERFORM pg_temp.setcfg('{"metodos_habilitados":["Efectivo","Transferencia"]}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-met-001','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),
        'pagos',jsonb_build_array(jsonb_build_object('metodo','Tarjeta','monto',100.10,'referencia','AUT-1')))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%no está habilitado%'; END;
  IF ok THEN pass:=pass+1; res:=res||'K17 PASS | '; ELSE fail:=fail+1; res:=res||'K17 FAIL método deshabilitado aceptado | '; END IF;
  SELECT id INTO it1 FROM public.pos_venta_items WHERE venta_id = v1 LIMIT 1;
  BEGIN PERFORM public.pos_devolver_venta(jsonb_build_object('ventaId',v1,'anular',true,'motivo','Producto defectuoso','motivoTipo','Producto defectuoso','metodoReembolso','Tarjeta','referencia','R-1','idempotency_key','cfg-met-dev1')); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%no está habilitado%'; END;
  IF ok THEN pass:=pass+1; res:=res||'K18 PASS | '; ELSE fail:=fail+1; res:=res||'K18 FAIL reembolso por método deshabilitado | '; END IF;
  RESET ROLE;

  -- ── Motivos de devolución y plazo ─────────────────────────────────────
  PERFORM pg_temp.setcfg('{}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_devolver_venta(jsonb_build_object('ventaId',v1,'items',jsonb_build_array(jsonb_build_object('itemId',it1,'cantidad',1)),'motivo','sin tipo de motivo','idempotency_key','cfg-mot-001')); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%motivo de la lista%'; END;
  BEGIN PERFORM public.pos_devolver_venta(jsonb_build_object('ventaId',v1,'items',jsonb_build_array(jsonb_build_object('itemId',it1,'cantidad',1)),'motivo','motivo inventado','motivoTipo','Inventado','idempotency_key','cfg-mot-002')); ok := ok AND false;
  EXCEPTION WHEN OTHERS THEN ok := ok AND SQLERRM LIKE '%motivo de la lista%'; END;
  IF ok THEN pass:=pass+1; res:=res||'K19 PASS | '; ELSE fail:=fail+1; res:=res||'K19 FAIL motivos | '; END IF;
  r := public.pos_devolver_venta(jsonb_build_object('ventaId',v1,'items',jsonb_build_array(jsonb_build_object('itemId',it1,'cantidad',1)),'motivo','Producto defectuoso — rayado','motivoTipo','Producto defectuoso','idempotency_key','cfg-mot-003'));
  SELECT motivo_tipo INTO t FROM public.pos_devoluciones WHERE idempotency_key = 'cfg-mot-003';
  IF (r ->> 'ok')::boolean AND t = 'Producto defectuoso' THEN pass:=pass+1; res:=res||'K20 PASS | '; ELSE fail:=fail+1; res:=res||'K20 FAIL motivo guardado | '; END IF;
  RESET ROLE;
  -- sin lista de motivos: texto libre
  PERFORM pg_temp.setcfg('{"motivos_devolucion":[]}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.pos_devolver_venta(jsonb_build_object('ventaId',(SELECT ventaid FROM (SELECT (public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-mot-004','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),'pagos',pagoE)) -> 'ticket' ->> 'ventaId')::uuid AS ventaid) x),
        'anular',true,'motivo','texto libre sin lista','idempotency_key','cfg-mot-005'));
  IF (r ->> 'ok')::boolean THEN pass:=pass+1; res:=res||'K21 PASS | '; ELSE fail:=fail+1; res:=res||'K21 FAIL motivo libre | '; END IF;
  RESET ROLE;
  -- plazo de devolución (solo no privilegiados)
  PERFORM pg_temp.setcfg('{}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-plz-000','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',2)),'pagos',pagoE));
  v1 := (r -> 'ticket' ->> 'ventaId')::uuid;
  SELECT id INTO it1 FROM public.pos_venta_items WHERE venta_id = v1 LIMIT 1;
  RESET ROLE;
  PERFORM pg_temp.setcfg('{"plazo_devolucion_dias":30,"motivos_devolucion":[]}'::jsonb);
  PERFORM pg_temp.setperm('{"submenus":[],"pos":["devolver"]}'::jsonb);
  UPDATE public.pos_ventas SET created_at = now() - interval '40 days' WHERE id = v1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_devolver_venta(jsonb_build_object('ventaId',v1,'items',jsonb_build_array(jsonb_build_object('itemId',it1,'cantidad',1)),'motivo','fuera de plazo','idempotency_key','cfg-plz-001')); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%plazo%'; END;
  IF ok THEN pass:=pass+1; res:=res||'K22 PASS | '; ELSE fail:=fail+1; res:=res||'K22 FAIL plazo no aplicado | '; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  r := public.pos_devolver_venta(jsonb_build_object('ventaId',v1,'items',jsonb_build_array(jsonb_build_object('itemId',it1,'cantidad',1)),'motivo','autorizado por admin','idempotency_key','cfg-plz-002'));
  IF (r ->> 'ok')::boolean THEN pass:=pass+1; res:=res||'K23 PASS | '; ELSE fail:=fail+1; res:=res||'K23 FAIL admin no pudo | '; END IF;
  RESET ROLE;

  -- ── Efectivo máximo y turnos largos ───────────────────────────────────
  PERFORM pg_temp.setcfg('{"efectivo_max_caja":50}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.pos_estado_caja();
  ok := (r ->> 'alertaEfectivo')::boolean;
  RESET ROLE; PERFORM pg_temp.setcfg('{"efectivo_max_caja":0}'::jsonb);
  SET LOCAL ROLE authenticated;
  r := public.pos_estado_caja();
  ok := ok AND NOT (r ->> 'alertaEfectivo')::boolean;
  IF ok THEN pass:=pass+1; res:=res||'K24 PASS | '; ELSE fail:=fail+1; res:=res||'K24 FAIL alerta de efectivo | '; END IF;
  RESET ROLE;
  PERFORM pg_temp.setcfg('{"turno_horas_max":2,"turno_bloquear":false}'::jsonb);
  UPDATE public."Cajas_Turnos" SET fecha_apertura = now() - interval '5 hours' WHERE id = caja;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.pos_estado_caja();
  ok := (r ->> 'excedeHoras')::boolean;
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-trn-001','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),'pagos',pagoE));
  ok := ok AND (r ->> 'ok')::boolean;                       -- solo recordatorio: sigue vendiendo
  RESET ROLE; PERFORM pg_temp.setcfg('{"turno_horas_max":2,"turno_bloquear":true}'::jsonb);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-trn-002','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),'pagos',pagoE)); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := ok AND SQLERRM LIKE '%horas abierto%'; END;
  IF ok THEN pass:=pass+1; res:=res||'K25 PASS | '; ELSE fail:=fail+1; res:=res||'K25 FAIL turno largo | '; END IF;
  RESET ROLE;
  UPDATE public."Cajas_Turnos" SET fecha_apertura = now() WHERE id = caja;

  -- ── Tolerancia de cuadre y supervisor ─────────────────────────────────
  PERFORM pg_temp.setcfg('{"tolerancia_cuadre":1,"cuadre_max_sin_supervisor":5}'::jsonb);
  PERFORM pg_temp.setperm('{"submenus":[],"pos":["caja_mov"]}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  e := (public.pos_estado_caja() -> 'resumen' ->> 'esperado')::numeric;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  BEGIN PERFORM public.pos_cerrar_caja(caja, e - 3, ''); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%explíquela%'; END;
  BEGIN PERFORM public.pos_cerrar_caja(caja, e - 8, 'faltante grande'); ok := ok AND false; EXCEPTION WHEN OTHERS THEN ok := ok AND SQLSTATE = '42501' AND SQLERRM LIKE '%supervisor%'; END;
  IF ok THEN pass:=pass+1; res:=res||'K26 PASS | '; ELSE fail:=fail+1; res:=res||'K26 FAIL cuadre (explicación/supervisor) | '; END IF;
  r := public.pos_cerrar_caja(caja, e - 0.5, '');           -- dentro de la tolerancia: sin explicación
  IF (r ->> 'diferencia')::numeric = -0.5 AND r ->> 'estado' = 'CERRADA' THEN pass:=pass+1; res:=res||'K27 PASS | '; ELSE fail:=fail+1; res:=res||'K27 FAIL tolerancia | '; END IF;
  RESET ROLE;

  -- ── Caja obligatoria: no / auto / si (sin turno abierto) ──────────────
  PERFORM pg_temp.setcfg('{"caja_obligatoria":"auto"}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-cj-001','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),'pagos',pagoE)); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%caja abierta%'; END;
  RESET ROLE; PERFORM pg_temp.setcfg('{"caja_obligatoria":"si"}'::jsonb); SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-cj-002','permitir_sin_caja',true,'items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),'pagos',pagoE)); ok := ok AND false;
  EXCEPTION WHEN OTHERS THEN ok := ok AND SQLERRM LIKE '%caja abierta%'; END;
  RESET ROLE; PERFORM pg_temp.setcfg('{"caja_obligatoria":"no"}'::jsonb); SET LOCAL ROLE authenticated;
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','cfg-cj-003','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),'pagos',pagoE));
  ok := ok AND (r ->> 'ok')::boolean AND (r -> 'ticket' ->> 'cajaTurnoId') IS NULL;
  IF ok THEN pass:=pass+1; res:=res||'K28 PASS | '; ELSE fail:=fail+1; res:=res||'K28 FAIL caja obligatoria | '; END IF;
  RESET ROLE;

  -- Un administrador real (rol authenticated) puede guardar la configuración desde Ajustes
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public."Organizations" SET pos_config = '{"ticket_copias":2}'::jsonb, redes_sociales = '{"instagram":"@mi"}'::jsonb WHERE id = org;
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT (pos_config = '{"ticket_copias":2}'::jsonb) INTO ok FROM public."Organizations" WHERE id = org;
  RESET ROLE;
  IF n = 1 AND ok THEN pass:=pass+1; res:=res||'K29 PASS | '; ELSE fail:=fail+1; res:=res||'K29 FAIL el admin no pudo guardar | '; END IF;

  RAISE EXCEPTION 'POSCFG_RESULTS: PASS=% FAIL=% | %', pass, fail, res;
END $s$;
