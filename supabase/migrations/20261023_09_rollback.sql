-- ═══════════════════════════════════════════════════════════════════════
-- Reversión de 20261023_09_crm_productividad.sql
-- ATENCIÓN: borra plantillas, metas, ventas pendientes del POS y el registro de auditoría
-- general, y las columnas de tareas de ActividadesCRM (responsable, prioridad, completada…).
-- Las actividades en sí no se borran. Respalde esas tablas antes si tienen datos.
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Clientes', 'Prospectos', 'Cotizaciones', 'Inventario', 'Usuarios', 'Transacciones', 'crm_plantillas', 'crm_metas'] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_crm_auditoria ON public.%I', t);
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.crm_importar_productos(jsonb, boolean, boolean);
DROP FUNCTION IF EXISTS public.crm_importar_clientes(jsonb, boolean, boolean);
DROP FUNCTION IF EXISTS public.crm_metas_progreso(date);
DROP FUNCTION IF EXISTS public.crm_meta_guardar(jsonb);
DROP FUNCTION IF EXISTS public.crm_listar_auditoria(date, date, text, text, integer);
DROP FUNCTION IF EXISTS public.crm_tareas(date, date, boolean, boolean);

DROP TABLE IF EXISTS public.crm_metas;
DROP TABLE IF EXISTS public.crm_auditoria;
DROP FUNCTION IF EXISTS public.trg_fn_crm_auditoria();
DROP TABLE IF EXISTS public.pos_ventas_pendientes;
DROP FUNCTION IF EXISTS public.trg_fn_pos_pend_autor();
DROP TABLE IF EXISTS public.crm_plantillas;

DROP INDEX IF EXISTS public.ix_actividades_tareas;
ALTER TABLE public."ActividadesCRM" DROP CONSTRAINT IF EXISTS actividadescrm_prioridad_chk;
ALTER TABLE public."ActividadesCRM"
  DROP COLUMN IF EXISTS responsable, DROP COLUMN IF EXISTS hora_seguimiento, DROP COLUMN IF EXISTS prioridad,
  DROP COLUMN IF EXISTS completada, DROP COLUMN IF EXISTS completada_en, DROP COLUMN IF EXISTS completada_por;
-- refId vuelve a ser obligatorio solo si no quedaron tareas generales (sin cliente/prospecto).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."ActividadesCRM" WHERE "refId" IS NULL) THEN
    ALTER TABLE public."ActividadesCRM" ALTER COLUMN "refId" SET NOT NULL;
  ELSE
    RAISE NOTICE 'Hay actividades sin refId (tareas generales); refId se deja opcional.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.crm_ctx();
DROP FUNCTION IF EXISTS public.crm_es_privilegiado();

