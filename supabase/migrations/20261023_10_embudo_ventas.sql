-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Lote 8 · Embudo de ventas: etapa «Ganado», fecha de cierre estimada,
-- motivo de pérdida y conversión a cliente atómica que conserva el historial.
-- Reglas: el motivo es obligatorio solo al PASAR a «Perdido» (los perdidos anteriores no
-- tienen motivo y se pueden seguir editando); al cerrar (Ganado/Perdido) se fija la fecha de
-- cierre y la probabilidad (100/0); al reabrir se limpian. Todo es SECURITY INVOKER: la RLS
-- de Prospectos y Clientes sigue aplicando. Requiere 09 (crm_ctx). Reversión: 20261023_10_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public."Prospectos"
  ADD COLUMN IF NOT EXISTS fecha_cierre_estimada  date,
  ADD COLUMN IF NOT EXISTS motivo_perdida         text,
  ADD COLUMN IF NOT EXISTS motivo_perdida_detalle text,
  ADD COLUMN IF NOT EXISTS cerrado_en             timestamptz,
  ADD COLUMN IF NOT EXISTS cerrado_por            text;

DO $$ BEGIN
  ALTER TABLE public."Prospectos" ADD CONSTRAINT prospectos_etapa_chk
    CHECK (etapa IN ('Nuevo', 'Contactado', 'Calificado', 'Propuesta', 'Negociación', 'Ganado', 'Perdido'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."Prospectos" ADD CONSTRAINT prospectos_probabilidad_chk CHECK (probabilidad BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."Prospectos" ADD CONSTRAINT prospectos_valor_chk CHECK ("valorEstimado" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public."Prospectos" ADD CONSTRAINT prospectos_motivo_len_chk
    CHECK (char_length(motivo_perdida) <= 80 AND char_length(motivo_perdida_detalle) <= 500);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_prospectos_org_etapa ON public."Prospectos" (organization_id, etapa);
CREATE INDEX IF NOT EXISTS ix_prospectos_org_cierre ON public."Prospectos" (organization_id, fecha_cierre_estimada)
  WHERE etapa NOT IN ('Ganado', 'Perdido');

-- ── Reglas de cierre ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_prospecto_cierre() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_user text;
BEGIN
  NEW.etapa := COALESCE(NULLIF(NEW.etapa, ''), 'Nuevo');
  NEW.motivo_perdida := NULLIF(btrim(COALESCE(NEW.motivo_perdida, '')), '');
  NEW.motivo_perdida_detalle := NULLIF(btrim(COALESCE(NEW.motivo_perdida_detalle, '')), '');

  IF NEW.etapa IN ('Ganado', 'Perdido') THEN
    IF TG_OP = 'INSERT' OR OLD.etapa IS DISTINCT FROM NEW.etapa THEN
      IF NEW.etapa = 'Perdido' AND NEW.motivo_perdida IS NULL THEN
        RAISE EXCEPTION 'Indique el motivo de pérdida.' USING ERRCODE = '23514';
      END IF;
      BEGIN SELECT usuario INTO v_user FROM public.crm_ctx() LIMIT 1; EXCEPTION WHEN OTHERS THEN v_user := NULL; END;
      NEW.cerrado_en := now();
      NEW.cerrado_por := v_user;
    END IF;
    NEW.probabilidad := CASE NEW.etapa WHEN 'Ganado' THEN 100 ELSE 0 END;
    IF NEW.etapa = 'Ganado' THEN NEW.motivo_perdida := NULL; NEW.motivo_perdida_detalle := NULL; END IF;
  ELSE
    -- Oportunidad abierta (o reabierta): no tiene cierre ni motivo
    NEW.cerrado_en := NULL; NEW.cerrado_por := NULL;
    NEW.motivo_perdida := NULL; NEW.motivo_perdida_detalle := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_prospecto_cierre ON public."Prospectos";
CREATE TRIGGER trg_prospecto_cierre BEFORE INSERT OR UPDATE ON public."Prospectos"
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_prospecto_cierre();

-- ── Convertir en cliente: crea el cliente y deja el prospecto como «Ganado» ──
-- Antes se borraba el prospecto (y no se revisaban errores): se perdía el historial del
-- embudo y un fallo podía dejar el prospecto borrado sin cliente.
CREATE OR REPLACE FUNCTION public.crm_convertir_prospecto(p_id uuid, p_segmento text DEFAULT NULL,
                                                          p_estado text DEFAULT 'Activo', p_valor numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE pr public."Prospectos"; v_cli uuid := gen_random_uuid(); v_valor numeric;
BEGIN
  IF (SELECT usuario FROM public.crm_ctx() LIMIT 1) IS NULL THEN RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO pr FROM public."Prospectos" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prospecto no encontrado.' USING ERRCODE = 'P0002'; END IF;
  IF pr.etapa = 'Ganado' AND pr."clienteId" IS NOT NULL THEN
    RAISE EXCEPTION 'Este prospecto ya fue convertido en cliente.' USING ERRCODE = '23505';
  END IF;
  IF COALESCE(p_estado, 'Activo') NOT IN ('Activo', 'Pendiente') THEN
    RAISE EXCEPTION 'Estado inválido.' USING ERRCODE = '22023';
  END IF;
  v_valor := COALESCE(p_valor, pr."valorEstimado", 0);
  IF v_valor < 0 THEN RAISE EXCEPTION 'El valor no puede ser negativo.' USING ERRCODE = '22023'; END IF;

  INSERT INTO public."Clientes"(id, nombre, empresa, segmento, lista_precio, correo, telefono, direccion, estado,
                                "valorTotal", color, "fechaReg", organization_id, "prospectoOrigenId", fuente)
  VALUES (v_cli, pr.nombre, COALESCE(pr.empresa, ''), COALESCE(NULLIF(p_segmento, ''), pr.segmento, 'Estándar'), 'Publico',
          COALESCE(pr.correo, ''), COALESCE(pr.telefono, ''), COALESCE(pr.direccion, ''), COALESCE(p_estado, 'Activo'),
          v_valor, COALESCE(pr.color, '#0A84FF'), now(), pr.organization_id, pr.id, COALESCE(pr.origen, ''));

  UPDATE public."Prospectos" SET etapa = 'Ganado', "clienteId" = v_cli, "valorEstimado" = v_valor WHERE id = pr.id;
  RETURN jsonb_build_object('ok', true, 'cliente_id', v_cli);
END $$;
REVOKE ALL ON FUNCTION public.crm_convertir_prospecto(uuid, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_convertir_prospecto(uuid, text, text, numeric) TO authenticated;
