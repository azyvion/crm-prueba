-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Lote 2 · FN-19 Descuento de inventario en POS
-- Antes: por cada producto se leía `unidades` y luego se escribía `unidades - n`
-- (dos ventas simultáneas perdían un descuento), se truncaba a 0 sin avisar
-- (sobreventa silenciosa) y los errores se ignoraban.
-- Ahora: un solo UPDATE condicional por producto dentro de una transacción; si
-- alguno no tiene existencia suficiente, no se descuenta nada.
-- SECURITY INVOKER → aplica RLS (solo inventario de la propia organización).
-- p_devolver = true repone las cantidades (compensación si la venta no se registra).
-- Reversión: DROP FUNCTION IF EXISTS public.pos_mover_stock(jsonb, boolean);
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.pos_mover_stock(p_items jsonb, p_devolver boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  r record;
  n integer := 0;
  v_nombre text;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Formato de ítems inválido.' USING ERRCODE = '22023';
  END IF;
  -- Agrupar por producto (el mismo producto puede venir en varias líneas)
  FOR r IN
    SELECT (x->>'id')::uuid AS id, sum((x->>'cantidad')::numeric) AS cant
    FROM jsonb_array_elements(p_items) x
    WHERE COALESCE(x->>'id', '') <> '' AND COALESCE(x->>'tipo', '') <> 'Servicio'
    GROUP BY 1 ORDER BY 1           -- orden fijo: evita interbloqueos
  LOOP
    IF r.cant IS NULL OR r.cant <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida.' USING ERRCODE = '22023';
    END IF;
    IF p_devolver THEN
      UPDATE public."Inventario" SET unidades = unidades + r.cant
       WHERE id = r.id AND COALESCE(tipo, '') <> 'Servicio';
    ELSE
      UPDATE public."Inventario" SET unidades = unidades - r.cant
       WHERE id = r.id AND COALESCE(tipo, '') <> 'Servicio' AND unidades >= r.cant;
      IF NOT FOUND THEN
        SELECT producto INTO v_nombre FROM public."Inventario" WHERE id = r.id;
        RAISE EXCEPTION 'Existencia insuficiente para "%".', COALESCE(v_nombre, r.id::text)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.pos_mover_stock(jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_mover_stock(jsonb, boolean) TO authenticated;
