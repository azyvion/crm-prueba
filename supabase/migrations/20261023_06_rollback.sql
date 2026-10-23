-- Reversión de 20261023_06_pos_ventas.sql
-- ADVERTENCIA: elimina las tablas pos_* (ventas, pagos, devoluciones, movimientos y auditoría).
-- Si ya hay ventas registradas con este esquema, exporte antes esas tablas.
-- Los triggers de no-borrado se quitan primero para poder eliminar las tablas.
DROP FUNCTION IF EXISTS public.pos_mis_permisos();
DROP FUNCTION IF EXISTS public.pos_obtener_ticket(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.pos_devolver_venta(jsonb);
DROP FUNCTION IF EXISTS public.pos_registrar_venta(jsonb);
DROP FUNCTION IF EXISTS public.pos_reabrir_caja(text, text);
DROP FUNCTION IF EXISTS public.pos_cerrar_caja(text, numeric, text);
DROP FUNCTION IF EXISTS public.pos_caja_movimiento(text, numeric, text);
DROP FUNCTION IF EXISTS public.pos_abrir_caja(numeric, text);
DROP FUNCTION IF EXISTS public.pos_estado_caja();
DROP FUNCTION IF EXISTS public.pos_resumen_turno_int(text, text);
DROP FUNCTION IF EXISTS public.pos_ticket_json(uuid);
DROP FUNCTION IF EXISTS public.pos_audit(text, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.pos_puede(boolean, jsonb, text);
DROP FUNCTION IF EXISTS public.pos_ctx();

DROP TRIGGER IF EXISTS trg_protect_usuarios_permisos ON public."Usuarios";
DROP FUNCTION IF EXISTS public.pos_proteger_permisos_usuario();
DROP TRIGGER IF EXISTS trg_pos_turno_inmutable ON public."Cajas_Turnos";
DROP FUNCTION IF EXISTS public.pos_turno_cerrado_inmutable();

DROP TABLE IF EXISTS public.pos_devolucion_items, public.pos_devoluciones, public.pos_venta_pagos,
                     public.pos_venta_items, public.pos_ventas, public.pos_caja_movimientos,
                     public.pos_auditoria, public.pos_secuencias CASCADE;
DROP FUNCTION IF EXISTS public.pos_bloquear_borrado();
DROP FUNCTION IF EXISTS public.pos_bloquear_modif_auditoria();

DROP INDEX IF EXISTS public.ux_cajas_turnos_abierta;
ALTER TABLE public."Cajas_Turnos"
  DROP COLUMN IF EXISTS entradas, DROP COLUMN IF EXISTS salidas, DROP COLUMN IF EXISTS devoluciones_efectivo,
  DROP COLUMN IF EXISTS devoluciones_otros, DROP COLUMN IF EXISTS tickets, DROP COLUMN IF EXISTS cerrado_por;

-- Política original de Cajas_Turnos (lectura y escritura por organización)
DROP POLICY IF EXISTS cajas_turnos_sel ON public."Cajas_Turnos";
CREATE POLICY tenant_isolation ON public."Cajas_Turnos" FOR ALL TO public
  USING (organization_id = public.current_user_org_id()) WITH CHECK (organization_id = public.current_user_org_id());
GRANT INSERT, UPDATE, DELETE ON public."Cajas_Turnos" TO authenticated;
