-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Regresión Lote 4: POS transaccional (ventas, pagos, devoluciones, cajas)
-- Requiere la migración 20261023_06_pos_ventas.sql. Usa productos/cuentas sintéticos
-- creados dentro del bloque y SIEMPRE termina en RAISE EXCEPTION → todo se revierte
-- (seguro en producción). Resultado: "POSV_RESULTS: PASS=n FAIL=m".
-- Usuarios usados (org_azyvion_001): Admin "Hector Reyes" y Agente "test_agente_azyvion".
-- ═══════════════════════════════════════════════════════════════════════
DO $s$
DECLARE
  res text := ''; pass int := 0; fail int := 0; ok boolean; r jsonb; r2 jsonb; n int; v numeric; t text;
  org text := 'org_azyvion_001';
  adm text := 'c4477277-66a8-4a3f-8379-38b3b72eafed';
  agt text := '9ed2cc01-79ce-46ed-88c2-000640635e6c';
  otro text; otra_org text;
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); sv uuid := gen_random_uuid(); b1 uuid := gen_random_uuid();
  ivapct numeric; ivamod text; caja text; v1 uuid; v7 uuid; v5 uuid; it1 uuid; exp numeric; saldo0 numeric;
  l_sale1 jsonb; l_sale5 jsonb; l_sale7 jsonb; l_ven30 jsonb;
BEGIN
  SELECT COALESCE(iva_pct, 12), COALESCE(iva_modalidad, 'incluido') INTO ivapct, ivamod FROM public."Organizations" WHERE id = org;
  INSERT INTO public."Inventario"(id, producto, tipo, unidades, "stockMax", "precioUnit", "precioPlata", "precioOro", organization_id, activo)
  VALUES (p1, 'QA POS A', 'Producto', 10, 100, 100, 90, 80, org, true),
         (p2, 'QA POS B', 'Producto', 5, 100, 50, 0, 0, org, true),
         (sv, 'QA POS Servicio', 'Servicio', 0, 100, 30, 0, 0, org, true);
  INSERT INTO public."CuentasBancarias"(id, nombre, saldo, organization_id) VALUES (b1, 'QA Banco', 0, org);
  SELECT u.auth_uid::text, u.organization_id INTO otro, otra_org FROM public."Usuarios" u
   WHERE u.organization_id <> org AND u.auth_uid IS NOT NULL LIMIT 1;

  -- ── Admin: abrir caja ───────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.pos_abrir_caja(500, 'QA');
  caja := r ->> 'cajaId';
  ok := (r ->> 'ok')::boolean AND caja LIKE 'CAJA-%';
  IF ok THEN pass:=pass+1; res:=res||'P01 PASS | '; ELSE fail:=fail+1; res:=res||'P01 FAIL abrir caja | '; END IF;
  BEGIN PERFORM public.pos_abrir_caja(100, 'dup'); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%caja abierta%'; END;
  IF ok THEN pass:=pass+1; res:=res||'P02 PASS | '; ELSE fail:=fail+1; res:=res||'P02 FAIL 2ª caja abierta | '; END IF;
  BEGIN PERFORM public.pos_abrir_caja(-5, 'x'); ok := false; EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF ok THEN pass:=pass+1; res:=res||'P03 PASS | '; ELSE fail:=fail+1; res:=res||'P03 FAIL fondo negativo | '; END IF;

  -- ── Venta en efectivo con vuelto ─────────────────────────────────────
  l_sale1 := jsonb_build_array(jsonb_build_object('id',p1,'cantidad',2,'precioUnit',100), jsonb_build_object('id',p2,'cantidad',1,'precioUnit',50));
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0001','items',l_sale1,'total',250,
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',300))));
  v1 := (r -> 'ticket' ->> 'ventaId')::uuid;
  ok := (r ->> 'duplicado')::boolean = false AND (r -> 'ticket' ->> 'total')::numeric = 250 AND (r -> 'ticket' ->> 'cambio')::numeric = 50
        AND (r -> 'ticket' ->> 'cajaTurnoId') = caja AND (r -> 'ticket' ->> 'numero') ~ '-[0-9]{4}-[0-9]{5}$';
  IF ok THEN pass:=pass+1; res:=res||'P04 PASS | '; ELSE fail:=fail+1; res:=res||'P04 FAIL venta efectivo '||r::text||' | '; END IF;
  SELECT unidades INTO v FROM public."Inventario" WHERE id = p1;
  SELECT unidades INTO exp FROM public."Inventario" WHERE id = p2;
  ok := v = 8 AND exp = 4;
  IF ok THEN pass:=pass+1; res:=res||'P05 PASS | '; ELSE fail:=fail+1; res:=res||'P05 FAIL stock tras venta | '; END IF;
  SELECT count(*), COALESCE(sum(monto),0) INTO n, v FROM public."Transacciones" WHERE organization_id = org AND caja_turno_id = caja AND referencia = r -> 'ticket' ->> 'numero' AND tipo = 'Ingreso';
  ok := n = 1 AND v = 250;
  IF ok THEN pass:=pass+1; res:=res||'P06 PASS | '; ELSE fail:=fail+1; res:=res||'P06 FAIL contabilidad n='||n||' v='||v||' | '; END IF;

  -- ── Idempotencia: reintento con la misma clave ────────────────────────
  r2 := public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0001','items',l_sale1,'total',250,
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',300))));
  SELECT unidades INTO v FROM public."Inventario" WHERE id = p1;
  SELECT count(*) INTO n FROM public.pos_ventas WHERE organization_id = org AND idempotency_key = 'qa-key-0001';
  ok := (r2 ->> 'duplicado')::boolean AND r2 -> 'ticket' ->> 'numero' = r -> 'ticket' ->> 'numero' AND v = 8 AND n = 1;
  IF ok THEN pass:=pass+1; res:=res||'P07 PASS | '; ELSE fail:=fail+1; res:=res||'P07 FAIL idempotencia | '; END IF;
  SELECT count(*) INTO n FROM public."Transacciones" WHERE organization_id = org AND referencia = r -> 'ticket' ->> 'numero';
  IF n = 1 THEN pass:=pass+1; res:=res||'P08 PASS | '; ELSE fail:=fail+1; res:=res||'P08 FAIL transacción duplicada n='||n||' | '; END IF;

  -- ── Sobreventa y pago insuficiente: no cambian nada ───────────────────
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0003',
        'items', jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1), jsonb_build_object('id',p2,'cantidad',10)),
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',9999)))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%Existencia insuficiente%'; END;
  SELECT unidades INTO v FROM public."Inventario" WHERE id = p1;
  SELECT count(*) INTO n FROM public.pos_ventas WHERE idempotency_key = 'qa-key-0003';
  ok := ok AND v = 8 AND n = 0;
  IF ok THEN pass:=pass+1; res:=res||'P09 PASS | '; ELSE fail:=fail+1; res:=res||'P09 FAIL sobreventa | '; END IF;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0004',
        'items', jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',50)))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%Pago insuficiente%'; END;
  SELECT unidades INTO v FROM public."Inventario" WHERE id = p1;
  ok := ok AND v = 8;
  IF ok THEN pass:=pass+1; res:=res||'P10 PASS | '; ELSE fail:=fail+1; res:=res||'P10 FAIL pago insuficiente | '; END IF;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0005',
        'items', jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto','abc')))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF ok THEN pass:=pass+1; res:=res||'P11 PASS | '; ELSE fail:=fail+1; res:=res||'P11 FAIL monto inválido aceptado | '; END IF;

  -- ── Pago dividido (transferencia + efectivo) con saldo bancario ───────
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0006',
        'items', jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Transferencia','monto',100,'cuentaBancariaId',b1)))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%referencia%'; END;
  IF ok THEN pass:=pass+1; res:=res||'P12 PASS | '; ELSE fail:=fail+1; res:=res||'P12 FAIL transferencia sin referencia | '; END IF;
  l_sale5 := jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1,'precioUnit',100));
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0007','items',l_sale5,
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Transferencia','monto',60,'referencia','BOL-123','cuentaBancariaId',b1),
                                   jsonb_build_object('metodo','Efectivo','monto',50))));
  v5 := (r -> 'ticket' ->> 'ventaId')::uuid;
  SELECT saldo INTO v FROM public."CuentasBancarias" WHERE id = b1;
  SELECT count(*), COALESCE(sum(monto),0) INTO n, exp FROM public."Transacciones" WHERE organization_id = org AND referencia = r -> 'ticket' ->> 'numero';
  ok := (r -> 'ticket' ->> 'metodoPago') = 'Mixto' AND (r -> 'ticket' ->> 'cambio')::numeric = 10 AND v = 60 AND n = 2 AND exp = 100;
  IF ok THEN pass:=pass+1; res:=res||'P13 PASS | '; ELSE fail:=fail+1; res:=res||'P13 FAIL pago dividido '||r::text||' v='||v||' n='||n||' | '; END IF;

  -- ── Descuento autorizado + impuestos ──────────────────────────────────
  l_sale7 := jsonb_build_array(jsonb_build_object('id',p2,'cantidad',1,'precioUnit',50), jsonb_build_object('id',sv,'cantidad',1,'precioUnit',30));
  exp := CASE WHEN ivamod = 'sobre' THEN round(72 * (1 + ivapct/100), 2) ELSE 72 END;
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0008','items',l_sale7,'descuentoPct',10,
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',100))));
  v7 := (r -> 'ticket' ->> 'ventaId')::uuid;
  ok := (r -> 'ticket' ->> 'subtotal')::numeric = 80 AND (r -> 'ticket' ->> 'descuento')::numeric = 8 AND (r -> 'ticket' ->> 'total')::numeric = exp
        AND (r -> 'ticket' ->> 'iva')::numeric = CASE WHEN ivamod = 'sobre' THEN round(72*ivapct/100,2) ELSE round(72 - 72/(1+ivapct/100),2) END;
  IF ok THEN pass:=pass+1; res:=res||'P14 PASS | '; ELSE fail:=fail+1; res:=res||'P14 FAIL descuento/IVA '||r::text||' | '; END IF;
  SELECT unidades INTO v FROM public."Inventario" WHERE id = sv;
  IF v = 0 THEN pass:=pass+1; res:=res||'P15 PASS | '; ELSE fail:=fail+1; res:=res||'P15 FAIL servicio descontó stock | '; END IF;

  -- ── Agente sin permisos: precio, descuento y lista de precios ─────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0009',
        'items', jsonb_build_array(jsonb_build_object('id',p2,'cantidad',1,'precioUnit',1)),
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',100)))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; t := SQLSTATE||' '||SQLERRM; END;
  IF ok THEN pass:=pass+1; res:=res||'P16 PASS | '; ELSE fail:=fail+1; res:=res||'P16 FAIL precio manipulado '||coalesce(t,'sin error')||' | '; END IF;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0010',
        'items', jsonb_build_array(jsonb_build_object('id',p2,'cantidad',1)), 'descuentoPct', 5,
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',100)))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; t := SQLSTATE||' '||SQLERRM; END;
  IF ok THEN pass:=pass+1; res:=res||'P17 PASS | '; ELSE fail:=fail+1; res:=res||'P17 FAIL descuento sin permiso '||coalesce(t,'sin error')||' | '; END IF;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0011','listaPrecio','Plata',
        'items', jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1)),
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',100)))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; t := SQLSTATE||' '||SQLERRM; END;
  IF ok THEN pass:=pass+1; res:=res||'P18 PASS | '; ELSE fail:=fail+1; res:=res||'P18 FAIL lista no autorizada '||coalesce(t,'sin error')||' | '; END IF;
  -- permisos delegados: descuento hasta 5 %
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);   -- backend de confianza: el trigger de permisos no aplica
  UPDATE public."Usuarios" SET permisos = '{"submenus":[],"pos":["descuento"],"pos_descuento_max":5}'::jsonb WHERE auth_uid::text = agt;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0012',
        'items', jsonb_build_array(jsonb_build_object('id',p2,'cantidad',1)), 'descuentoPct', 5,
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',50))));
  ok := (r -> 'ticket' ->> 'descuento')::numeric = 2.5 AND (r -> 'ticket' ->> 'cajero') = 'test_agente_azyvion';
  IF ok THEN pass:=pass+1; res:=res||'P19 PASS | '; ELSE fail:=fail+1; res:=res||'P19 FAIL descuento delegado '||r::text||' | '; END IF;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0013',
        'items', jsonb_build_array(jsonb_build_object('id',p2,'cantidad',1)), 'descuentoPct', 6,
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',50)))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; t := SQLSTATE||' '||SQLERRM; END;
  IF ok THEN pass:=pass+1; res:=res||'P20 PASS | '; ELSE fail:=fail+1; res:=res||'P20 FAIL tope de descuento '||coalesce(t,'sin error')||' | '; END IF;
  -- permisos de devolución/anulación/movimientos/reimpresión denegados al agente
  BEGIN PERFORM public.pos_devolver_venta(jsonb_build_object('ventaId',v1,'motivoTipo','Otro','motivo','prueba qa','idempotency_key','qa-dev-agt1',
        'items', jsonb_build_array(jsonb_build_object('itemId', (SELECT id FROM public.pos_venta_items WHERE venta_id=v1 AND producto_id=p2),'cantidad',1)))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  IF ok THEN pass:=pass+1; res:=res||'P21 PASS | '; ELSE fail:=fail+1; res:=res||'P21 FAIL agente devolvió | '; END IF;
  BEGIN PERFORM public.pos_devolver_venta(jsonb_build_object('ventaId',v7,'anular',true,'motivoTipo','Otro','motivo','prueba qa','idempotency_key','qa-anu-agt1')); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  IF ok THEN pass:=pass+1; res:=res||'P22 PASS | '; ELSE fail:=fail+1; res:=res||'P22 FAIL agente anuló | '; END IF;
  BEGIN PERFORM public.pos_caja_movimiento('Salida', 10, 'prueba'); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  IF ok THEN pass:=pass+1; res:=res||'P23 PASS | '; ELSE fail:=fail+1; res:=res||'P23 FAIL agente movió efectivo | '; END IF;
  BEGIN PERFORM public.pos_obtener_ticket(v1, NULL, true); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  IF ok THEN pass:=pass+1; res:=res||'P24 PASS | '; ELSE fail:=fail+1; res:=res||'P24 FAIL agente reimprimió | '; END IF;
  r := public.pos_obtener_ticket(v1, NULL, false);
  IF (r ->> 'encontrada')::boolean THEN pass:=pass+1; res:=res||'P25 PASS | '; ELSE fail:=fail+1; res:=res||'P25 FAIL consulta ticket | '; END IF;
  BEGIN PERFORM public.pos_reabrir_caja(caja, 'intento de agente'); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  IF ok THEN pass:=pass+1; res:=res||'P26 PASS | '; ELSE fail:=fail+1; res:=res||'P26 FAIL agente reabrió | '; END IF;

  -- ── Admin: lista Plata, cliente nuevo con NIT ─────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0014','listaPrecio','Plata',
        'items', jsonb_build_array(jsonb_build_object('id',p1,'cantidad',1,'precioUnit',90)),
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',90))));
  ok := (r -> 'ticket' -> 'items' -> 0 ->> 'precioUnit')::numeric = 90;
  IF ok THEN pass:=pass+1; res:=res||'P27 PASS | '; ELSE fail:=fail+1; res:=res||'P27 FAIL lista Plata | '; END IF;
  l_ven30 := jsonb_build_array(jsonb_build_object('id',sv,'cantidad',1));
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0015','items',l_ven30,'clienteNombre','QA Cliente NIT','nit','9999999-K','direccion','Zona 1',
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',100))));
  r2 := public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0016','items',l_ven30,'clienteNombre','QA Cliente NIT','nit','9999999-K',
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',100))));
  SELECT count(*) INTO n FROM public."Clientes" WHERE organization_id = org AND nit = '9999999-K';
  SELECT count(*) INTO exp FROM public.pos_ventas WHERE organization_id = org AND nit = '9999999-K' AND cliente_id IS NOT NULL;
  SELECT count(*) INTO v FROM public."Clientes" WHERE organization_id = org AND nit = '9999999-K' AND "ultimaCompra" IS NOT NULL;
  ok := n = 1 AND exp = 2 AND v = 1;
  IF ok THEN pass:=pass+1; res:=res||'P28 PASS | '; ELSE fail:=fail+1; res:=res||'P28 FAIL cliente nuevo n='||n||' ventas='||exp||' | '; END IF;

  -- ── Devoluciones parciales y totales ──────────────────────────────────
  SELECT id INTO it1 FROM public.pos_venta_items WHERE venta_id = v1 AND producto_id = p1;
  r := public.pos_devolver_venta(jsonb_build_object('ventaId',v1,'motivoTipo','Otro','motivo','producto defectuoso','idempotency_key','qa-dev-0001',
        'items', jsonb_build_array(jsonb_build_object('itemId',it1,'cantidad',1))));
  SELECT unidades INTO v FROM public."Inventario" WHERE id = p1;
  SELECT estado, reembolsado INTO t, exp FROM public.pos_ventas WHERE id = v1;
  -- stock p1: 10 -2 (v1) -1 (v5) -1 (qa-0014) +1 (devolución) = 7
  ok := (r ->> 'monto')::numeric = 100 AND t = 'Devuelta parcial' AND exp = 100 AND v = 7;
  IF ok THEN pass:=pass+1; res:=res||'P29 PASS | '; ELSE fail:=fail+1; res:=res||'P29 FAIL devolución parcial '||r::text||' stock='||v||' | '; END IF;
  r2 := public.pos_devolver_venta(jsonb_build_object('ventaId',v1,'motivoTipo','Otro','motivo','producto defectuoso','idempotency_key','qa-dev-0001',
        'items', jsonb_build_array(jsonb_build_object('itemId',it1,'cantidad',1))));
  SELECT unidades INTO v FROM public."Inventario" WHERE id = p1;
  SELECT count(*) INTO n FROM public.pos_devoluciones WHERE venta_id = v1;
  ok := (r2 ->> 'duplicado')::boolean AND v = 7 AND n = 1;
  IF ok THEN pass:=pass+1; res:=res||'P30 PASS | '; ELSE fail:=fail+1; res:=res||'P30 FAIL devolución duplicada | '; END IF;
  BEGIN PERFORM public.pos_devolver_venta(jsonb_build_object('ventaId',v1,'motivoTipo','Otro','motivo','exceso de cantidad','idempotency_key','qa-dev-0002',
        'items', jsonb_build_array(jsonb_build_object('itemId',it1,'cantidad',2)))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%solo quedan%'; END;
  IF ok THEN pass:=pass+1; res:=res||'P31 PASS | '; ELSE fail:=fail+1; res:=res||'P31 FAIL exceso de devolución | '; END IF;
  BEGIN PERFORM public.pos_devolver_venta(jsonb_build_object('ventaId',v1,'anular',true,'motivoTipo','Otro','motivo','anular parcial','idempotency_key','qa-anu-0001')); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%devoluciones parciales%'; END;
  IF ok THEN pass:=pass+1; res:=res||'P32 PASS | '; ELSE fail:=fail+1; res:=res||'P32 FAIL anular tras parcial | '; END IF;
  BEGIN PERFORM public.pos_devolver_venta(jsonb_build_object('ventaId',v1,'motivoTipo','Otro','motivo','x','idempotency_key','qa-dev-0003',
        'items', jsonb_build_array(jsonb_build_object('itemId',it1,'cantidad',1)))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF ok THEN pass:=pass+1; res:=res||'P33 PASS | '; ELSE fail:=fail+1; res:=res||'P33 FAIL motivo corto aceptado | '; END IF;
  -- completar la devolución de v1 (queda 1 p1 y 1 p2): total reembolsado == total vendido (sin residuos de redondeo)
  r := public.pos_devolver_venta(jsonb_build_object('ventaId',v1,'motivoTipo','Otro','motivo','devolución completa del saldo','idempotency_key','qa-dev-0004',
        'items', jsonb_build_array(jsonb_build_object('itemId',it1,'cantidad',1),
                                   jsonb_build_object('itemId',(SELECT id FROM public.pos_venta_items WHERE venta_id=v1 AND producto_id=p2),'cantidad',1))));
  SELECT estado, reembolsado, total INTO t, exp, v FROM public.pos_ventas WHERE id = v1;
  ok := t = 'Devuelta' AND exp = v AND (r ->> 'estado') = 'Devuelta';
  IF ok THEN pass:=pass+1; res:=res||'P34 PASS | '; ELSE fail:=fail+1; res:=res||'P34 FAIL devolución total '||t||' '||exp||'/'||v||' | '; END IF;
  BEGIN PERFORM public.pos_devolver_venta(jsonb_build_object('ventaId',v1,'motivoTipo','Otro','motivo','ya devuelta','idempotency_key','qa-dev-0005',
        'items', jsonb_build_array(jsonb_build_object('itemId',it1,'cantidad',1)))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%ya fue%'; END;
  IF ok THEN pass:=pass+1; res:=res||'P35 PASS | '; ELSE fail:=fail+1; res:=res||'P35 FAIL devolver venta devuelta | '; END IF;

  -- ── Anulación de venta con descuento ──────────────────────────────────
  SELECT unidades INTO exp FROM public."Inventario" WHERE id = p2;
  r := public.pos_devolver_venta(jsonb_build_object('ventaId',v7,'anular',true,'motivoTipo','Otro','motivo','error de digitación','idempotency_key','qa-anu-0002'));
  SELECT unidades INTO v FROM public."Inventario" WHERE id = p2;
  SELECT estado, reembolsado INTO t, saldo0 FROM public.pos_ventas WHERE id = v7;
  ok := t = 'Anulada' AND saldo0 = (SELECT total FROM public.pos_ventas WHERE id = v7) AND v = exp + 1 AND (r ->> 'monto')::numeric = saldo0;
  IF ok THEN pass:=pass+1; res:=res||'P36 PASS | '; ELSE fail:=fail+1; res:=res||'P36 FAIL anulación | '; END IF;
  SELECT count(*) INTO n FROM public."Transacciones" WHERE organization_id = org AND tipo = 'Egreso' AND concepto LIKE 'Anulación POS%' AND caja_turno_id = caja;
  IF n = 1 THEN pass:=pass+1; res:=res||'P37 PASS | '; ELSE fail:=fail+1; res:=res||'P37 FAIL egreso de anulación | '; END IF;

  -- ── Entradas / salidas de efectivo ────────────────────────────────────
  BEGIN PERFORM public.pos_caja_movimiento('Salida', 9999999, 'retiro imposible'); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%supera el efectivo%'; END;
  IF ok THEN pass:=pass+1; res:=res||'P38 PASS | '; ELSE fail:=fail+1; res:=res||'P38 FAIL salida excesiva | '; END IF;
  PERFORM public.pos_caja_movimiento('Salida', 20, 'pago a mensajero');
  r := public.pos_caja_movimiento('Entrada', 10, 'cambio de billetes');
  -- ── Reembolso electrónico con cuenta bancaria ─────────────────────────
  r2 := public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0020','items',jsonb_build_array(jsonb_build_object('id',sv,'cantidad',1)),
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Transferencia','monto',30,'referencia','TRX-777','cuentaBancariaId',b1))));
  SELECT saldo INTO saldo0 FROM public."CuentasBancarias" WHERE id = b1;      -- 60 + 30
  r2 := public.pos_devolver_venta(jsonb_build_object('ventaId',(r2 -> 'ticket' ->> 'ventaId')::uuid,'anular',true,'motivoTipo','Otro','motivo','cliente se arrepintió',
        'idempotency_key','qa-anu-0003','metodoReembolso','Transferencia','cuentaBancariaId',b1,'referencia','REF-1'));
  SELECT saldo INTO v FROM public."CuentasBancarias" WHERE id = b1;
  ok := saldo0 = 90 AND v = 60 AND (r2 ->> 'monto')::numeric = 30;
  IF ok THEN pass:=pass+1; res:=res||'P39 PASS | '; ELSE fail:=fail+1; res:=res||'P39 FAIL saldo bancario '||saldo0||'/'||v||' | '; END IF;

  -- ── Resumen del turno: valor esperado calculado de forma independiente ─
  -- efectivo aplicado: 250 (v1) + 40 (split) + total v7 + 47.50 + total plata 90 + 30 + 30 (clientes NIT)  ;  menos reembolsos efectivo; ±movimientos
  RESET ROLE;
  SELECT COALESCE(sum(g.monto),0) INTO exp FROM public.pos_venta_pagos g JOIN public.pos_ventas vv ON vv.id=g.venta_id WHERE vv.caja_turno_id = caja AND g.metodo='Efectivo';
  SELECT COALESCE(sum(monto),0) INTO v FROM public.pos_devoluciones WHERE caja_turno_id = caja AND metodo_reembolso='Efectivo';
  exp := 500 + exp - v + 10 - 20;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.pos_estado_caja();
  ok := (r ->> 'cajaAbierta')::boolean AND (r -> 'resumen' ->> 'esperado')::numeric = exp AND (r -> 'resumen' ->> 'tickets')::int >= 8;
  IF ok THEN pass:=pass+1; res:=res||'P40 PASS | '; ELSE fail:=fail+1; res:=res||'P40 FAIL esperado '||(r -> 'resumen' ->> 'esperado')||' vs '||exp||' | '; END IF;

  -- ── Cierre: diferencia obliga a explicar; cierre único e inmutable ─────
  BEGIN PERFORM public.pos_cerrar_caja(caja, exp - 17.5, ''); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%diferencia%'; END;
  IF ok THEN pass:=pass+1; res:=res||'P41 PASS | '; ELSE fail:=fail+1; res:=res||'P41 FAIL cierre con diferencia sin explicar | '; END IF;
  r := public.pos_cerrar_caja(caja, exp - 17.5, 'Faltante de billetes por confirmar');
  ok := (r ->> 'diferencia')::numeric = -17.5 AND (r ->> 'estado') = 'CERRADA' AND (r ->> 'esperado')::numeric = exp;
  IF ok THEN pass:=pass+1; res:=res||'P42 PASS | '; ELSE fail:=fail+1; res:=res||'P42 FAIL cierre '||r::text||' | '; END IF;
  BEGIN PERFORM public.pos_cerrar_caja(caja, exp, 'doble cierre'); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%ya fue cerrado%'; END;
  IF ok THEN pass:=pass+1; res:=res||'P43 PASS | '; ELSE fail:=fail+1; res:=res||'P43 FAIL doble cierre | '; END IF;
  BEGIN UPDATE public."Cajas_Turnos" SET efectivo_contado = 1 WHERE id = caja; ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  IF ok THEN pass:=pass+1; res:=res||'P44 PASS | '; ELSE fail:=fail+1; res:=res||'P44 FAIL cajero editó cierre | '; END IF;
  RESET ROLE;
  BEGIN UPDATE public."Cajas_Turnos" SET efectivo_contado = 1 WHERE id = caja; ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%ya está cerrado%'; END;
  IF ok THEN pass:=pass+1; res:=res||'P45 PASS | '; ELSE fail:=fail+1; res:=res||'P45 FAIL cierre modificable | '; END IF;
  BEGIN DELETE FROM public.pos_ventas WHERE id = v1; ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%no se eliminan%'; END;
  IF ok THEN pass:=pass+1; res:=res||'P46 PASS | '; ELSE fail:=fail+1; res:=res||'P46 FAIL venta borrable | '; END IF;
  BEGIN DELETE FROM public.pos_auditoria; ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%solo inserción%'; END;
  IF ok THEN pass:=pass+1; res:=res||'P47 PASS | '; ELSE fail:=fail+1; res:=res||'P47 FAIL auditoría borrable | '; END IF;

  -- ── Sin caja abierta ─────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0030','items',l_ven30,
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',30)))); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%caja abierta%'; END;
  IF ok THEN pass:=pass+1; res:=res||'P48 PASS | '; ELSE fail:=fail+1; res:=res||'P48 FAIL venta con caja cerrada | '; END IF;
  r := public.pos_registrar_venta(jsonb_build_object('idempotency_key','qa-key-0031','items',l_ven30,'permitir_sin_caja',true,
        'pagos', jsonb_build_array(jsonb_build_object('metodo','Efectivo','monto',30))));
  IF (r -> 'ticket' ->> 'cajaTurnoId') IS NULL THEN pass:=pass+1; res:=res||'P49 PASS | '; ELSE fail:=fail+1; res:=res||'P49 FAIL permitir_sin_caja | '; END IF;
  BEGIN PERFORM public.pos_devolver_venta(jsonb_build_object('ventaId',(r -> 'ticket' ->> 'ventaId')::uuid,'anular',true,'motivoTipo','Otro','motivo','sin caja abierta','idempotency_key','qa-anu-0004')); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%caja abierta%'; END;
  IF ok THEN pass:=pass+1; res:=res||'P50 PASS | '; ELSE fail:=fail+1; res:=res||'P50 FAIL reembolso efectivo sin caja | '; END IF;

  -- ── Reapertura autorizada y auditada ──────────────────────────────────
  BEGIN PERFORM public.pos_reabrir_caja(caja, 'x'); ok := false; EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF ok THEN pass:=pass+1; res:=res||'P51 PASS | '; ELSE fail:=fail+1; res:=res||'P51 FAIL reapertura sin motivo | '; END IF;
  PERFORM public.pos_reabrir_caja(caja, 'Corrección de conteo autorizada por gerencia');
  SELECT estado INTO t FROM public."Cajas_Turnos" WHERE id = caja;
  SELECT count(*) INTO n FROM public.pos_auditoria WHERE accion = 'caja.reabrir' AND entidad_id = caja AND detalle -> 'cierre_previo' ->> 'diferencia' IS NOT NULL;
  ok := t = 'ABIERTA' AND n = 1;
  IF ok THEN pass:=pass+1; res:=res||'P52 PASS | '; ELSE fail:=fail+1; res:=res||'P52 FAIL reapertura/auditoría | '; END IF;
  PERFORM public.pos_obtener_ticket(v1, NULL, true);
  SELECT count(*) INTO n FROM public.pos_auditoria WHERE accion = 'venta.reimprimir' AND entidad_id = v1::text;
  IF n = 1 THEN pass:=pass+1; res:=res||'P53 PASS | '; ELSE fail:=fail+1; res:=res||'P53 FAIL auditoría de reimpresión | '; END IF;

  -- ── Numeración única ──────────────────────────────────────────────────
  SELECT count(*) = count(DISTINCT numero) INTO ok FROM public.pos_ventas WHERE organization_id = org;
  IF ok THEN pass:=pass+1; res:=res||'P54 PASS | '; ELSE fail:=fail+1; res:=res||'P54 FAIL números repetidos | '; END IF;

  -- ── Aislamiento multi-organización y anon ─────────────────────────────
  IF otro IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub',otro,'role','authenticated')::text, true);
    SELECT count(*) INTO n FROM public.pos_ventas WHERE organization_id = org;
    BEGIN PERFORM public.pos_devolver_venta(jsonb_build_object('ventaId',v5,'anular',true,'motivoTipo','Otro','motivo','intento ajeno','idempotency_key','qa-ajeno-001')); ok := false;
    EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%Venta no encontrada%' OR SQLSTATE = '42501'; END;
    r := public.pos_obtener_ticket(v5, NULL, false);
    ok := ok AND n = 0 AND NOT (r ->> 'encontrada')::boolean;
    IF ok THEN pass:=pass+1; res:=res||'P55 PASS | '; ELSE fail:=fail+1; res:=res||'P55 FAIL aislamiento entre organizaciones n='||n||' | '; END IF;
  ELSE res := res || 'P55 SKIP (sin otra organización) | '; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN PERFORM public.pos_registrar_venta('{}'::jsonb); ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  IF ok THEN pass:=pass+1; res:=res||'P56 PASS | '; ELSE fail:=fail+1; res:=res||'P56 FAIL anon ejecuta POS | '; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN INSERT INTO public.pos_ventas(organization_id, numero, idempotency_key, subtotal, total, cajero) VALUES (org,'X','xxxxxxxx',1,1,'x'); ok := false;
  EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  IF ok THEN pass:=pass+1; res:=res||'P57 PASS | '; ELSE fail:=fail+1; res:=res||'P57 FAIL escritura directa en pos_ventas | '; END IF;
  RESET ROLE;

  -- ── Autoasignación de permisos (hallazgo: usuarios_update_self no protegía `permisos`) ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub',agt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN UPDATE public."Usuarios" SET permisos = '{"pos":["anular","devolver","descuento","editar_precio"],"pos_descuento_max":100}'::jsonb WHERE auth_uid::text = agt;
        GET DIAGNOSTICS n = ROW_COUNT; ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  IF ok THEN pass:=pass+1; res:=res||'P58 PASS | '; ELSE fail:=fail+1; res:=res||'P58 FAIL el agente se autoasignó permisos | '; END IF;
  BEGIN UPDATE public."Usuarios" SET sucursal_id = 'OTRA-SUCURSAL' WHERE auth_uid::text = agt; ok := false; EXCEPTION WHEN OTHERS THEN ok := SQLSTATE = '42501'; END;
  IF ok THEN pass:=pass+1; res:=res||'P59 PASS | '; ELSE fail:=fail+1; res:=res||'P59 FAIL el agente cambió su sucursal | '; END IF;
  UPDATE public."Usuarios" SET cargo = 'Cajero QA' WHERE auth_uid::text = agt;      -- campos de perfil siguen editables
  SELECT cargo INTO t FROM public."Usuarios" WHERE auth_uid::text = agt;
  IF t = 'Cajero QA' THEN pass:=pass+1; res:=res||'P60 PASS | '; ELSE fail:=fail+1; res:=res||'P60 FAIL perfil propio no editable | '; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',adm,'role','authenticated')::text, true);
  UPDATE public."Usuarios" SET permisos = '{"submenus":[],"pos":["devolver"]}'::jsonb WHERE auth_uid::text = agt;
  SELECT permisos::text INTO t FROM public."Usuarios" WHERE auth_uid::text = agt;
  IF t LIKE '%devolver%' THEN pass:=pass+1; res:=res||'P61 PASS | '; ELSE fail:=fail+1; res:=res||'P61 FAIL el admin no pudo asignar permisos | '; END IF;
  RESET ROLE;

  RAISE EXCEPTION 'POSV_RESULTS: PASS=% FAIL=% | %', pass, fail, res;
END $s$;
