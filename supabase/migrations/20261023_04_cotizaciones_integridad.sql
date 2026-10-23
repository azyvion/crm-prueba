-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Lote 2 · Integridad de cotizaciones
--  FN-17  Editar una cotización borraba todos sus ítems y luego los reinsertaba
--         en otra petición: si la reinserción fallaba, los ítems se perdían y la
--         UI mostraba éxito. Nuevo RPC atómico (SECURITY INVOKER → aplica RLS).
--  FN-18  Numeración max+1 calculada en el navegador: dos usuarios a la vez
--         podían generar el mismo número. Índice único por organización.
-- Reversión:
--   DROP FUNCTION IF EXISTS public.replace_cotizacion_items(uuid, jsonb);
--   DROP INDEX IF EXISTS public.cotizaciones_org_numero_uq;
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.replace_cotizacion_items(p_cotizacion_id uuid, p_items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_org text;
  n integer;
BEGIN
  SELECT organization_id INTO v_org FROM public."Cotizaciones" WHERE id = p_cotizacion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización no encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un ítem.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public."CotizacionItems" WHERE "cotizacionId" = p_cotizacion_id;

  -- El total de línea se recalcula aquí (no se confía en el cliente).
  INSERT INTO public."CotizacionItems"
    (id, "cotizacionId", "itemId", tipo, descripcion, detalle, "unidadMedida",
     cantidad, "precioUnit", "descuentoPct", total, organization_id)
  SELECT gen_random_uuid(), p_cotizacion_id, NULLIF(x->>'itemId', '')::uuid,
         CASE WHEN x->>'tipo' = 'Servicio' THEN 'Servicio' ELSE 'Producto' END,
         COALESCE(x->>'descripcion', ''), COALESCE(x->>'detalle', ''),
         COALESCE(NULLIF(x->>'unidadMedida', ''), 'UND'),
         q.cant, q.precio, q.dpct,
         round(q.cant * q.precio * (1 - q.dpct / 100), 2),
         v_org
  FROM jsonb_array_elements(p_items) AS x
  CROSS JOIN LATERAL (SELECT (x->>'cantidad')::numeric AS cant,
                             (x->>'precioUnit')::numeric AS precio,
                             LEAST(GREATEST(COALESCE((x->>'descuentoPct')::numeric, 0), 0), 100) AS dpct) q;
  GET DIAGNOSTICS n = ROW_COUNT;

  IF EXISTS (SELECT 1 FROM public."CotizacionItems"
              WHERE "cotizacionId" = p_cotizacion_id AND (cantidad <= 0 OR "precioUnit" < 0)) THEN
    RAISE EXCEPTION 'Cantidad debe ser mayor que 0 y el precio no puede ser negativo.' USING ERRCODE = '22023';
  END IF;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.replace_cotizacion_items(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_cotizacion_items(uuid, jsonb) TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS cotizaciones_org_numero_uq
  ON public."Cotizaciones" (organization_id, numero);
