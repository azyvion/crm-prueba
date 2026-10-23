-- AZYVION CRM · Lote 2 · SEC-15
-- admin_insert_usuario (SECURITY DEFINER) era ejecutable por cualquier usuario
-- autenticado y acepta un p_auth_uid arbitrario. No lo usa el frontend ni las
-- Edge Functions (usan admin_create_usuario_profile vía service_role).
-- Reversión: GRANT EXECUTE ON FUNCTION public.admin_insert_usuario(uuid,text,text,text,text,text,text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_insert_usuario(uuid, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
