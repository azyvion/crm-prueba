-- ═══════════════════════════════════════════════════════════════════════
-- Reversión de 20261023_10_embudo_ventas.sql
-- ATENCIÓN: borra la fecha de cierre estimada, el motivo de pérdida y la fecha de cierre de
-- todos los prospectos. Los prospectos «Ganado» se conservan con esa etapa (la interfaz
-- anterior los muestra como etapa desconocida). Respalde la tabla antes si tiene datos.
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.crm_convertir_prospecto(uuid, text, text, numeric);
DROP TRIGGER IF EXISTS trg_prospecto_cierre ON public."Prospectos";
DROP FUNCTION IF EXISTS public.trg_fn_prospecto_cierre();
DROP INDEX IF EXISTS public.ix_prospectos_org_cierre;
DROP INDEX IF EXISTS public.ix_prospectos_org_etapa;
ALTER TABLE public."Prospectos"
  DROP CONSTRAINT IF EXISTS prospectos_motivo_len_chk,
  DROP CONSTRAINT IF EXISTS prospectos_valor_chk,
  DROP CONSTRAINT IF EXISTS prospectos_probabilidad_chk,
  DROP CONSTRAINT IF EXISTS prospectos_etapa_chk,
  DROP COLUMN IF EXISTS cerrado_por,
  DROP COLUMN IF EXISTS cerrado_en,
  DROP COLUMN IF EXISTS motivo_perdida_detalle,
  DROP COLUMN IF EXISTS motivo_perdida,
  DROP COLUMN IF EXISTS fecha_cierre_estimada;
