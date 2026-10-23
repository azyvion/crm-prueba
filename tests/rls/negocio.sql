-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Regresión Lote 6: reportes, compras con costo, kardex, conteo, reposición, seguimiento
-- Requiere 06, 07 y 08. Datos sintéticos; SIEMPRE termina en RAISE EXCEPTION (todo se revierte).
-- Resultado: "NEG_RESULTS: PASS=n FAIL=m".
-- ═══════════════════════════════════════════════════════════════════════
CREATE FUNCTION pg_temp.setcfg(c jsonb) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE prev text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public."Organizations" SET pos_config = c WHERE id = 'org_azyvion_001';
  PERFORM set_config('request.jwt.claims', COALESCE(prev, ''), true);
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
  ok2 boolean; res text := ''; pass int := 0; fail int := 0; ok boolean; r jsonb; r2 jsonb; n int; v numeric; t text; e numeric;
  org text := 'org_azyvion_001';
  adm text := 'c4477277-66a8-4a3f-8379-38b3b72eafed';
  agt text := '9ed2cc01-79ce-46ed-88c2-000640635e6c';
  otro text;
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); sv uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); prov uuid;
  caja text; c1 uuid; c2 uuid; v1 uuid; vcli uuid; cli uuid; conteo uuid; numc text;
  pagoE jsonb := jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',100000));
BEGIN
  INSERT INTO public."Inventario"(id, producto, tipo, unidades, "stockMax", "precioUnit", organization_id, activo, categoria)
  VALUES (p1, 'QA NEG A', 'Producto', 10, 100, 100, org, true, 'QA'), (p2, 'QA NEG B', 'Producto', 0, 100, 50, org, true, 'QA'),
         (sv, 'QA NEG Servicio', 'Servicio', 0, 100, 30, org, true, 'QA');
  INSERT INTO public."CuentasBancarias"(id, nombre, saldo, organization_id) VALUES (b1, 'QA Banco N', 1000, org);
  SELECT u.auth_uid::text INTO otro FROM public."Usuarios" u WHERE u.organization_id <> org AND u.auth_uid IS NOT NULL LIMIT 1;
  PERFORM pg_temp.setperm('{"submenus":[],"pos":[]}'::jsonb);

  -- ── Kardex: stock inicial y edición manual del formulario ─────────────
  SELECT count(*) INTO n FROM public.inv_movimientos WHERE producto_id = p1 AND tipo = 'Stock inicial' AND cantidad = 10 AND saldo = 10;
  IF n = 1 THEN pass:=pass+1; res:=res||'N01 PASS | '; ELSE fail:=fail+1; res:=res||'N01 FAIL stock inicial n='||n||' | '; END IF;

  -- ── Proveedores ───────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.proveedor_guardar('{"nombre":"QA Proveedor"}'::jsonb); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  IF ok THEN pass:=pass+1; res:=res||'N02 PASS | '; ELSE fail:=fail+1; res:=res||'N02 FAIL agente creó proveedor | '; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.proveedor_guardar('{"nombre":"QA Proveedor","nit":"1234567-8","telefono":"5555-1111"}'::jsonb);
  prov := (r ->> 'id')::uuid;
  BEGIN PERFORM public.proveedor_guardar('{"nombre":"QA Proveedor"}'::jsonb); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%Ya existe%'; END;
  IF prov IS NOT NULL AND ok THEN pass:=pass+1; res:=res||'N03 PASS | '; ELSE fail:=fail+1; res:=res||'N03 FAIL proveedor | '; END IF;

  -- ── Compra de contado: stock, costo promedio, kardex y egreso ─────────
  r := public.compra_registrar(jsonb_build_object('idempotency_key','neg-comp-001','proveedorId',prov,'referencia','FAC-9','formaPago','Contado',
        'items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',20,'costo',40))));
  c1 := (r ->> 'compraId')::uuid; numc := r ->> 'numero';
  SELECT unidades, costo_unit INTO v, e FROM public."Inventario" WHERE id = p1;
  IF v = 30 AND e = round((10 * 0 + 20 * 40) / 30.0, 4) AND numc ~ '^COM-[0-9]{4}-[0-9]{5}$' THEN pass:=pass+1; res:=res||'N04 PASS | '; ELSE fail:=fail+1; res:=res||'N04 FAIL compra v='||v||' costo='||e||' | '; END IF;
  SELECT count(*) INTO n FROM public.inv_movimientos WHERE producto_id = p1 AND tipo = 'Compra' AND cantidad = 20 AND saldo = 30 AND referencia = numc;
  SELECT count(*), COALESCE(sum(monto), 0) INTO n, v FROM public."Transacciones" WHERE organization_id = org AND referencia = numc AND tipo = 'Egreso';
  IF n = 1 AND v = 800 THEN pass:=pass+1; res:=res||'N05 PASS | '; ELSE fail:=fail+1; res:=res||'N05 FAIL egreso n='||n||' v='||v||' | '; END IF;
  r2 := public.compra_registrar(jsonb_build_object('idempotency_key','neg-comp-001','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',20,'costo',40))));
  SELECT unidades INTO v FROM public."Inventario" WHERE id = p1;
  IF (r2 ->> 'duplicado')::boolean AND v = 30 THEN pass:=pass+1; res:=res||'N06 PASS | '; ELSE fail:=fail+1; res:=res||'N06 FAIL idempotencia de compra | '; END IF;
  r := public.compra_registrar(jsonb_build_object('idempotency_key','neg-comp-002','formaPago','Contado','cuentaBancariaId',b1,
        'items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',10,'costo',50))));
  SELECT unidades, costo_unit INTO v, e FROM public."Inventario" WHERE id = p1;
  SELECT saldo INTO t FROM public."CuentasBancarias" WHERE id = b1;
  IF v = 40 AND e = round((30 * round(800/30.0, 4) + 10 * 50) / 40.0, 4) AND t::numeric = 500 THEN pass:=pass+1; res:=res||'N07 PASS | '; ELSE fail:=fail+1; res:=res||'N07 FAIL promedio ponderado/saldo '||e||' '||t||' | '; END IF;
  -- validaciones
  BEGIN PERFORM public.compra_registrar(jsonb_build_object('idempotency_key','neg-comp-003','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1,'costo',-5)))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '22023'; END;
  BEGIN PERFORM public.compra_registrar(jsonb_build_object('idempotency_key','neg-comp-004','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',0,'costo',5)))); ok := ok AND false;
  EXCEPTION WHEN OTHERS THEN ok := ok AND SQLSTATE = '22023'; END;
  BEGIN PERFORM public.compra_registrar(jsonb_build_object('idempotency_key','neg-comp-005','items',jsonb_build_array(jsonb_build_object('id',sv,'cantidad',1,'costo',5)))); ok := ok AND false;
  EXCEPTION WHEN OTHERS THEN ok := ok AND SQLERRM LIKE '%servicio%'; END;
  BEGIN PERFORM public.compra_registrar(jsonb_build_object('idempotency_key','neg-comp-006','fecha',(current_date + 10)::text,'items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1,'costo',5)))); ok := ok AND false;
  EXCEPTION WHEN OTHERS THEN ok := ok AND SQLERRM LIKE '%futura%'; END;
  SELECT unidades INTO v FROM public."Inventario" WHERE id = p1;
  IF ok AND v = 40 THEN pass:=pass+1; res:=res||'N08 PASS | '; ELSE fail:=fail+1; res:=res||'N08 FAIL validaciones de compra | '; END IF;
  -- crédito + pago posterior
  r := public.compra_registrar(jsonb_build_object('idempotency_key','neg-comp-007','formaPago','Crédito','proveedorId',prov,'items',jsonb_build_array(jsonb_build_object('id',p2,'cantidad',5,'costo',20))));
  c2 := (r ->> 'compraId')::uuid;
  SELECT count(*) INTO n FROM public."Transacciones" WHERE organization_id = org AND referencia = r ->> 'numero';
  ok := n = 0 AND (SELECT NOT pagada FROM public.compras WHERE id = c2);
  r2 := public.compra_pagar(c2, b1, 'CH-1');
  SELECT count(*) INTO n FROM public."Transacciones" WHERE organization_id = org AND referencia = r ->> 'numero' AND tipo = 'Egreso' AND monto = 100;
  BEGIN PERFORM public.compra_pagar(c2, b1, 'CH-2'); ok := ok AND false; EXCEPTION WHEN OTHERS THEN ok := ok AND SQLERRM LIKE '%ya está pagada%'; END;
  IF ok AND n = 1 THEN pass:=pass+1; res:=res||'N09 PASS | '; ELSE fail:=fail+1; res:=res||'N09 FAIL crédito/pago | '; END IF;
  RESET ROLE;

  -- ── Caja y venta: costo congelado, kardex y reporte ───────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  caja := (public.pos_abrir_caja(100, 'QA')) ->> 'cajaId';
  SELECT costo_unit INTO e FROM public."Inventario" WHERE id = p1;
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','neg-v-001','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',2)),
        'clienteNombre','QA Cliente Neg','nit','8888888-5','pagos',pagoE));
  v1 := (r -> 'ticket' ->> 'ventaId')::uuid; vcli := (r -> 'ticket' ->> 'clienteId')::uuid;
  SELECT costo_unit INTO v FROM public.pos_venta_items WHERE venta_id = v1;
  SELECT count(*) INTO n FROM public.inv_movimientos WHERE producto_id = p1 AND tipo = 'Venta' AND cantidad = -2 AND referencia = r -> 'ticket' ->> 'numero';
  IF v = e AND e > 0 AND n = 1 THEN pass:=pass+1; res:=res||'N10 PASS | '; ELSE fail:=fail+1; res:=res||'N10 FAIL costo/kardex de venta v='||v||' e='||e||' n='||n||' | '; END IF;
  r2 := public.pos_registrar_venta(jsonb_build_object('idempotency_key','neg-v-002','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1),jsonb_build_object('id',p2,'cantidad',1)),'pagos',pagoE));
  RESET ROLE;

  -- Anulación de compra con existencias insuficientes
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public."Inventario" SET unidades = 1 WHERE id = p2;                  -- ya se vendió casi todo lo comprado
  BEGIN PERFORM public.compra_anular(c2, 'devolución al proveedor'); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%ya se vendió%'; END;
  UPDATE public."Inventario" SET unidades = 5 WHERE id = p2;
  PERFORM public.compra_anular(c2, 'devolución al proveedor');
  SELECT unidades INTO v FROM public."Inventario" WHERE id = p2;
  SELECT count(*) INTO n FROM public."Transacciones" WHERE organization_id = org AND concepto LIKE 'Anulación de compra%' AND monto = 100 AND tipo = 'Ingreso';
  BEGIN PERFORM public.compra_anular(c2, 'otra vez'); ok := ok AND false; EXCEPTION WHEN OTHERS THEN ok := ok AND SQLERRM LIKE '%ya fue anulada%'; END;
  IF ok AND v = 0 AND n = 1 THEN pass:=pass+1; res:=res||'N11 PASS | '; ELSE fail:=fail+1; res:=res||'N11 FAIL anulación de compra v='||v||' n='||n||' | '; END IF;
  RESET ROLE;

  -- ── Reporte de ventas ─────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_reporte_ventas(current_date, current_date, NULL); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  IF ok THEN pass:=pass+1; res:=res||'N12 PASS | '; ELSE fail:=fail+1; res:=res||'N12 FAIL agente vio reportes | '; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.pos_reporte_ventas((now() AT TIME ZONE 'America/Guatemala')::date, (now() AT TIME ZONE 'America/Guatemala')::date, NULL);
  SELECT COALESCE(sum(total - reembolsado), 0), count(*) FILTER (WHERE estado <> 'Anulada') INTO v, n FROM public.pos_ventas
   WHERE organization_id = org AND (created_at AT TIME ZONE 'America/Guatemala')::date = (now() AT TIME ZONE 'America/Guatemala')::date;
  ok := (r -> 'kpis' ->> 'ventas_netas')::numeric = v AND (r -> 'kpis' ->> 'tickets')::int = n AND jsonb_array_length(r -> 'por_dia') = 1
        AND (r ->> 'margen')::numeric = (r ->> 'ingresos_sin_iva')::numeric - (r -> 'kpis' ->> 'costo')::numeric;
  IF ok AND (r -> 'kpis' ->> 'costo')::numeric > 0 THEN pass:=pass+1; res:=res||'N13 PASS | '; ELSE fail:=fail+1; res:=res||'N13 FAIL kpis '||(r -> 'kpis')::text||' | '; END IF;
  ok := jsonb_array_length(r -> 'top_productos') >= 1 AND (r -> 'top_productos' -> 0 ->> 'producto') = 'QA NEG A'
        AND (r -> 'por_metodo' -> 0 ->> 'metodo') = 'Efectivo' AND jsonb_array_length(r -> 'por_cajero') >= 1 AND (r -> 'periodo_previo' ->> 'hasta')::date = (now() AT TIME ZONE 'America/Guatemala')::date - 1;
  BEGIN PERFORM public.pos_reporte_ventas(current_date, current_date - 5, NULL); ok := ok AND false; EXCEPTION WHEN OTHERS THEN ok := ok AND SQLSTATE = '22023'; END;
  IF ok THEN pass:=pass+1; res:=res||'N14 PASS | '; ELSE fail:=fail+1; res:=res||'N14 FAIL listas del reporte | '; END IF;
  -- devolución: reingreso al kardex y reflejo en el reporte
  SELECT id INTO v1 FROM public.pos_venta_items WHERE venta_id = (SELECT id FROM public.pos_ventas WHERE idempotency_key = 'neg-v-001') LIMIT 1;
  r2 := public.pos_devolver_venta(jsonb_build_object('ventaId',(SELECT id FROM public.pos_ventas WHERE idempotency_key = 'neg-v-001'),'items',jsonb_build_array(jsonb_build_object('itemId',v1,'cantidad',1)),
        'motivo','Producto defectuoso','motivoTipo','Producto defectuoso','idempotency_key','neg-dev-001'));
  SELECT count(*) INTO n FROM public.inv_movimientos WHERE producto_id = p1 AND tipo = 'Devolución' AND cantidad = 1;
  r := public.pos_reporte_ventas((now() AT TIME ZONE 'America/Guatemala')::date, (now() AT TIME ZONE 'America/Guatemala')::date, NULL);
  IF n = 1 AND (r -> 'kpis' ->> 'devoluciones')::numeric > 0 AND (r -> 'kpis' ->> 'ventas_netas')::numeric < (r -> 'kpis' ->> 'ventas_brutas')::numeric THEN pass:=pass+1; res:=res||'N15 PASS | '; ELSE fail:=fail+1; res:=res||'N15 FAIL devolución en kardex/reporte | '; END IF;
  RESET ROLE;

  -- ── Comisiones ────────────────────────────────────────────────────────
  PERFORM pg_temp.setcfg('{"comision_pct_default":5}'::jsonb);
  PERFORM pg_temp.setperm('{"submenus":[],"pos":[],"pos_comision_pct":10}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','neg-v-003','items',jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),'pagos',pagoE));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.pos_reporte_comisiones((now() AT TIME ZONE 'America/Guatemala')::date, (now() AT TIME ZONE 'America/Guatemala')::date);
  SELECT x INTO r2 FROM jsonb_array_elements(r -> 'filas') x WHERE x ->> 'cajero' = 'test_agente_azyvion';
  ok := (r2 ->> 'pct')::numeric = 10 AND (r2 ->> 'comision')::numeric = round((r2 ->> 'base')::numeric * 10 / 100, 2);
  SELECT x INTO r2 FROM jsonb_array_elements(r -> 'filas') x WHERE x ->> 'cajero' = 'Hector Reyes';
  ok := ok AND (r2 ->> 'pct')::numeric = 5 AND (r ->> 'total_comisiones')::numeric > 0;
  IF ok THEN pass:=pass+1; res:=res||'N16 PASS | '; ELSE fail:=fail+1; res:=res||'N16 FAIL comisiones '||r::text||' | '; END IF;

  -- ── Auditoría (solo admin) ────────────────────────────────────────────
  r := public.pos_listar_auditoria(current_date - 1, current_date + 1, 'compra.', 100);
  SELECT count(*) INTO n FROM jsonb_array_elements(r -> 'filas') x WHERE x ->> 'accion' = 'compra.registrar';
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_listar_auditoria(NULL, NULL, NULL, 10); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  RESET ROLE;
  IF n >= 3 AND ok THEN pass:=pass+1; res:=res||'N17 PASS | '; ELSE fail:=fail+1; res:=res||'N17 FAIL auditoría n='||n||' | '; END IF;

  -- ── Ajustes, conteo físico y reposición ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.inv_ajustar(p1, 5, 'sin permiso de ajuste'); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.inv_ajustar(p1, 5, 'x'); ok := ok AND false; EXCEPTION WHEN OTHERS THEN ok := ok AND SQLSTATE = '22023'; END;
  SELECT unidades INTO v FROM public."Inventario" WHERE id = p1;
  r := public.inv_ajustar(p1, v - 3, 'Merma por rotura');
  SELECT count(*) INTO n FROM public.inv_movimientos WHERE producto_id = p1 AND tipo = 'Ajuste' AND cantidad = -3 AND motivo = 'Merma por rotura';
  UPDATE public."Inventario" SET unidades = unidades + 1 WHERE id = p1;           -- edición manual desde el formulario
  SELECT count(*) INTO e FROM public.inv_movimientos WHERE producto_id = p1 AND tipo = 'Ajuste manual' AND cantidad = 1;
  IF ok AND n = 1 AND e = 1 THEN pass:=pass+1; res:=res||'N18 PASS | '; ELSE fail:=fail+1; res:=res||'N18 FAIL ajustes n='||n||' e='||e||' | '; END IF;
  r := public.inv_conteo_crear('Conteo QA', 'QA');
  conteo := (r ->> 'id')::uuid;
  SELECT unidades INTO v FROM public."Inventario" WHERE id = p1;
  PERFORM public.inv_conteo_guardar(conteo, jsonb_build_array(jsonb_build_object('producto_id',p1,'contado',v + 7), jsonb_build_object('producto_id',p2,'contado',NULL)));
  r2 := public.inv_conteo_aplicar(conteo, 'Conteo anual');
  SELECT unidades INTO e FROM public."Inventario" WHERE id = p1;
  SELECT count(*) INTO n FROM public.inv_movimientos WHERE producto_id = p1 AND tipo = 'Ajuste por conteo' AND cantidad = 7;
  BEGIN PERFORM public.inv_conteo_aplicar(conteo); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%ya fue aplicado%'; END;
  IF e = v + 7 AND n = 1 AND (r2 ->> 'ajustados')::int = 1 AND ok THEN pass:=pass+1; res:=res||'N19 PASS | '; ELSE fail:=fail+1; res:=res||'N19 FAIL conteo | '; END IF;
  UPDATE public."Inventario" SET stock_minimo = 100 WHERE id = p1;
  r := public.inv_reposicion();
  SELECT x INTO r2 FROM jsonb_array_elements(r -> 'filas') x WHERE x ->> 'producto' = 'QA NEG A';
  IF r2 IS NOT NULL AND (r2 ->> 'faltante')::numeric = 100 - e AND (r2 ->> 'sugerido')::numeric >= 1 AND r2 ->> 'ultimo_proveedor' = 'QA Proveedor' THEN pass:=pass+1; res:=res||'N20 PASS | '; ELSE fail:=fail+1; res:=res||'N20 FAIL reposición '||coalesce(r2::text,'sin fila')||' | '; END IF;
  RESET ROLE;

  -- ── Historial de cliente y seguimiento ────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.pos_historial_cliente(vcli, 50);
  ok := (r -> 'resumen' ->> 'compras')::int = 1 AND jsonb_array_length(r -> 'ventas') = 1 AND (r -> 'top_productos' -> 0 ->> 'producto') = 'QA NEG A';
  IF ok THEN pass:=pass+1; res:=res||'N21 PASS | '; ELSE fail:=fail+1; res:=res||'N21 FAIL historial '||r::text||' | '; END IF;
  RESET ROLE;
  UPDATE public.pos_ventas SET created_at = now() - interval '90 days' WHERE cliente_id = vcli;
  UPDATE public."Clientes" SET fecha_nacimiento = (current_date + 5) - interval '30 years' WHERE id = vcli;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.seguimiento_clientes(60, 14);
  SELECT count(*) INTO n FROM jsonb_array_elements(r -> 'recompra') x WHERE (x ->> 'id')::uuid = vcli AND (x ->> 'dias')::int >= 89;
  SELECT count(*) INTO e FROM jsonb_array_elements(r -> 'cumpleanos') x WHERE (x ->> 'id')::uuid = vcli AND (x ->> 'en_dias')::int = 5;
  IF n = 1 AND e = 1 THEN pass:=pass+1; res:=res||'N22 PASS | '; ELSE fail:=fail+1; res:=res||'N22 FAIL seguimiento n='||n||' cumple='||e||' | '; END IF;
  RESET ROLE;

  -- ── Código de barras único por empresa ────────────────────────────────
  UPDATE public."Inventario" SET codigo_barras = '7501234567890' WHERE id = p1;
  BEGIN UPDATE public."Inventario" SET codigo_barras = '7501234567890' WHERE id = p2; ok := false; EXCEPTION WHEN unique_violation THEN ok := true; END;
  IF ok THEN pass:=pass+1; res:=res||'N23 PASS | '; ELSE fail:=fail+1; res:=res||'N23 FAIL código de barras repetido | '; END IF;

  -- ── Aislamiento, inmutabilidad y anon ─────────────────────────────────
  IF otro IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub',otro,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.compras WHERE organization_id = org;
    SELECT count(*) INTO e FROM public.inv_movimientos WHERE organization_id = org;
    BEGIN PERFORM public.compra_anular(c1, 'intento de otra empresa'); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%no encontrada%' OR SQLSTATE = '42501'; END;
    BEGIN PERFORM public.pos_historial_cliente(vcli, 10); ok := ok AND false; EXCEPTION WHEN OTHERS THEN ok := ok AND (SQLERRM LIKE '%no encontrado%' OR SQLSTATE = '42501'); END;
    RESET ROLE;
    IF n = 0 AND e = 0 AND ok THEN pass:=pass+1; res:=res||'N24 PASS | '; ELSE fail:=fail+1; res:=res||'N24 FAIL aislamiento n='||n||' e='||e||' | '; END IF;
  ELSE res := res || 'N24 SKIP | '; END IF;
  BEGIN UPDATE public.inv_movimientos SET cantidad = 999 WHERE producto_id = p1; ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%solo inserción%'; END;
  BEGIN DELETE FROM public.compras WHERE id = c1; ok := ok AND false; EXCEPTION WHEN OTHERS THEN ok := ok AND SQLERRM LIKE '%no se eliminan%'; END;
  IF ok THEN pass:=pass+1; res:=res||'N25 PASS | '; ELSE fail:=fail+1; res:=res||'N25 FAIL kardex/compras modificables | '; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN PERFORM public.pos_reporte_ventas(current_date, current_date, NULL); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  RESET ROLE;
  IF ok THEN pass:=pass+1; res:=res||'N26 PASS | '; ELSE fail:=fail+1; res:=res||'N26 FAIL anon | '; END IF;
  BEGIN PERFORM pg_temp.setcfg('{"comision_pct_default":150}'::jsonb); ok := false; EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF ok THEN pass:=pass+1; res:=res||'N27 PASS | '; ELSE fail:=fail+1; res:=res||'N27 FAIL comisión fuera de rango | '; END IF;

  BEGIN PERFORM pg_temp.setcfg('{"encuesta_url":"javascript:alert(1)"}'::jsonb); ok := false; EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  PERFORM pg_temp.setcfg('{"encuesta_url":"https://ejemplo.com/encuesta.html?token=abc","mensaje_cumple":"Feliz cumple {nombre}"}'::jsonb);
  SELECT (public.pos_cfg(org) ->> 'encuesta_url') = 'https://ejemplo.com/encuesta.html?token=abc' AND (public.pos_cfg(org) ->> 'mensaje_recompra') LIKE 'Hola {nombre}%' INTO ok2 FROM (SELECT 1) x;
  IF ok AND ok2 THEN pass:=pass+1; res:=res||'N28 PASS | '; ELSE fail:=fail+1; res:=res||'N28 FAIL enlace de encuesta | '; END IF;

  RAISE EXCEPTION 'NEG_RESULTS: PASS=% FAIL=% | %', pass, fail, res;
END $s$;
