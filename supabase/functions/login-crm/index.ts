// supabase/functions/login-crm/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256(v: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(v)
  );
  return Array.from(new Uint8Array(buf))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPwd(pwd: string, salt: string): Promise<string> {
  let h = await sha256(salt + pwd);
  for (let i = 0; i < 9999; i++) {
    h = await sha256(h + salt + pwd);
  }
  return h;
}

const attempts = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

const ERR_CREDS = { ok: false, error: "Usuario o contraseña incorrectos." };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function prefs(u: Record<string, unknown>) {
  return {
    tema: u.tema === "oscuro" ? "oscuro" : "claro",
    paginaInicio: [
      "overview", "clientes", "prospectos", "inventario",
      "cotizaciones", "encuestas", "contabilidad", "usuarios",
    ].includes(String(u.paginaInicio)) ? u.paginaInicio : "overview",
    densidadTabla: u.densidadTabla === "compacta" ? "compacta" : "comoda",
    copiarmeCotizaciones: Boolean(u.copiarmeCotizaciones),
    alertaStockCritico: Boolean(u.alertaStockCritico),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  let body: { usuario?: string; contrasena?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }

  const { usuario, contrasena } = body;
  if (!usuario || !contrasena) {
    return json({ ok: false, error: "Usuario y contraseña son requeridos." }, 400);
  }

  if (!checkRateLimit("u:" + usuario.trim().toLowerCase())) {
    return json({ ok: false, error: "Demasiados intentos. Espera 15 minutos." }, 429);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // PASO 1: Buscar usuario sin campos de contraseña
  const { data: usr, error: usrErr } = await sb
    .from("Usuarios")
    .select(`
      id, usuario, nombre, correo, rol, activo, auth_uid,
      organization_id, permisos,
      fotoUrl, tema, paginaInicio, densidadTabla,
      copiarmeCotizaciones, alertaStockCritico
    `)
    .eq("usuario", usuario.trim())
    .single();

  if (usrErr || !usr) return json(ERR_CREDS, 401);
  if (!usr.activo)    return json(ERR_CREDS, 401);

  // MODO A: auth_uid existe → Supabase Auth directo
  if (usr.auth_uid) {
    const { data: signIn, error: signErr } = await sb.auth.signInWithPassword({
      email: usr.correo,
      password: contrasena,
    });
    if (signErr || !signIn.session) return json(ERR_CREDS, 401);

    return json({
      ok: true,
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

  // MODO B: auth_uid NULL → verificar hash legacy
  // Segunda query separada, solo cuando es necesario
  const { data: creds, error: credsErr } = await sb
    .from("Usuarios")
    .select("passwordHash, passwordSalt")
    .eq("id", usr.id)
    .single();

  if (credsErr || !creds?.passwordHash || !creds?.passwordSalt) {
    return json({ ok: false, error: "Cuenta sin credenciales válidas. Contacta al administrador." }, 401);
  }

  const computed = await hashPwd(contrasena, creds.passwordSalt);
  if (computed !== creds.passwordHash) return json(ERR_CREDS, 401);

  // PASO 2: Crear usuario en auth.users
  let authUid: string;

  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email: usr.correo,
    password: contrasena,
    email_confirm: true,
  });

  if (createErr) {
    const msg = createErr.message?.toLowerCase() ?? "";
    const isEmailConflict =
      msg.includes("already been registered") ||
      msg.includes("already exists") ||
      (createErr as unknown as { code?: string }).code === "email_exists";

    if (isEmailConflict) {
      // Migración anterior incompleta: recuperar uid existente
      const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
      const match = (list?.users || []).find(
        (u) => u.email?.toLowerCase() === usr.correo.toLowerCase()
      );
      if (!match) {
        console.error("Email conflict pero no encontrado en auth.users:", usr.id);
        return json({ ok: false, error: "Error interno al migrar la cuenta. [E01]" }, 500);
      }
      authUid = match.id;
      await sb.auth.admin.updateUserById(authUid, { password: contrasena });
    } else {
      console.error("Error inesperado creando auth user:", usr.id, createErr.message);
      return json({ ok: false, error: "Error interno al migrar la cuenta. [E02]" }, 500);
    }
  } else {
    if (!created?.user) {
      return json({ ok: false, error: "Error interno al migrar la cuenta. [E03]" }, 500);
    }
    authUid = created.user.id;
  }

  // PASO 3: Guardar auth_uid en Usuarios
  const { error: updateErr } = await sb
    .from("Usuarios")
    .update({ auth_uid: authUid })
    .eq("id", usr.id);

  if (updateErr) {
    // auth.users creado/recuperado correctamente pero auth_uid no guardado.
    // No se devuelve sesión para evitar estado inconsistente.
    // El próximo intento detectará el email duplicado en auth.users,
    // recuperará el mismo authUid y reintentará el UPDATE.
    console.error("Error guardando auth_uid para usuario:", usr.id, updateErr.message);
    return json({
      ok: false,
      error: "La migración no pudo completarse. Intenta iniciar sesión de nuevo.",
    }, 500);
  }

  // PASO 4: Iniciar sesión — solo si auth_uid quedó correctamente guardado
  const { data: signIn2, error: signErr2 } = await sb.auth.signInWithPassword({
    email: usr.correo,
    password: contrasena,
  });

  if (signErr2 || !signIn2.session) {
    return json({
      ok: false,
      error: "Cuenta migrada correctamente pero error al iniciar sesión. Intenta de nuevo.",
    }, 500);
  }

  return json({
    ok: true,
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
