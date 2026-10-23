-- Reversión de 20261023_07_pos_config.sql: restaura las funciones del POS de la migración 06
-- y quita la configuración (columnas, trigger y funciones).

CREATE OR REPLACE FUNCTION public.pos_ticket_json(p_venta uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'ventaId', v.id, 'numero', v.numero, 'fecha', v.created_at, 'estado', v.estado,
    'cliente', v.cliente_nombre, 'clienteId', v.cliente_id, 'nit', v.nit, 'direccion', v.direccion,
    'listaPrecio', v.lista_precio,
    'subtotal', v.subtotal, 'descuentoPct', v.descuento_pct, 'descuento', v.descuento,
    'ivaPct', v.iva_pct, 'ivaModalidad', v.iva_modalidad, 'iva', v.iva_monto,
    'total', v.total, 'montoRecibido', v.monto_recibido, 'cambio', v.cambio, 'reembolsado', v.reembolsado,
    'cajero', v.cajero, 'cajaTurnoId', v.caja_turno_id, 'sucursalId', v.sucursal_id,
    'motivoAnulacion', v.motivo_anulacion,
    'metodoPago', CASE WHEN (SELECT count(*) FROM public.pos_venta_pagos g WHERE g.venta_id = v.id) > 1 THEN 'Mixto'
                       ELSE (SELECT g.metodo FROM public.pos_venta_pagos g WHERE g.venta_id = v.id LIMIT 1) END,
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'itemId', i.id, 'id', i.producto_id, 'descripcion', i.descripcion, 'sku', i.sku, 'tipo', i.tipo,
                'cantidad', i.cantidad, 'precioUnit', i.precio_unit, 'total', i.total,
                'cantidadDevuelta', i.cantidad_devuelta) ORDER BY i.orden)
              FROM public.pos_venta_items i WHERE i.venta_id = v.id), '[]'::jsonb),
    'pagos', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'metodo', g.metodo, 'monto', g.monto, 'recibido', g.recibido,
                'referencia', g.referencia, 'cuentaBancariaId', g.cuenta_bancaria_id) ORDER BY g.metodo)
              FROM public.pos_venta_pagos g WHERE g.venta_id = v.id), '[]'::jsonb)
  )
  FROM public.pos_ventas v WHERE v.id = p_venta;
$$;

-- Resumen de un turno (ventas por método, movimientos, devoluciones, efectivo esperado)
CREATE OR REPLACE FUNCTION public.pos_resumen_turno_int(p_org text, p_caja text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t record; ve numeric; vt numeric; vtr numeric; ent numeric; sal numeric; de numeric; dot numeric;
  nt int; na int; esperado numeric;
BEGIN
  SELECT * INTO t FROM public."Cajas_Turnos" WHERE id = p_caja AND organization_id = p_org;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(g.monto) FILTER (WHERE g.metodo = 'Efectivo'), 0),
         COALESCE(sum(g.monto) FILTER (WHERE g.metodo = 'Tarjeta'), 0),
         COALESCE(sum(g.monto) FILTER (WHERE g.metodo = 'Transferencia'), 0)
    INTO ve, vt, vtr
    FROM public.pos_venta_pagos g JOIN public.pos_ventas v ON v.id = g.venta_id
   WHERE v.organization_id = p_org AND v.caja_turno_id = p_caja;
  SELECT count(*) INTO nt FROM public.pos_ventas WHERE organization_id = p_org AND caja_turno_id = p_caja;
  SELECT count(*) INTO na FROM public.pos_devoluciones WHERE organization_id = p_org AND caja_turno_id = p_caja AND tipo = 'Anulación';
  SELECT COALESCE(sum(monto) FILTER (WHERE tipo = 'Entrada'), 0), COALESCE(sum(monto) FILTER (WHERE tipo = 'Salida'), 0)
    INTO ent, sal FROM public.pos_caja_movimientos WHERE organization_id = p_org AND caja_turno_id = p_caja;
  SELECT COALESCE(sum(monto) FILTER (WHERE metodo_reembolso = 'Efectivo'), 0),
         COALESCE(sum(monto) FILTER (WHERE metodo_reembolso <> 'Efectivo'), 0)
    INTO de, dot FROM public.pos_devoluciones WHERE organization_id = p_org AND caja_turno_id = p_caja;
  esperado := round(t.monto_inicial + ve + ent - sal - de, 2);
  RETURN jsonb_build_object(
    'cajaId', t.id, 'estado', t.estado, 'cajero', t.cajero, 'sucursalId', t.sucursal_id,
    'fechaApertura', t.fecha_apertura, 'fechaCierre', t.fecha_cierre,
    'montoInicial', t.monto_inicial, 'ventasEfectivo', ve, 'ventasTarjeta', vt, 'ventasTransferencia', vtr,
    'totalVentas', ve + vt + vtr, 'tickets', nt, 'anulaciones', na,
    'entradas', ent, 'salidas', sal, 'devolucionesEfectivo', de, 'devolucionesOtros', dot,
    'esperado', esperado, 'contado', t.efectivo_contado, 'diferencia', t.diferencia,
    'observaciones', t.observaciones, 'cerradoPor', t.cerrado_por);
END $$;

CREATE OR REPLACE FUNCTION public.pos_estado_caja()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; t record; r jsonb;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public."Cajas_Turnos"
   WHERE organization_id = c.org AND estado = 'ABIERTA' AND sucursal_id IS NOT DISTINCT FROM c.sucursal
   ORDER BY fecha_apertura DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'cajaAbierta', false); END IF;
  r := public.pos_resumen_turno_int(c.org, t.id);
  RETURN jsonb_build_object('ok', true, 'cajaAbierta', true, 'cajaId', t.id, 'cajero', t.cajero,
    'montoInicial', t.monto_inicial, 'fecha', t.fecha_apertura, 'sucursalId', t.sucursal_id, 'resumen', r);
END $$;

CREATE OR REPLACE FUNCTION public.pos_cerrar_caja(p_caja_id text, p_contado numeric, p_obs text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; t record; r jsonb; v_esp numeric; v_dif numeric;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF p_contado IS NULL OR p_contado < 0 OR p_contado > 100000000 OR round(p_contado, 2) <> p_contado THEN
    RAISE EXCEPTION 'El efectivo contado debe ser un monto válido (0 o más, hasta 2 decimales).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public."Cajas_Turnos" WHERE id = p_caja_id AND organization_id = c.org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Turno de caja no encontrado.' USING ERRCODE = 'P0001'; END IF;
  IF t.estado <> 'ABIERTA' THEN RAISE EXCEPTION 'El turno % ya fue cerrado.', t.id USING ERRCODE = 'P0001'; END IF;
  IF NOT (c.privilegiado OR t.cajero = c.usuario OR public.pos_puede(false, c.perms, 'caja_mov')) THEN
    RAISE EXCEPTION 'Solo quien abrió la caja o un administrador puede cerrarla.' USING ERRCODE = '42501';
  END IF;
  r := public.pos_resumen_turno_int(c.org, t.id);
  v_esp := (r ->> 'esperado')::numeric;
  v_dif := round(p_contado - v_esp, 2);
  IF v_dif <> 0 AND length(btrim(COALESCE(p_obs, ''))) < 3 THEN
    RAISE EXCEPTION 'Hay una diferencia de Q % en el cuadre: explíquela en las observaciones.', v_dif USING ERRCODE = 'P0001';
  END IF;
  UPDATE public."Cajas_Turnos" SET
    fecha_cierre = now(), estado = 'CERRADA', cerrado_por = c.usuario,
    ventas_efectivo = (r ->> 'ventasEfectivo')::numeric, ventas_tarjeta = (r ->> 'ventasTarjeta')::numeric,
    ventas_transferencia = (r ->> 'ventasTransferencia')::numeric, ventas_otros = 0,
    entradas = (r ->> 'entradas')::numeric, salidas = (r ->> 'salidas')::numeric,
    devoluciones_efectivo = (r ->> 'devolucionesEfectivo')::numeric, devoluciones_otros = (r ->> 'devolucionesOtros')::numeric,
    tickets = (r ->> 'tickets')::int, total_esperado = v_esp, efectivo_contado = p_contado, diferencia = v_dif,
    observaciones = btrim(COALESCE(p_obs, ''))
  WHERE id = t.id;
  PERFORM public.pos_audit(c.org, 'caja.cerrar', 'Cajas_Turnos', t.id, c.usuario,
    jsonb_build_object('esperado', v_esp, 'contado', p_contado, 'diferencia', v_dif));
  RETURN jsonb_build_object('ok', true) || public.pos_resumen_turno_int(c.org, t.id);
END $$;

CREATE OR REPLACE FUNCTION public.pos_registrar_venta(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c record; v_key text; v_exist uuid;
  it jsonb; inv record; v_ids uuid[]; v_cli record; v_lista text; v_cli_lista text;
  v_cant numeric; v_precio numeric; v_lp numeric; v_pla numeric; v_oro numeric;
  v_lines jsonb := '[]'::jsonb; v_orden int := 0; v_subtotal numeric := 0; v_linea numeric;
  v_pct numeric; v_desc numeric; v_base numeric; v_total numeric; v_iva numeric := 0; v_ivapct numeric := 12; v_ivamod text := 'incluido';
  v_pref text := 'POS-'; v_anio int; v_seq int; v_numero text;
  v_turno text; v_sucursal text; v_venta uuid := gen_random_uuid();
  pg jsonb; v_metodo text; v_monto numeric; v_ref text; v_cta uuid;
  v_noncash numeric := 0; v_cash_recv numeric := 0; v_cash_app numeric; v_cambio numeric;
  v_trx uuid; v_cli_id uuid; v_cli_nombre text; v_nit text; v_dir text; v_pagos_n int := 0;
  v_cf constant text := 'Consumidor Final (C/F)'; v_hoy date;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Solicitud inválida.' USING ERRCODE = '22023'; END IF;

  v_key := btrim(COALESCE(p ->> 'idempotency_key', ''));
  IF length(v_key) < 8 OR length(v_key) > 100 THEN RAISE EXCEPTION 'Falta la clave de idempotencia de la venta.' USING ERRCODE = '22023'; END IF;

  -- Idempotencia: el mismo intento (doble clic, reintento tras corte de red) devuelve la venta ya registrada.
  PERFORM pg_advisory_xact_lock(hashtext('pos_venta:' || c.org || ':' || v_key));
  SELECT id INTO v_exist FROM public.pos_ventas WHERE organization_id = c.org AND idempotency_key = v_key;
  IF v_exist IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicado', true, 'ticket', public.pos_ticket_json(v_exist));
  END IF;

  IF jsonb_typeof(p -> 'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'items') = 0 THEN
    RAISE EXCEPTION 'Agregue al menos un producto a la venta.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p -> 'items') > 200 THEN RAISE EXCEPTION 'La venta supera el máximo de 200 líneas.' USING ERRCODE = '22023'; END IF;

  -- Turno de caja del servidor (no se confía en el cliente)
  v_sucursal := c.sucursal;
  SELECT id INTO v_turno FROM public."Cajas_Turnos"
   WHERE organization_id = c.org AND estado = 'ABIERTA' AND sucursal_id IS NOT DISTINCT FROM v_sucursal
   ORDER BY fecha_apertura DESC LIMIT 1 FOR SHARE;   -- serializa con el cierre de caja
  IF v_turno IS NULL AND COALESCE((p ->> 'permitir_sin_caja')::boolean, false) = false THEN
    RAISE EXCEPTION 'No hay una caja abierta. Abra la caja antes de cobrar.' USING ERRCODE = 'P0001';
  END IF;

  -- Cliente / lista de precios
  v_cli_id := NULL; v_cli_nombre := COALESCE(NULLIF(btrim(p ->> 'clienteNombre'), ''), v_cf);
  v_nit := COALESCE(NULLIF(upper(btrim(p ->> 'nit')), ''), 'C/F'); v_dir := NULLIF(btrim(COALESCE(p ->> 'direccion', '')), '');
  v_cli_lista := 'Publico';
  IF COALESCE(p ->> 'clienteId', '') <> '' THEN
    SELECT id, nombre, nit, direccion, COALESCE(lista_precio, 'Publico') AS lista INTO v_cli
      FROM public."Clientes" WHERE id = (p ->> 'clienteId')::uuid AND organization_id = c.org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado.' USING ERRCODE = 'P0001'; END IF;
    v_cli_id := v_cli.id; v_cli_nombre := v_cli.nombre; v_nit := COALESCE(NULLIF(upper(btrim(v_cli.nit)), ''), 'C/F');
    v_dir := COALESCE(NULLIF(btrim(v_cli.direccion), ''), v_dir); v_cli_lista := v_cli.lista;
  END IF;
  v_lista := COALESCE(NULLIF(p ->> 'listaPrecio', ''), 'Publico');
  IF v_lista NOT IN ('Publico', 'Plata', 'Oro') THEN RAISE EXCEPTION 'Lista de precios inválida.' USING ERRCODE = '22023'; END IF;
  IF v_lista <> 'Publico' AND v_lista <> v_cli_lista AND NOT public.pos_puede(c.privilegiado, c.perms, 'editar_precio') THEN
    RAISE EXCEPTION 'La lista de precios "%" no corresponde al cliente y no tiene permiso para cambiarla.', v_lista USING ERRCODE = '42501';
  END IF;

  -- Bloquear inventario involucrado en orden fijo (evita interbloqueos)
  SELECT array_agg(DISTINCT (x ->> 'id')::uuid ORDER BY (x ->> 'id')::uuid) INTO v_ids
    FROM jsonb_array_elements(p -> 'items') x WHERE COALESCE(x ->> 'id', '') <> '';
  IF v_ids IS NOT NULL THEN
    PERFORM 1 FROM public."Inventario" WHERE id = ANY (v_ids) AND organization_id = c.org ORDER BY id FOR UPDATE;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p -> 'items') LOOP
    v_orden := v_orden + 1;
    IF COALESCE(it ->> 'id', '') = '' THEN RAISE EXCEPTION 'La línea % no tiene producto.', v_orden USING ERRCODE = '22023'; END IF;
    BEGIN v_cant := (it ->> 'cantidad')::numeric; EXCEPTION WHEN others THEN v_cant := NULL; END;
    IF v_cant IS NULL OR v_cant <= 0 OR v_cant > 100000 OR round(v_cant, 3) <> v_cant THEN
      RAISE EXCEPTION 'Cantidad inválida en la línea %.', v_orden USING ERRCODE = '22023';
    END IF;
    SELECT * INTO inv FROM public."Inventario" WHERE id = (it ->> 'id')::uuid AND organization_id = c.org;
    IF NOT FOUND OR COALESCE(inv.activo, true) = false THEN
      RAISE EXCEPTION 'El producto de la línea % no está disponible.', v_orden USING ERRCODE = 'P0001';
    END IF;
    v_lp := COALESCE(inv."precioUnit", 0); v_pla := COALESCE(inv."precioPlata", 0); v_oro := COALESCE(inv."precioOro", 0);
    v_precio := CASE v_lista WHEN 'Plata' THEN CASE WHEN v_pla > 0 THEN v_pla ELSE v_lp END
                             WHEN 'Oro'   THEN CASE WHEN v_oro > 0 THEN v_oro WHEN v_pla > 0 THEN v_pla ELSE v_lp END
                             ELSE v_lp END;
    IF it ? 'precioUnit' AND abs(COALESCE((it ->> 'precioUnit')::numeric, v_precio) - v_precio) > 0.005 THEN
      IF NOT public.pos_puede(c.privilegiado, c.perms, 'editar_precio') THEN
        RAISE EXCEPTION 'No tiene permiso para modificar el precio de "%".', inv.producto USING ERRCODE = '42501';
      END IF;
      v_precio := round((it ->> 'precioUnit')::numeric, 2);
      IF v_precio < 0 THEN RAISE EXCEPTION 'Precio inválido en la línea %.', v_orden USING ERRCODE = '22023'; END IF;
    END IF;
    IF COALESCE(inv.tipo, 'Producto') <> 'Servicio' THEN
      UPDATE public."Inventario" SET unidades = unidades - v_cant WHERE id = inv.id AND unidades >= v_cant;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Existencia insuficiente para "%" (disponible: %).', inv.producto, inv.unidades USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_linea := round(v_cant * v_precio, 2);
    v_subtotal := v_subtotal + v_linea;
    v_lines := v_lines || jsonb_build_object('orden', v_orden, 'producto_id', inv.id, 'descripcion', inv.producto,
                'sku', inv.sku, 'tipo', COALESCE(inv.tipo, 'Producto'), 'cantidad', v_cant, 'precio', v_precio, 'total', v_linea);
  END LOOP;
  v_subtotal := round(v_subtotal, 2);
  IF v_subtotal <= 0 THEN RAISE EXCEPTION 'El subtotal de la venta debe ser mayor a cero.' USING ERRCODE = '22023'; END IF;

  -- Descuento (con permiso y tope)
  BEGIN v_pct := COALESCE((p ->> 'descuentoPct')::numeric, 0); EXCEPTION WHEN others THEN v_pct := NULL; END;
  IF v_pct IS NULL OR v_pct < 0 OR v_pct > 100 OR round(v_pct, 2) <> v_pct THEN
    RAISE EXCEPTION 'El descuento debe estar entre 0 y 100 por ciento.' USING ERRCODE = '22023';
  END IF;
  IF v_pct > 0 THEN
    IF NOT public.pos_puede(c.privilegiado, c.perms, 'descuento') THEN
      RAISE EXCEPTION 'No tiene permiso para aplicar descuentos.' USING ERRCODE = '42501';
    END IF;
    IF NOT c.privilegiado AND v_pct > COALESCE((c.perms ->> 'pos_descuento_max')::numeric, 10) THEN
      RAISE EXCEPTION 'Su descuento máximo autorizado es de % por ciento.', COALESCE((c.perms ->> 'pos_descuento_max')::numeric, 10) USING ERRCODE = '42501';
    END IF;
  END IF;
  v_desc := round(v_subtotal * v_pct / 100, 2);
  v_base := round(v_subtotal - v_desc, 2);

  -- Impuestos según la configuración de la organización
  SELECT COALESCE(iva_pct, 12), COALESCE(iva_modalidad, 'incluido'), COALESCE(NULLIF(prefijo_ticket, ''), 'POS-')
    INTO v_ivapct, v_ivamod, v_pref FROM public."Organizations" WHERE id::text = c.org;
  v_ivapct := COALESCE(v_ivapct, 12); v_ivamod := COALESCE(v_ivamod, 'incluido'); v_pref := COALESCE(v_pref, 'POS-');
  IF v_ivamod = 'sobre' THEN
    v_iva := round(v_base * v_ivapct / 100, 2); v_total := round(v_base + v_iva, 2);
  ELSE
    v_total := v_base; v_iva := round(v_total - v_total / (1 + v_ivapct / 100), 2);
  END IF;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total a cobrar debe ser mayor a cero.' USING ERRCODE = '22023'; END IF;
  -- Control cruzado con lo que vio el cajero en pantalla
  IF p ? 'total' AND abs(COALESCE((p ->> 'total')::numeric, v_total) - v_total) > 0.01 THEN
    RAISE EXCEPTION 'El total cambió (pantalla Q %, servidor Q %). Recargue el POS y revise precios.', (p ->> 'total'), v_total USING ERRCODE = 'P0001';
  END IF;

  -- Pagos (efectivo, tarjeta, transferencia; pueden combinarse)
  IF jsonb_typeof(p -> 'pagos') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'pagos') = 0 THEN
    RAISE EXCEPTION 'Indique al menos un método de pago.' USING ERRCODE = '22023';
  END IF;
  FOR pg IN SELECT * FROM jsonb_array_elements(p -> 'pagos') LOOP
    v_metodo := pg ->> 'metodo';
    BEGIN v_monto := (pg ->> 'monto')::numeric; EXCEPTION WHEN others THEN v_monto := NULL; END;
    IF v_metodo NOT IN ('Efectivo', 'Tarjeta', 'Transferencia') THEN RAISE EXCEPTION 'Método de pago no soportado.' USING ERRCODE = '22023'; END IF;
    IF v_monto IS NULL OR v_monto <= 0 OR round(v_monto, 2) <> v_monto THEN RAISE EXCEPTION 'Monto de pago inválido.' USING ERRCODE = '22023'; END IF;
    v_pagos_n := v_pagos_n + 1;
    IF v_metodo = 'Efectivo' THEN v_cash_recv := v_cash_recv + v_monto;
    ELSE
      v_noncash := v_noncash + v_monto;
      IF length(btrim(COALESCE(pg ->> 'referencia', ''))) < 3 THEN
        RAISE EXCEPTION 'Ingrese la referencia (autorización o boleta) del pago con %.', lower(v_metodo) USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
  IF v_noncash > v_total THEN RAISE EXCEPTION 'Los pagos electrónicos (Q %) superan el total (Q %).', v_noncash, v_total USING ERRCODE = '22023'; END IF;
  v_cash_app := round(v_total - v_noncash, 2);
  IF v_cash_recv < v_cash_app THEN
    RAISE EXCEPTION 'Pago insuficiente: faltan Q % para completar el total.', round(v_cash_app - v_cash_recv, 2) USING ERRCODE = 'P0001';
  END IF;
  IF v_cash_app = 0 AND v_cash_recv > 0 THEN
    RAISE EXCEPTION 'El total ya está cubierto con pagos electrónicos; quite el efectivo.' USING ERRCODE = '22023';
  END IF;
  v_cambio := round(v_cash_recv - v_cash_app, 2);

  -- Número de ticket atómico (arranca después del mayor número histórico en Transacciones)
  v_anio := extract(year FROM now() AT TIME ZONE 'America/Guatemala')::int;
  INSERT INTO public.pos_secuencias(organization_id, anio, ultimo)
  VALUES (c.org, v_anio, COALESCE((
      SELECT max(substring(referencia FROM '(\d+)$')::int) FROM public."Transacciones"
       WHERE organization_id = c.org AND left(referencia, length(v_pref || v_anio || '-')) = v_pref || v_anio || '-'
         AND referencia ~ '-\d+$'), 0) + 1)
  ON CONFLICT (organization_id, anio) DO UPDATE SET ultimo = public.pos_secuencias.ultimo + 1
  RETURNING ultimo INTO v_seq;
  v_numero := v_pref || v_anio || '-' || lpad(v_seq::text, 5, '0');

  -- Cliente nuevo con NIT (antes se insertaba desde el navegador, fuera de transacción)
  IF v_cli_id IS NULL AND v_nit <> 'C/F' AND v_cli_nombre <> v_cf THEN
    SELECT id INTO v_cli_id FROM public."Clientes"
     WHERE organization_id = c.org AND upper(regexp_replace(COALESCE(nit, ''), '[-\s]', '', 'g')) = regexp_replace(v_nit, '[-\s]', '', 'g')
     LIMIT 1;
    IF v_cli_id IS NULL THEN
      v_cli_id := gen_random_uuid();
      INSERT INTO public."Clientes"(id, nombre, nit, direccion, lista_precio, organization_id, sucursal_id, "creadoPor", "fechaReg")
      VALUES (v_cli_id, v_cli_nombre, v_nit, COALESCE(v_dir, 'Ciudad'), 'Publico', c.org, v_sucursal, c.usuario, now());
    END IF;
  END IF;

  INSERT INTO public.pos_ventas(id, organization_id, sucursal_id, caja_turno_id, numero, idempotency_key, cliente_id, cliente_nombre, nit,
      direccion, lista_precio, subtotal, descuento_pct, descuento, iva_pct, iva_modalidad, iva_monto, total, monto_recibido, cambio,
      cajero, cajero_id, cotizacion_id)
  VALUES (v_venta, c.org, v_sucursal, v_turno, v_numero, v_key, v_cli_id, v_cli_nombre, v_nit, v_dir, v_lista, v_subtotal, v_pct, v_desc,
      v_ivapct, v_ivamod, v_iva, v_total, v_cash_recv + v_noncash, v_cambio, c.usuario, c.uid, NULLIF(p ->> 'cotizacionId', ''));

  INSERT INTO public.pos_venta_items(venta_id, orden, producto_id, descripcion, sku, tipo, cantidad, precio_unit, total)
  SELECT v_venta, (l ->> 'orden')::int, (l ->> 'producto_id')::uuid, l ->> 'descripcion', l ->> 'sku', l ->> 'tipo',
         (l ->> 'cantidad')::numeric, (l ->> 'precio')::numeric, (l ->> 'total')::numeric
    FROM jsonb_array_elements(v_lines) l;

  v_hoy := (now() AT TIME ZONE 'America/Guatemala')::date;
  -- Un pago efectivo agregado + uno por cada pago electrónico; cada uno genera su Ingreso contable
  IF v_cash_app > 0 THEN
    v_trx := gen_random_uuid();
    INSERT INTO public."Transacciones"(id, fecha, tipo, concepto, monto, "cuentaBancariaId", referencia, descripcion, "creadoPor", "fechaReg",
        organization_id, sucursal_id, caja_turno_id)
    VALUES (v_trx, v_hoy, 'Ingreso', 'Venta POS · Ticket ' || v_numero, v_cash_app, NULL, v_numero,
        'Ticket ' || v_numero || ' · ' || v_cli_nombre || ' · Pago: Efectivo' || CASE WHEN v_nit <> 'C/F' THEN ' · NIT: ' || v_nit ELSE '' END,
        c.usuario, now(), c.org, v_sucursal, v_turno);
    INSERT INTO public.pos_venta_pagos(venta_id, metodo, monto, recibido, transaccion_id) VALUES (v_venta, 'Efectivo', v_cash_app, v_cash_recv, v_trx);
  END IF;
  FOR pg IN SELECT * FROM jsonb_array_elements(p -> 'pagos') WHERE value ->> 'metodo' <> 'Efectivo' LOOP
    v_metodo := pg ->> 'metodo'; v_monto := (pg ->> 'monto')::numeric; v_ref := btrim(pg ->> 'referencia'); v_cta := NULL;
    IF COALESCE(pg ->> 'cuentaBancariaId', '') <> '' THEN
      BEGIN v_cta := (pg ->> 'cuentaBancariaId')::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Cuenta bancaria inválida.' USING ERRCODE = '22023'; END;
      PERFORM 1 FROM public."CuentasBancarias" WHERE id = v_cta AND organization_id = c.org AND COALESCE(activa, true);
      IF NOT FOUND THEN RAISE EXCEPTION 'La cuenta bancaria seleccionada no existe o está inactiva.' USING ERRCODE = 'P0001'; END IF;
    END IF;
    v_trx := gen_random_uuid();
    INSERT INTO public."Transacciones"(id, fecha, tipo, concepto, monto, "cuentaBancariaId", referencia, descripcion, "creadoPor", "fechaReg",
        organization_id, sucursal_id, caja_turno_id)
    VALUES (v_trx, v_hoy, 'Ingreso', 'Venta POS · Ticket ' || v_numero, v_monto, v_cta, v_numero,
        'Ticket ' || v_numero || ' · ' || v_cli_nombre || ' · Pago: ' || v_metodo || ' (ref. ' || v_ref || ')' || CASE WHEN v_nit <> 'C/F' THEN ' · NIT: ' || v_nit ELSE '' END,
        c.usuario, now(), c.org, v_sucursal, v_turno);
    IF v_cta IS NOT NULL THEN
      UPDATE public."CuentasBancarias" SET saldo = COALESCE(saldo, 0) + v_monto WHERE id = v_cta AND organization_id = c.org;
    END IF;
    INSERT INTO public.pos_venta_pagos(venta_id, metodo, monto, recibido, referencia, cuenta_bancaria_id, transaccion_id)
    VALUES (v_venta, v_metodo, v_monto, v_monto, v_ref, v_cta, v_trx);
  END LOOP;

  IF v_cli_id IS NOT NULL THEN
    UPDATE public."Clientes" SET "ultimaCompra" = now(), "ultimaActividad" = now() WHERE id = v_cli_id AND organization_id = c.org;
  END IF;
  PERFORM public.pos_audit(c.org, 'venta.registrar', 'pos_ventas', v_venta::text, c.usuario,
    jsonb_build_object('numero', v_numero, 'total', v_total, 'descuentoPct', v_pct, 'pagos', p -> 'pagos'));
  RETURN jsonb_build_object('ok', true, 'duplicado', false, 'ticket', public.pos_ticket_json(v_venta));
END $$;

CREATE OR REPLACE FUNCTION public.pos_devolver_venta(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c record; v record; it jsonb; li record; v_key text; v_exist uuid; v_anular boolean; v_motivo text;
  v_metodo text; v_cta uuid; v_ref text; v_reingreso boolean; v_cant numeric; v_ret_sub numeric := 0;
  v_monto numeric; v_restante numeric; v_turno text; v_dev uuid := gen_random_uuid(); v_trx uuid;
  v_tipo text; v_estado text; v_todo boolean; v_factor numeric; v_ids uuid[]; v_sel jsonb := '[]'::jsonb; v_hoy date;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  v_anular := COALESCE((p ->> 'anular')::boolean, false);
  IF NOT public.pos_puede(c.privilegiado, c.perms, CASE WHEN v_anular THEN 'anular' ELSE 'devolver' END) THEN
    RAISE EXCEPTION 'No tiene permiso para % ventas.', CASE WHEN v_anular THEN 'anular' ELSE 'registrar devoluciones de' END USING ERRCODE = '42501';
  END IF;
  v_motivo := btrim(COALESCE(p ->> 'motivo', ''));
  IF length(v_motivo) < 5 THEN RAISE EXCEPTION 'Indique el motivo (mínimo 5 caracteres).' USING ERRCODE = '22023'; END IF;
  v_key := NULLIF(btrim(COALESCE(p ->> 'idempotency_key', '')), '');
  IF v_key IS NULL OR length(v_key) < 8 THEN RAISE EXCEPTION 'Falta la clave de idempotencia.' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('pos_dev:' || c.org || ':' || v_key));
  SELECT id INTO v_exist FROM public.pos_devoluciones WHERE organization_id = c.org AND idempotency_key = v_key;
  IF v_exist IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicado', true, 'devolucionId', v_exist,
      'ticket', public.pos_ticket_json((SELECT venta_id FROM public.pos_devoluciones WHERE id = v_exist)));
  END IF;

  SELECT * INTO v FROM public.pos_ventas WHERE id = (p ->> 'ventaId')::uuid AND organization_id = c.org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada.' USING ERRCODE = 'P0001'; END IF;
  IF v.estado IN ('Anulada', 'Devuelta') THEN RAISE EXCEPTION 'La venta % ya fue %.', v.numero, lower(v.estado) USING ERRCODE = 'P0001'; END IF;
  IF v_anular AND v.estado <> 'Completada' THEN
    RAISE EXCEPTION 'La venta ya tiene devoluciones parciales; registre una devolución del saldo restante.' USING ERRCODE = 'P0001';
  END IF;

  -- Líneas a devolver (anulación = todo lo pendiente)
  IF v_anular THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('itemId', i.id, 'cantidad', i.cantidad - i.cantidad_devuelta)), '[]'::jsonb) INTO v_sel
      FROM public.pos_venta_items i WHERE i.venta_id = v.id AND i.cantidad - i.cantidad_devuelta > 0;
  ELSE
    IF jsonb_typeof(p -> 'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'items') = 0 THEN
      RAISE EXCEPTION 'Seleccione al menos un artículo a devolver.' USING ERRCODE = '22023';
    END IF;
    v_sel := p -> 'items';
  END IF;

  SELECT array_agg(DISTINCT (x ->> 'itemId')::uuid ORDER BY (x ->> 'itemId')::uuid) INTO v_ids FROM jsonb_array_elements(v_sel) x;
  PERFORM 1 FROM public.pos_venta_items WHERE venta_id = v.id AND id = ANY (v_ids) ORDER BY id FOR UPDATE;
  IF v.total <= 0 THEN RAISE EXCEPTION 'Venta inválida.' USING ERRCODE = 'P0001'; END IF;
  v_factor := v.total / NULLIF(v.subtotal, 0);   -- total efectivamente cobrado por cada Q de línea (descuento e IVA incluidos)

  FOR it IN SELECT * FROM jsonb_array_elements(v_sel) LOOP
    SELECT * INTO li FROM public.pos_venta_items WHERE id = (it ->> 'itemId')::uuid AND venta_id = v.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Artículo no pertenece a la venta.' USING ERRCODE = 'P0001'; END IF;
    BEGIN v_cant := (it ->> 'cantidad')::numeric; EXCEPTION WHEN others THEN v_cant := NULL; END;
    IF v_cant IS NULL OR v_cant <= 0 OR round(v_cant, 3) <> v_cant THEN RAISE EXCEPTION 'Cantidad a devolver inválida.' USING ERRCODE = '22023'; END IF;
    IF v_cant > li.cantidad - li.cantidad_devuelta THEN
      RAISE EXCEPTION 'No puede devolver % de "%": solo quedan % por devolver.', v_cant, li.descripcion, li.cantidad - li.cantidad_devuelta USING ERRCODE = 'P0001';
    END IF;
    v_ret_sub := v_ret_sub + li.precio_unit * v_cant;
  END LOOP;

  UPDATE public.pos_venta_items i SET cantidad_devuelta = i.cantidad_devuelta + s.cant
    FROM (SELECT (x ->> 'itemId')::uuid AS id, sum((x ->> 'cantidad')::numeric) AS cant FROM jsonb_array_elements(v_sel) x GROUP BY 1) s
   WHERE i.id = s.id AND i.venta_id = v.id;

  SELECT NOT EXISTS (SELECT 1 FROM public.pos_venta_items WHERE venta_id = v.id AND cantidad_devuelta < cantidad) INTO v_todo;
  v_restante := round(v.total - v.reembolsado, 2);
  v_monto := CASE WHEN v_todo THEN v_restante ELSE round(v_ret_sub * v_factor, 2) END;
  IF v_monto <= 0 THEN RAISE EXCEPTION 'El monto a reembolsar es cero; revise la selección.' USING ERRCODE = 'P0001'; END IF;
  IF v_monto > v_restante THEN v_monto := v_restante; END IF;
  v_tipo := CASE WHEN v_anular THEN 'Anulación' WHEN v_todo THEN 'Total' ELSE 'Parcial' END;
  v_estado := CASE WHEN v_anular THEN 'Anulada' WHEN v_todo THEN 'Devuelta' ELSE 'Devuelta parcial' END;

  -- Método de reembolso
  v_metodo := COALESCE(NULLIF(p ->> 'metodoReembolso', ''), 'Efectivo');
  IF v_metodo NOT IN ('Efectivo', 'Tarjeta', 'Transferencia') THEN RAISE EXCEPTION 'Método de reembolso no soportado.' USING ERRCODE = '22023'; END IF;
  v_ref := NULLIF(btrim(COALESCE(p ->> 'referencia', '')), '');
  IF v_metodo <> 'Efectivo' AND v_ref IS NULL THEN RAISE EXCEPTION 'Ingrese la referencia del reembolso electrónico.' USING ERRCODE = '22023'; END IF;
  v_cta := NULL;
  IF v_metodo = 'Transferencia' AND COALESCE(p ->> 'cuentaBancariaId', '') <> '' THEN
    v_cta := (p ->> 'cuentaBancariaId')::uuid;
    PERFORM 1 FROM public."CuentasBancarias" WHERE id = v_cta AND organization_id = c.org AND COALESCE(activa, true) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta bancaria inválida.' USING ERRCODE = 'P0001'; END IF;
  END IF;
  -- El efectivo sale de la caja ABIERTA actual (no de un turno ya cerrado)
  SELECT id INTO v_turno FROM public."Cajas_Turnos"
   WHERE organization_id = c.org AND estado = 'ABIERTA' AND sucursal_id IS NOT DISTINCT FROM c.sucursal
   ORDER BY fecha_apertura DESC LIMIT 1 FOR SHARE;
  IF v_metodo = 'Efectivo' AND v_turno IS NULL THEN
    RAISE EXCEPTION 'Para reembolsar en efectivo debe haber una caja abierta.' USING ERRCODE = 'P0001';
  END IF;
  IF v_metodo = 'Efectivo' AND v_monto > (public.pos_resumen_turno_int(c.org, v_turno) ->> 'esperado')::numeric THEN
    RAISE EXCEPTION 'No hay efectivo suficiente en caja para reembolsar Q %.', v_monto USING ERRCODE = 'P0001';
  END IF;

  v_reingreso := COALESCE((p ->> 'reingresarStock')::boolean, true);
  IF v_reingreso THEN
    PERFORM 1 FROM public."Inventario" WHERE organization_id = c.org AND id IN
      (SELECT i.producto_id FROM public.pos_venta_items i WHERE i.id = ANY (v_ids)) ORDER BY id FOR UPDATE;
    UPDATE public."Inventario" inv SET unidades = inv.unidades + s.cant
      FROM (SELECT i.producto_id, sum((x ->> 'cantidad')::numeric) AS cant
              FROM jsonb_array_elements(v_sel) x JOIN public.pos_venta_items i ON i.id = (x ->> 'itemId')::uuid
             WHERE i.tipo <> 'Servicio' AND i.producto_id IS NOT NULL GROUP BY 1) s
     WHERE inv.id = s.producto_id AND inv.organization_id = c.org;
  END IF;

  v_hoy := (now() AT TIME ZONE 'America/Guatemala')::date;
  v_trx := gen_random_uuid();
  INSERT INTO public."Transacciones"(id, fecha, tipo, concepto, monto, "cuentaBancariaId", referencia, descripcion, "creadoPor", "fechaReg",
      organization_id, sucursal_id, caja_turno_id)
  VALUES (v_trx, v_hoy, 'Egreso', CASE WHEN v_anular THEN 'Anulación POS · Ticket ' ELSE 'Devolución POS · Ticket ' END || v.numero, v_monto, v_cta,
      v.numero, v_tipo || ' de ticket ' || v.numero || ' · ' || v.cliente_nombre || ' · Reembolso: ' || v_metodo || ' · Motivo: ' || v_motivo,
      c.usuario, now(), c.org, c.sucursal, v_turno);
  IF v_cta IS NOT NULL THEN
    UPDATE public."CuentasBancarias" SET saldo = COALESCE(saldo, 0) - v_monto WHERE id = v_cta AND organization_id = c.org;
  END IF;

  INSERT INTO public.pos_devoluciones(id, organization_id, venta_id, caja_turno_id, tipo, monto, metodo_reembolso, cuenta_bancaria_id, referencia,
      motivo, reingreso_stock, usuario, usuario_id, idempotency_key, transaccion_id)
  VALUES (v_dev, c.org, v.id, v_turno, v_tipo, v_monto, v_metodo, v_cta, v_ref, v_motivo, v_reingreso, c.usuario, c.uid, v_key, v_trx);
  INSERT INTO public.pos_devolucion_items(devolucion_id, venta_item_id, cantidad)
  SELECT v_dev, (x ->> 'itemId')::uuid, sum((x ->> 'cantidad')::numeric) FROM jsonb_array_elements(v_sel) x GROUP BY 1, 2;

  UPDATE public.pos_ventas SET estado = v_estado, reembolsado = reembolsado + v_monto,
         anulada_en = CASE WHEN v_anular THEN now() ELSE anulada_en END,
         anulada_por = CASE WHEN v_anular THEN c.usuario ELSE anulada_por END,
         motivo_anulacion = CASE WHEN v_anular THEN v_motivo ELSE motivo_anulacion END
   WHERE id = v.id;
  PERFORM public.pos_audit(c.org, CASE WHEN v_anular THEN 'venta.anular' ELSE 'venta.devolver' END, 'pos_ventas', v.id::text, c.usuario,
    jsonb_build_object('numero', v.numero, 'monto', v_monto, 'motivo', v_motivo, 'metodo', v_metodo, 'reingresoStock', v_reingreso));
  RETURN jsonb_build_object('ok', true, 'duplicado', false, 'devolucionId', v_dev, 'monto', v_monto, 'estado', v_estado,
                            'ticket', public.pos_ticket_json(v.id));
END $$;

CREATE OR REPLACE FUNCTION public.pos_mis_permisos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; k text; r jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  FOREACH k IN ARRAY ARRAY['descuento', 'editar_precio', 'anular', 'devolver', 'caja_mov', 'reimprimir'] LOOP
    r := r || jsonb_build_object(k, public.pos_puede(c.privilegiado, c.perms, k));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'permisos', r, 'privilegiado', c.privilegiado, 'usuario', c.usuario,
    'descuentoMax', CASE WHEN c.privilegiado THEN 100 ELSE COALESCE((c.perms ->> 'pos_descuento_max')::numeric, 10) END);
END $$;

DROP TRIGGER IF EXISTS trg_org_pos_config ON public."Organizations";
DROP FUNCTION IF EXISTS public.trg_fn_org_pos_config();
DROP FUNCTION IF EXISTS public.pos_cfg(text);
DROP FUNCTION IF EXISTS public.pos_cfg_defaults();
ALTER TABLE public."Organizations" DROP COLUMN IF EXISTS pos_config, DROP COLUMN IF EXISTS redes_sociales;
ALTER TABLE public.pos_devoluciones DROP COLUMN IF EXISTS motivo_tipo;
ALTER TABLE public.pos_ventas DROP COLUMN IF EXISTS propina, DROP COLUMN IF EXISTS redondeo;
