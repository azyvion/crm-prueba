// RESPALDO — register-crm v4 tal como estaba desplegada el 2026-10-23 (verify_jwt: false)
// supabase/functions/register-crm/index.ts — v4
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function slugify(txt: string): string {
  return txt
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 30);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  let body: {
    empresa?: { nombre?: string; correo?: string; pais?: string; sector?: string; tamano?: string };
    usuario?: { nombre?: string; cargo?: string; correo?: string; contrasena?: string };
    plan?: string;
    pago?: { metodo?: string; referencia?: string; cardLast4?: string };
  };

  try { body = await req.json(); }
  catch { return json({ ok: false, error: "JSON inválido." }, 400); }

  const { empresa, usuario, plan = "free" } = body;

  if (!empresa?.nombre?.trim())  return json({ ok: false, error: "Nombre de empresa requerido." }, 400);
  if (!empresa?.correo?.trim() || !empresa.correo.includes("@"))  return json({ ok: false, error: "Correo de empresa inválido." }, 400);
  if (!usuario?.nombre?.trim())  return json({ ok: false, error: "Nombre del usuario requerido." }, 400);
  if (!usuario?.correo?.trim() || !usuario.correo.includes("@"))  return json({ ok: false, error: "Correo de usuario inválido." }, 400);
  if (!usuario?.contrasena || usuario.contrasena.length < 8)  return json({ ok: false, error: "La contraseña debe tener al menos 8 caracteres." }, 400);
  if (!["free","starter","pro","enterprise"].includes(plan))  return json({ ok: false, error: "Plan no válido." }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const correoUsuario = usuario.correo.trim().toLowerCase();

  // 1 — Correo duplicado
  const { data: existe } = await sb.from("Usuarios").select("id").eq("correo", correoUsuario).maybeSingle();
  if (existe) return json({ ok: false, error: "Este correo ya tiene una cuenta registrada." }, 409);

  // 2 — Crear en Supabase Auth
  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email: correoUsuario,
    password: usuario.contrasena,
    email_confirm: true,
  });
  if (authErr) {
    const msg = authErr.message?.toLowerCase() ?? "";
    if (msg.includes("already")) return json({ ok: false, error: "Este correo ya tiene una cuenta registrada." }, 409);
    console.error("[register-crm] AUTH:", authErr.message);
    return json({ ok: false, error: "Error al crear el usuario (AUTH). Intenta de nuevo." }, 500);
  }
  const authUid = authData.user!.id;

  // IDs con mismo timestamp
  const ts = Date.now().toString(36);
  const orgId       = slugify(empresa.nombre.trim()) + "-" + ts;
  const usuarioSlug = slugify(usuario.nombre.trim()).substring(0, 18) + "-" + ts.slice(-6);

  // 3 — Crear Organization
  const { error: orgErr } = await sb.from("Organizations").insert({
    id: orgId,
    nombre: empresa.nombre.trim(),
    correo: empresa.correo.trim().toLowerCase(),
    pais_codigo: empresa.pais ? empresa.pais.substring(0, 5) : "GT",
    moneda: "USD",
    iva_pct: 12,
    prefijo_cotizacion: "COT-",
    prefijo_ticket: "POS-",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (orgErr) {
    try { await sb.auth.admin.deleteUser(authUid); } catch (_) { /**/ }
    console.error("[register-crm] ORG:", orgErr.message, orgErr.code);
    return json({ ok: false, error: "Error al crear la organización (ORG). Intenta de nuevo." }, 500);
  }

  // 4 — Crear Usuario (rol = 'Admin' para cumplir el check constraint)
  const { error: usrErr } = await sb.from("Usuarios").insert({
    usuario: usuarioSlug,
    nombre: usuario.nombre.trim(),
    correo: correoUsuario,
    cargo: usuario.cargo?.trim() || "",
    rol: "Admin",
    activo: true,
    auth_uid: authUid,
    organization_id: orgId,
    permisos: { submenus: ["pos","clientes","prospectos","cotizaciones","inventario","crear-producto","encuestas","contabilidad","perfil","usuarios"] },
    "fechaReg": new Date().toISOString(),
    tema: "claro",
    paginaInicio: "overview",
    densidadTabla: "comoda",
    copiarmeCotizaciones: false,
    alertaStockCritico: true,
  });
  if (usrErr) {
    try { await sb.auth.admin.deleteUser(authUid); } catch (_) { /**/ }
    try { await sb.from("Organizations").delete().eq("id", orgId); } catch (_) { /**/ }
    console.error("[register-crm] USR:", usrErr.message, usrErr.code);
    return json({ ok: false, error: "Error al registrar el usuario (USR). Intenta de nuevo." }, 500);
  }

  return json({ ok: true, organization_id: orgId, usuario: usuarioSlug, plan });
});
