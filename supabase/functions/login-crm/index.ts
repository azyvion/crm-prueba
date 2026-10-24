// supabase/functions/login-crm/index.ts — v8 (Lote 9: licencias)
// Basado en la v7 desplegada. Cambio: después de validar la contraseña se exige que la
// empresa tenga una licencia vigente (licencia_org_vigente). Sin licencia:
//  - administradores: reciben la sesión con sinLicencia=true para poder activar una
//    licencia nueva (la base de datos les niega todos los datos mientras tanto);
//  - el resto: 403 sin sesión, con los datos de contacto de ventas.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256(v: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function hashPwd(pwd: string, salt: string): Promise<string> {
  let h = await sha256(salt + pwd);
  for (let i = 0; i < 9999; i++) { h = await sha256(h + salt + pwd); }
  return h;
}

const attempts = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) { attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 }); return true; }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

const ERR_CREDS = { ok: false, error: "Usuario o contraseña incorrectos." };
const CONTACTO = { telefono: "+502 5145 5610", correo: "ventas@azyvion.com" };
const ROLES_ACTIVAN = ["ADMIN", "GERENTE", "SUPER_ADMIN"];

type SB = ReturnType<typeof createClient>;
// null = licencia vigente (o usuario sin empresa: la RLS ya le niega todo); si no, la respuesta a devolver
async function revisarLicencia(sb: SB, usr: { organization_id?: string | null; rol?: string | null }, accessToken: string) {
  if (!usr.organization_id) return null;
  const { data: vigente, error } = await sb.rpc("licencia_org_vigente", { p_org: String(usr.organization_id) });
  if (error) { console.error("[login-crm] licencia:", error.message); return json({ ok: false, error: "No se pudo verificar la licencia. Intenta de nuevo." }, 503); }
  if (vigente === true) return null;
  const puedeActivar = ROLES_ACTIVAN.includes(String(usr.rol || "").toUpperCase());
  if (!puedeActivar) {
    try { await sb.auth.admin.signOut(accessToken); } catch (_) { /* la sesión igual no recibe datos */ }
    return json({ ok: false, sinLicencia: true, puedeActivar: false, contacto: CONTACTO,
      error: "Tu empresa no tiene una licencia vigente. Pide a tu administrador que la renueve o contacta a ventas." }, 403);
  }
  return "ADMIN_SIN_LICENCIA";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function prefs(u: Record<string, unknown>) {
  return {
    tema: u.tema === "oscuro" ? "oscuro" : "claro",
    paginaInicio: ["overview","clientes","prospectos","inventario","cotizaciones","encuestas","contabilidad","usuarios"]
      .includes(String(u.paginaInicio)) ? u.paginaInicio : "overview",
    densidadTabla: u.densidadTabla === "compacta" ? "compacta" : "comoda",
    copiarmeCotizaciones: Boolean(u.copiarmeCotizaciones),
    alertaStockCritico: Boolean(u.alertaStockCritico),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  let body: { usuario?: string; contrasena?: string };
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "JSON inválido." }, 400); }

  const { usuario, contrasena } = body;
  if (!usuario || !contrasena)
    return json({ ok: false, error: "Usuario y contraseña son requeridos." }, 400);

  if (!checkRateLimit("u:" + usuario.trim().toLowerCase()))
    return json({ ok: false, error: "Demasiados intentos. Espera 15 minutos." }, 429);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const input = usuario.trim();
  const isEmail = input.includes("@");

  // Buscar por correo O por slug de usuario
  const { data: usr, error: usrErr } = await sb
    .from("Usuarios")
    .select(`id, usuario, nombre, correo, rol, activo, auth_uid,
             organization_id, permisos, fotoUrl, tema, paginaInicio,
             densidadTabla, copiarmeCotizaciones, alertaStockCritico`)
    .eq(isEmail ? "correo" : "usuario", isEmail ? input.toLowerCase() : input)
    .maybeSingle();

  if (usrErr || !usr) return json(ERR_CREDS, 401);
  if (!usr.activo)    return json(ERR_CREDS, 401);

  // MODO A: auth_uid existe → Supabase Auth
  if (usr.auth_uid) {
    const { data: signIn, error: signErr } = await sb.auth.signInWithPassword({
      email: usr.correo,
      password: contrasena,
    });
    if (signErr || !signIn.session) return json(ERR_CREDS, 401);

    const lic = await revisarLicencia(sb, usr, signIn.session.access_token);
    if (lic instanceof Response) return lic;

    return json({
      ok: true,
      ...(lic ? { sinLicencia: true, puedeActivar: true, contacto: CONTACTO } : {}),
      session: {
        access_token:  signIn.session.access_token,
        refresh_token: signIn.session.refresh_token,
        expires_at:    signIn.session.expires_at,
      },
      nombre:          usr.nombre,
      rol:             usr.rol,
      usuario:         usr.usuario,
      organization_id: usr.organization_id || null,
      permisos:        usr.permisos || null,
      fotoUrl:         usr.fotoUrl || "",
      preferencias:    prefs(usr),
    });
  }

  // MODO B: auth_uid NULL → hash legacy
  const { data: creds } = await sb
    .from("Usuarios")
    .select("passwordHash, passwordSalt")
    .eq("id", usr.id)
    .maybeSingle();

  if (!creds?.passwordHash || !creds?.passwordSalt)
    return json({ ok: false, error: "Cuenta sin credenciales válidas. Contacta al administrador." }, 401);

  const computed = await hashPwd(contrasena, creds.passwordSalt);
  if (computed !== creds.passwordHash) return json(ERR_CREDS, 401);

  // Migrar a Supabase Auth
  let authUid: string;
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email: usr.correo, password: contrasena, email_confirm: true,
  });

  if (createErr) {
    const msg = createErr.message?.toLowerCase() ?? "";
    const isConflict = msg.includes("already been registered") || msg.includes("already exists")
      || (createErr as unknown as { code?: string }).code === "email_exists";
    if (isConflict) {
      const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
      const match = (list?.users || []).find((u) => u.email?.toLowerCase() === usr.correo.toLowerCase());
      if (!match) return json({ ok: false, error: "Error interno al migrar la cuenta. [E01]" }, 500);
      authUid = match.id;
      await sb.auth.admin.updateUserById(authUid, { password: contrasena });
    } else {
      return json({ ok: false, error: "Error interno al migrar la cuenta. [E02]" }, 500);
    }
  } else {
    if (!created?.user) return json({ ok: false, error: "Error interno al migrar la cuenta. [E03]" }, 500);
    authUid = created.user.id;
  }

  const { error: updateErr } = await sb.from("Usuarios").update({ auth_uid: authUid }).eq("id", usr.id);
  if (updateErr) return json({ ok: false, error: "Error al completar la migración. Intenta de nuevo." }, 500);

  const { data: signIn2, error: signErr2 } = await sb.auth.signInWithPassword({
    email: usr.correo, password: contrasena,
  });
  if (signErr2 || !signIn2.session)
    return json({ ok: false, error: "Cuenta migrada pero error al iniciar sesión. Intenta de nuevo." }, 500);

  const lic2 = await revisarLicencia(sb, usr, signIn2.session.access_token);
  if (lic2 instanceof Response) return lic2;

  return json({
    ok: true,
    ...(lic2 ? { sinLicencia: true, puedeActivar: true, contacto: CONTACTO } : {}),
    session: {
      access_token:  signIn2.session.access_token,
      refresh_token: signIn2.session.refresh_token,
      expires_at:    signIn2.session.expires_at,
    },
    nombre:          usr.nombre,
    rol:             usr.rol,
    usuario:         usr.usuario,
    organization_id: usr.organization_id || null,
    permisos:        usr.permisos || null,
    fotoUrl:         usr.fotoUrl || "",
    preferencias:    prefs(usr),
    _migrated:       true,
  });
});
