-- Reversión de 20261023_08_negocio.sql: restaura las funciones de la 07 y quita tablas/columnas/funciones del Lote 6.
-- ADVERTENCIA: elimina compras, proveedores, conteos y kardex; exporte antes si ya hay datos.

CREATE OR REPLACE FUNCTION public.pos_cfg_defaults() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'descuento_max_default', 10,
    'vender_sin_stock', 'no',                 -- no | permiso | si
    'caja_obligatoria', 'auto',               -- auto (según plan) | si | no
    'redondeo_efectivo', 0,                   -- 0, 0.05, 0.10, 0.25, 0.50, 1
    'tolerancia_cuadre', 0,
    'cuadre_max_sin_supervisor', 0,           -- 0 = sin límite
    'efectivo_max_caja', 0,                   -- 0 = sin aviso
    'turno_horas_max', 0,                     -- 0 = sin límite
    'turno_bloquear', false,
    'ancho_papel', '80',                      -- 58 | 80
    'ticket_encabezado', '',
    'mostrar_sku', true, 'mostrar_cajero', true, 'mostrar_turno', true, 'mostrar_iva', true,
    'mostrar_redes', true, 'mostrar_qr', false,
    'ticket_autoimprimir', false, 'ticket_copias', 1,
    'plazo_devolucion_dias', 0,               -- 0 = sin plazo
    'motivos_devolucion', jsonb_build_array('Producto defectuoso', 'Error de precio o cobro', 'El cliente se arrepintió', 'Cambio de producto', 'Otro'),
    'motivos_sin_reingreso', jsonb_build_array('Producto defectuoso'),
    'nit_obligatorio_desde', 0,               -- 0 = nunca
    'propina_habilitada', false, 'propina_sugeridas', jsonb_build_array(10, 15),
    'metodos_habilitados', jsonb_build_array('Efectivo', 'Tarjeta', 'Transferencia'),
    'etiquetas_metodos', '{}'::jsonb,
    'stock_bajo_umbral', 5
  );
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_org_pos_config() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  d jsonb := public.pos_cfg_defaults(); c jsonb := COALESCE(NEW.pos_config, '{}'::jsonb); o jsonb := '{}'::jsonb;
  k text; v jsonb; e jsonb; n numeric; r jsonb := '{}'::jsonb; rk text; rv jsonb; m text;
BEGIN
  IF jsonb_typeof(c) <> 'object' THEN RAISE EXCEPTION 'Configuración POS inválida: debe ser un objeto.' USING ERRCODE = '22023'; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(c) LOOP
    CONTINUE WHEN NOT d ? k;                                   -- clave desconocida: se descarta
    IF jsonb_typeof(v) <> jsonb_typeof(d -> k) THEN
      RAISE EXCEPTION 'Configuración POS inválida: "%" debe ser de tipo %.', k, jsonb_typeof(d -> k) USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v) = 'number' THEN
      n := (v #>> '{}')::numeric;
      IF (k = 'descuento_max_default' AND (n < 0 OR n > 100))
         OR (k = 'redondeo_efectivo' AND n NOT IN (0, 0.05, 0.1, 0.25, 0.5, 1))
         OR (k IN ('tolerancia_cuadre', 'cuadre_max_sin_supervisor', 'efectivo_max_caja', 'nit_obligatorio_desde') AND (n < 0 OR n > 100000000))
         OR (k = 'ticket_copias' AND (n < 1 OR n > 3 OR n <> trunc(n)))
         OR (k = 'plazo_devolucion_dias' AND (n < 0 OR n > 3650 OR n <> trunc(n)))
         OR (k = 'stock_bajo_umbral' AND (n < 0 OR n > 100000))
         OR (k = 'turno_horas_max' AND (n < 0 OR n > 168))
      THEN RAISE EXCEPTION 'Configuración POS inválida: valor fuera de rango en "%".', k USING ERRCODE = '22023'; END IF;
    ELSIF jsonb_typeof(v) = 'string' THEN
      m := v #>> '{}';
      IF (k = 'vender_sin_stock' AND m NOT IN ('no', 'permiso', 'si'))
         OR (k = 'caja_obligatoria' AND m NOT IN ('auto', 'si', 'no'))
         OR (k = 'ancho_papel' AND m NOT IN ('58', '80'))
         OR (k = 'ticket_encabezado' AND length(m) > 300)
      THEN RAISE EXCEPTION 'Configuración POS inválida en "%".', k USING ERRCODE = '22023'; END IF;
    ELSIF jsonb_typeof(v) = 'array' THEN
      IF jsonb_array_length(v) > 12 THEN RAISE EXCEPTION 'Configuración POS inválida: demasiados elementos en "%".', k USING ERRCODE = '22023'; END IF;
      FOR e IN SELECT * FROM jsonb_array_elements(v) LOOP
        IF k = 'metodos_habilitados' THEN
          IF jsonb_typeof(e) <> 'string' OR (e #>> '{}') NOT IN ('Efectivo', 'Tarjeta', 'Transferencia') THEN
            RAISE EXCEPTION 'Configuración POS inválida: método de pago desconocido.' USING ERRCODE = '22023'; END IF;
        ELSIF k = 'propina_sugeridas' THEN
          IF jsonb_typeof(e) <> 'number' OR (e #>> '{}')::numeric < 0 OR (e #>> '{}')::numeric > 100 THEN
            RAISE EXCEPTION 'Configuración POS inválida: propina sugerida fuera de rango.' USING ERRCODE = '22023'; END IF;
        ELSE
          IF jsonb_typeof(e) <> 'string' OR length(btrim(e #>> '{}')) = 0 OR length(e #>> '{}') > 60 THEN
            RAISE EXCEPTION 'Configuración POS inválida: textos de lista de 1 a 60 caracteres en "%".', k USING ERRCODE = '22023'; END IF;
        END IF;
      END LOOP;
      IF k = 'metodos_habilitados' AND jsonb_array_length(v) = 0 THEN
        RAISE EXCEPTION 'Debe haber al menos un método de pago habilitado.' USING ERRCODE = '22023'; END IF;
    ELSIF jsonb_typeof(v) = 'object' AND k = 'etiquetas_metodos' THEN
      FOR rk, rv IN SELECT * FROM jsonb_each(v) LOOP
        IF rk NOT IN ('Efectivo', 'Tarjeta', 'Transferencia') OR jsonb_typeof(rv) <> 'string' OR length(rv #>> '{}') > 30 THEN
          RAISE EXCEPTION 'Configuración POS inválida en "etiquetas_metodos".' USING ERRCODE = '22023'; END IF;
      END LOOP;
    END IF;
    o := o || jsonb_build_object(k, v);
  END LOOP;
  NEW.pos_config := o;

  -- Redes sociales: solo claves conocidas, texto corto
  IF jsonb_typeof(COALESCE(NEW.redes_sociales, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Redes sociales inválidas: debe ser un objeto.' USING ERRCODE = '22023'; END IF;
  FOR rk, rv IN SELECT * FROM jsonb_each(COALESCE(NEW.redes_sociales, '{}'::jsonb)) LOOP
    CONTINUE WHEN rk NOT IN ('facebook', 'instagram', 'tiktok', 'whatsapp', 'x', 'youtube');
    IF jsonb_typeof(rv) <> 'string' OR length(rv #>> '{}') > 120 THEN
      RAISE EXCEPTION 'Red social inválida: "%".', rk USING ERRCODE = '22023'; END IF;
    IF length(btrim(rv #>> '{}')) > 0 THEN r := r || jsonb_build_object(rk, btrim(rv #>> '{}')); END IF;
  END LOOP;
  NEW.redes_sociales := r;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.pos_mis_permisos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; k text; r jsonb := '{}'::jsonb; cfg jsonb;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  cfg := public.pos_cfg(c.org);
  FOREACH k IN ARRAY ARRAY['descuento', 'editar_precio', 'anular', 'devolver', 'caja_mov', 'reimprimir', 'sin_stock'] LOOP
    r := r || jsonb_build_object(k, public.pos_puede(c.privilegiado, c.perms, k));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'permisos', r, 'privilegiado', c.privilegiado, 'usuario', c.usuario, 'config', cfg,
    'puedeVenderSinStock', (cfg ->> 'vender_sin_stock') = 'si' OR ((cfg ->> 'vender_sin_stock') = 'permiso' AND (r ->> 'sin_stock')::boolean),
    'descuentoMax', CASE WHEN c.privilegiado THEN 100 ELSE COALESCE((c.perms ->> 'pos_descuento_max')::numeric, (cfg ->> 'descuento_max_default')::numeric) END);
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
  cfg jsonb; v_propina numeric := 0; v_due numeric; v_redondeo numeric := 0; v_cash_raw numeric; v_step numeric;
  v_sin_stock boolean := false; v_req_caja boolean; v_turno_ts timestamptz; v_dmax numeric;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Solicitud inválida.' USING ERRCODE = '22023'; END IF;
  cfg := public.pos_cfg(c.org);
  v_sin_stock := (cfg ->> 'vender_sin_stock') = 'si' OR ((cfg ->> 'vender_sin_stock') = 'permiso' AND public.pos_puede(c.privilegiado, c.perms, 'sin_stock'));
  v_dmax := COALESCE((c.perms ->> 'pos_descuento_max')::numeric, (cfg ->> 'descuento_max_default')::numeric);

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
  SELECT id, fecha_apertura INTO v_turno, v_turno_ts FROM public."Cajas_Turnos"
   WHERE organization_id = c.org AND estado = 'ABIERTA' AND sucursal_id IS NOT DISTINCT FROM v_sucursal
   ORDER BY fecha_apertura DESC LIMIT 1 FOR SHARE;   -- serializa con el cierre de caja
  v_req_caja := CASE cfg ->> 'caja_obligatoria' WHEN 'si' THEN true WHEN 'no' THEN false
                  ELSE NOT COALESCE((p ->> 'permitir_sin_caja')::boolean, false) END;
  IF v_turno IS NULL AND v_req_caja THEN
    RAISE EXCEPTION 'No hay una caja abierta. Abra la caja antes de cobrar.' USING ERRCODE = 'P0001';
  END IF;
  IF v_turno IS NOT NULL AND COALESCE((cfg ->> 'turno_bloquear')::boolean, false) AND (cfg ->> 'turno_horas_max')::numeric > 0
     AND now() - v_turno_ts > ((cfg ->> 'turno_horas_max')::numeric * interval '1 hour') THEN
    RAISE EXCEPTION 'El turno lleva más de % horas abierto. Ciérrelo y abra uno nuevo para seguir cobrando.', (cfg ->> 'turno_horas_max') USING ERRCODE = 'P0001';
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
      IF v_sin_stock THEN
        UPDATE public."Inventario" SET unidades = unidades - v_cant WHERE id = inv.id;   -- la empresa permite vender sin existencias
      ELSE
        UPDATE public."Inventario" SET unidades = unidades - v_cant WHERE id = inv.id AND unidades >= v_cant;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Existencia insuficiente para "%" (disponible: %).', inv.producto, inv.unidades USING ERRCODE = 'P0001';
        END IF;
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
    IF NOT c.privilegiado AND v_pct > v_dmax THEN
      RAISE EXCEPTION 'Su descuento máximo autorizado es de % por ciento.', v_dmax USING ERRCODE = '42501';
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
  IF (cfg ->> 'nit_obligatorio_desde')::numeric > 0 AND v_total >= (cfg ->> 'nit_obligatorio_desde')::numeric AND v_nit = 'C/F' THEN
    RAISE EXCEPTION 'Para ventas desde Q % se requiere el NIT del cliente (no Consumidor Final).', (cfg ->> 'nit_obligatorio_desde') USING ERRCODE = 'P0001';
  END IF;
  BEGIN v_propina := round(COALESCE(NULLIF(p ->> 'propina', '')::numeric, 0), 2); EXCEPTION WHEN others THEN v_propina := NULL; END;
  IF v_propina IS NULL OR v_propina < 0 OR v_propina > v_total THEN RAISE EXCEPTION 'Propina inválida.' USING ERRCODE = '22023'; END IF;
  IF v_propina > 0 AND NOT COALESCE((cfg ->> 'propina_habilitada')::boolean, false) THEN
    RAISE EXCEPTION 'La propina no está habilitada para esta empresa.' USING ERRCODE = '22023'; END IF;
  v_due := round(v_total + v_propina, 2);
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
    IF NOT (cfg -> 'metodos_habilitados') ? v_metodo THEN RAISE EXCEPTION 'El método de pago % no está habilitado.', v_metodo USING ERRCODE = '22023'; END IF;
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
  IF v_noncash > v_due THEN RAISE EXCEPTION 'Los pagos electrónicos (Q %) superan el total (Q %).', v_noncash, v_due USING ERRCODE = '22023'; END IF;
  v_cash_raw := round(v_due - v_noncash, 2);
  v_cash_app := v_cash_raw;
  v_step := (cfg ->> 'redondeo_efectivo')::numeric;
  IF v_step > 0 AND v_cash_raw >= v_step THEN        -- redondeo al múltiplo más cercano (solo sobre el efectivo)
    v_cash_app := round(round(v_cash_raw / v_step, 0) * v_step, 2);
    v_redondeo := round(v_cash_app - v_cash_raw, 2);
  END IF;
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
      cajero, cajero_id, cotizacion_id, propina, redondeo)
  VALUES (v_venta, c.org, v_sucursal, v_turno, v_numero, v_key, v_cli_id, v_cli_nombre, v_nit, v_dir, v_lista, v_subtotal, v_pct, v_desc,
      v_ivapct, v_ivamod, v_iva, v_total, v_cash_recv + v_noncash, v_cambio, c.usuario, c.uid, NULLIF(p ->> 'cotizacionId', ''), v_propina, v_redondeo);

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
  v_tipo text; v_estado text; v_todo boolean; v_factor numeric; v_ids uuid[]; v_sel jsonb := '[]'::jsonb; v_hoy date; cfg jsonb; v_mtipo text;
BEGIN
  SELECT * INTO c FROM public.pos_ctx();
  IF NOT FOUND OR c.org IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  v_anular := COALESCE((p ->> 'anular')::boolean, false);
  IF NOT public.pos_puede(c.privilegiado, c.perms, CASE WHEN v_anular THEN 'anular' ELSE 'devolver' END) THEN
    RAISE EXCEPTION 'No tiene permiso para % ventas.', CASE WHEN v_anular THEN 'anular' ELSE 'registrar devoluciones de' END USING ERRCODE = '42501';
  END IF;
  cfg := public.pos_cfg(c.org);
  v_motivo := btrim(COALESCE(p ->> 'motivo', ''));
  v_mtipo := NULLIF(btrim(COALESCE(p ->> 'motivoTipo', '')), '');
  IF jsonb_array_length(cfg -> 'motivos_devolucion') > 0 THEN
    IF v_mtipo IS NULL OR NOT (cfg -> 'motivos_devolucion') ? v_mtipo THEN
      RAISE EXCEPTION 'Seleccione el motivo de la lista.' USING ERRCODE = '22023';
    END IF;
  END IF;
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
  IF (cfg ->> 'plazo_devolucion_dias')::numeric > 0 AND NOT c.privilegiado
     AND now() - v.created_at > ((cfg ->> 'plazo_devolucion_dias')::numeric * interval '1 day') THEN
    RAISE EXCEPTION 'Pasó el plazo de % días para devoluciones de la venta %. Solo un administrador puede autorizarla.', (cfg ->> 'plazo_devolucion_dias'), v.numero USING ERRCODE = '42501';
  END IF;
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
  IF NOT (cfg -> 'metodos_habilitados') ? v_metodo THEN RAISE EXCEPTION 'El método % no está habilitado.', v_metodo USING ERRCODE = '22023'; END IF;
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
      motivo, motivo_tipo, reingreso_stock, usuario, usuario_id, idempotency_key, transaccion_id)
  VALUES (v_dev, c.org, v.id, v_turno, v_tipo, v_monto, v_metodo, v_cta, v_ref, v_motivo, v_mtipo, v_reingreso, c.usuario, c.uid, v_key, v_trx);
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

DROP TRIGGER IF EXISTS trg_inv_kardex ON public."Inventario";
DROP FUNCTION IF EXISTS public.trg_fn_inv_kardex();
DROP FUNCTION IF EXISTS public.inv_ctx_mov(text, text, text);
DROP FUNCTION IF EXISTS public.pos_historial_cliente(uuid, integer), public.pos_kpis_int(text, date, date, text), public.pos_reporte_ventas(date, date, text), public.pos_reporte_cierres(date, date, text), public.pos_reporte_comisiones(date, date), public.pos_listar_auditoria(date, date, text, integer), public.seguimiento_clientes(integer, integer), public.proveedor_guardar(jsonb), public.compra_registrar(jsonb), public.compra_pagar(uuid, uuid, text), public.compra_anular(uuid, text), public.inv_ajustar(uuid, numeric, text), public.inv_conteo_crear(text, text), public.inv_conteo_guardar(uuid, jsonb), public.inv_conteo_aplicar(uuid, text), public.inv_reposicion();
DROP TABLE IF EXISTS public.inv_conteo_items, public.inv_conteos, public.inv_movimientos, public.compra_items, public.compras, public.proveedores CASCADE;
DROP INDEX IF EXISTS public.ux_inventario_codbarras;
ALTER TABLE public."Inventario" DROP COLUMN IF EXISTS stock_minimo, DROP COLUMN IF EXISTS costo_unit, DROP COLUMN IF EXISTS codigo_barras;
ALTER TABLE public."Clientes" DROP COLUMN IF EXISTS fecha_nacimiento;
ALTER TABLE public.pos_venta_items DROP COLUMN IF EXISTS costo_unit;
