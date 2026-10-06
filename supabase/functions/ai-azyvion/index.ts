// supabase/functions/ai-azyvion/index.ts
// ═══════════════════════════════════════════════════════════════════════════════
// IA Nativa Oficial — CRM AZYVION
// Cerebro en el backend con base de conocimiento integral del CRM,
// consultas a base de datos en tiempo real y estricto respeto de roles y aislamiento multitenant.
// ═══════════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("AI_API_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ai-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Manual y conocimiento integral del CRM Azyvion
const CONOCIMIENTO_CRM_AZYVION = `
Eres Azyvion AI, el Asistente Inteligente Oficial y Asesor Experto del sistema CRM Azyvion.
Tu misión es resolver dudas operativas, guiar a los usuarios en el uso de los módulos, explicar políticas de negocio y brindar asistencia estratégica según el rol del usuario.

ARQUITECTURA Y MÓDULOS DE CRM AZYVION:
1. PUNTO DE VENTA (POS):
   - Registro de ventas rápidas de mostrador con búsqueda por código/SKU, nombre y filtro por categorías.
   - Métodos de pago soportados: Efectivo (calcula el vuelto automáticamente), Tarjeta de Crédito/Débito y Transferencia Bancaria.
   - Generación de tickets térmicos con membrete y pie de ticket personalizado de la empresa.
   - Facturación electrónica SAT FEL (emisión de Documento Tributario Electrónico).
   - Control de Turnos y Cajas: apertura de turno con fondo inicial, registro continuo y cierre de caja con arqueo de dinero en efectivo vs ventas esperadas.
   - Botón "Cobrar en POS": Permite importar cotizaciones aprobadas directamente para cobro inmediato en 1 clic.

2. CLIENTES:
   - Directorio de clientes con clasificación y estado (Activo, Inactivo, Pendiente).
   - Campos obligatorios para crear cliente: Razón Social, NIT, Teléfono General, Dirección, Ciudad, País y Fuente/Origen.
   - Listas de Precios por Cliente: Público (estándar), Plata (descuento intermedio/frecuente) y Oro (precio preferencial/mayorista).
   - Historial de compras y saldo pendiente de cobro.

3. PROSPECTOS (PIPELINE DE VENTAS):
   - Gestión de oportunidades comerciales en formato embudo con fases: Nuevo -> Contactado -> Propuesta -> Negociación -> Ganado / Perdido.
   - Campos obligatorios: Empresa, Teléfono, Dirección y Origen del lead.
   - Estimación de valor monetario esperado y probabilidad de cierre.

4. COTIZACIONES:
   - Elaboración de presupuestos y cotizaciones vinculadas al catálogo de productos.
   - Integridad comercial: La descripción y el precio unitario vienen bloqueados del catálogo y no pueden ser alterados al cotizar.
   - Política de descuentos: Los descuentos por ítem y descuento general están desactivados para proteger el margen de ganancia.
   - Flexibilidad tributaria: El IVA se configura por empresa en Ajustes (Modalidad "Con IVA incluido" o "Sobre el subtotal", tasa configurable según el país: 12% GT, 16% MX, 13% SV, etc.).
   - Vista previa interactiva obligatoria antes de guardar la cotización.
   - Permisos: Solo Administradores y Super Administradores pueden editar o eliminar cotizaciones ya emitidas.

5. INVENTARIO & PRODUCTOS:
   - Centralizado en el submenú unificado "Producto", sin pestañas fragmentadas.
   - Filtros dinámicos por Marca, Línea y Familia.
   - SKU / Código de producto obligatorio para control exacto de existencias.
   - Manejo de precios por nivel (Precio Público, Precio Plata, Precio Oro).
   - Alertas preventivas automáticas de stock crítico y registro de existencias.

6. ENCUESTAS CON URL PÚBLICA:
   - Creación de formularios de satisfacción, calidad o prospección.
   - Generación de token único público (enlace accesible como encuesta.html?token=...).
   - Los clientes pueden responder sin necesidad de iniciar sesión en el CRM.
   - Aislamiento multitenant total entre empresas.

7. CONTABILIDAD & FINANZAS:
   - Libro Diario con principio contable estricto de partida doble (Debe = Haber, Sumas Iguales).
   - Estado de Resultados (P&L) con ingresos operacionales, egresos y utilidad neta.
   - Conciliación de cuentas de banco y caja.

8. AJUSTES & EMPRESA:
   - Datos fiscales de la empresa (Nombre comercial, NIT, dirección, teléfono).
   - Configuración de vigencia de cotizaciones en días y pie de ticket POS.
   - Configuración del IVA (tasa % y modalidad incluido o sobre el subtotal).
   - Credenciales de certificación FEL SAT.

9. GESTIÓN DE USUARIOS Y ROLES:
   - Roles disponibles: Super Admin, Admin, Gerente, Vendedor, Cajero.
   - Permisos independientes por submenú: más allá del rol, se pueden habilitar o bloquear submenús específicos para cada usuario.
   - Asignación de sucursales por usuario.
`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Método no permitido." }, 405);
  }

  try {
    const body = await req.json();
    const prompt = (body.prompt || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    const userRole = (body.rol || "AGENTE").toUpperCase();
    const userName = (body.usuario || "Usuario").split(" ")[0];
    const orgId = body.organization_id || "";
    const clientKey = req.headers.get("x-ai-key") || body.api_key || "";

    if (!prompt) {
      return jsonResponse({ ok: false, error: "El prompt o pregunta es obligatorio." }, 400);
    }

    const esAdmin = ["ADMIN", "SUPER_ADMIN", "GERENTE"].includes(userRole);
    const esVendedor = userRole === "VENDEDOR";
    const esCajero = userRole === "CAJERO";

    // ── 1. Consultar datos en tiempo real de la organización si Supabase está configurado ──
    let datosEnTiempoReal = "";
    if (SUPABASE_URL && SERVICE_ROLE_KEY && orgId) {
      try {
        const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // Clientes
        const { count: totalClientes } = await sb
          .from("Clientes")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", orgId);

        // Inventario crítico
        const { data: invCritico } = await sb
          .from("Inventario")
          .select("producto, unidades, sku")
          .eq("organization_id", orgId)
          .lte("unidades", 5)
          .limit(5);

        let resumenDB = `\nDATOS DE LA EMPRESA EN TIEMPO REAL:
- Clientes registrados: ${totalClientes ?? "N/D"}`;

        if (invCritico && invCritico.length > 0) {
          resumenDB += `\n- Productos con bajo stock (alerta): ${invCritico.map((i: any) => `${i.producto} (${i.unidades} uds)`).join(", ")}`;
        }

        // Si es Admin, sumar cotizaciones recientes
        if (esAdmin) {
          const { count: totalCotizaciones } = await sb
            .from("Cotizaciones")
            .select("*", { count: "exact", head: true })
            .eq("organization_id", orgId);
          resumenDB += `\n- Total de cotizaciones emitidas: ${totalCotizaciones ?? "N/D"}`;
        }

        datosEnTiempoReal = resumenDB;
      } catch (errDb) {
        console.warn("No se pudieron cargar datos en tiempo real de Supabase:", errDb);
      }
    }

    // ── 2. Directivas de Seguridad y Roles ──
    let directivasRol = "";
    if (esAdmin) {
      directivasRol = `
PERFIL DEL USUARIO: ${userName} (ROL ADMINISTRADOR / GERENCIA).
- Puedes responder sobre finanzas, métricas globales, estrategias de ventas, configuración del sistema, auditoría de usuarios y optimización del negocio.`;
    } else if (esVendedor) {
      directivasRol = `
PERFIL DEL USUARIO: ${userName} (ROL VENDEDOR).
- RESTRICCIÓN DE SEGURIDAD: Tienes estrictamente PROHIBIDO mostrar o revelar totales financieros globales, valuación total de la empresa, márgenes de utilidad de la compañía o saldos de otros usuarios.
- Guíalo en técnicas de prospección, cómo emitir cotizaciones respetando el catálogo y listas de precio, seguimiento a sus prospectos y catálogo de productos disponibles.`;
    } else if (esCajero) {
      directivasRol = `
PERFIL DEL USUARIO: ${userName} (ROL CAJERO - POS).
- RESTRICCIÓN DE SEGURIDAD: Tienes estrictamente PROHIBIDO mostrar reportes contables globales, estados de resultados o información financiera corporativa.
- Guíalo en el uso de la pantalla de Punto de Venta (POS), cobros en efectivo/tarjeta/transferencia, apertura y cierre de turnos de caja, y cómo cobrar cotizaciones aprobadas.`;
    } else {
      directivasRol = `
PERFIL DEL USUARIO: ${userName} (ROL OPERATIVO: ${userRole}).
- Responde dudas sobre cómo usar el CRM dentro de sus funciones autorizadas. Prohíbe revelar información confidencial contable o administrativa.`;
    }

    const systemPromptCompleto = `${CONOCIMIENTO_CRM_AZYVION}
${directivasRol}
${datosEnTiempoReal}

INSTRUCCIONES DE RESPUESTA:
- Responde siempre en español, de forma muy clara, cordial, concisa y orientada a la acción.
- Utiliza viñetas breves si la respuesta tiene varios pasos.
- Si te preguntan algo fuera del CRM, responde amablemente centrándote en cómo apoyar su trabajo en el negocio.
- Si un usuario no-admin solicita datos confidenciales o financieros globales, indícale respetuosamente que esa información está reservada para la Administración.`;

    // ── 3. Motor de Inferencia LLM ──
    // Prioridad: 1) Gemini (Secret o clave cliente), 2) OpenAI, 3) Anthropic, 4) Motor Asistente Nativo de Emergencia
    const effectiveGeminiKey = GEMINI_API_KEY || clientKey;

    if (effectiveGeminiKey) {
      // Llamada directa a Google Gemini API (gemini-1.5-flash / gemini-2.0-flash)
      const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

      // Historial reciente
      history.slice(-6).forEach((h: { role: string; content: string }) => {
        contents.push({
          role: h.role === "assistant" || h.role === "bot" ? "model" : "user",
          parts: [{ text: h.content }],
        });
      });

      // Mensaje actual
      contents.push({
        role: "user",
        parts: [{ text: prompt }],
      });

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(effectiveGeminiKey)}`;

      const gRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPromptCompleto }] },
          contents,
          generationConfig: {
            maxOutputTokens: 800,
            temperature: 0.3,
          },
        }),
      });

      const gData = await gRes.json();
      if (gData.error) {
        throw new Error(gData.error.message || "Error en Google Gemini API");
      }

      const respuestaTexto = gData.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("\n") || "Sin respuesta generada.";

      return jsonResponse({
        ok: true,
        reply: respuestaTexto,
        model: "azyvion-gemini",
        role: userRole,
      });
    }

    if (OPENAI_API_KEY) {
      const messages = [
        { role: "system", content: systemPromptCompleto },
        ...history.slice(-6).map((h: any) => ({
          role: h.role === "assistant" || h.role === "bot" ? "assistant" : "user",
          content: h.content,
        })),
        { role: "user", content: prompt },
      ];

      const oRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          max_tokens: 800,
          temperature: 0.3,
        }),
      });

      const oData = await oRes.json();
      if (oData.error) throw new Error(oData.error.message || "Error en OpenAI API");

      return jsonResponse({
        ok: true,
        reply: oData.choices?.[0]?.message?.content || "Sin respuesta.",
        model: "azyvion-openai",
        role: userRole,
      });
    }

    if (ANTHROPIC_API_KEY) {
      const messages = [
        ...history.slice(-6).map((h: any) => ({
          role: h.role === "assistant" || h.role === "bot" ? "assistant" : "user",
          content: h.content,
        })),
        { role: "user", content: prompt },
      ];

      const cRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          system: systemPromptCompleto,
          messages,
          max_tokens: 800,
        }),
      });

      const cData = await cRes.json();
      if (cData.error) throw new Error(cData.error.message || "Error en Anthropic API");

      return jsonResponse({
        ok: true,
        reply: cData.content?.[0]?.text || "Sin respuesta.",
        model: "azyvion-claude",
        role: userRole,
      });
    }

    // ── 4. Motor de Respuestas Asistidas Nativas Azyvion (Fallback inteligente si no hay clave LLM en Supabase Secrets) ──
    const pLower = prompt.toLowerCase();
    let respuestaFallback = "";

    if (pLower.includes("pos") || pLower.includes("cobrar") || pLower.includes("caja") || pLower.includes("ticket")) {
      respuestaFallback = `En el **Punto de Venta (POS)** de AZYVION puedes:
• **Aperturar turno de caja:** Ingresa el monto inicial en efectivo para comenzar la jornada.
• **Cobrar en mostrador:** Busca productos por nombre o SKU, selecciona la lista de precio del cliente y elige el método (Efectivo con cálculo de cambio, Tarjeta o Transferencia).
• **Cobrar cotizaciones aprobadas:** Usa el botón de cobro rápido para pasar una cotización a ticket en 1 clic.
• **Cierre de caja:** Al finalizar el día, realiza el arqueo de efectivo para registrar el cierre con sus diferencias.`;
    } else if (pLower.includes("cotiz") || pLower.includes("precio") || pLower.includes("iva")) {
      respuestaFallback = `Para las **Cotizaciones en CRM AZYVION**:
• Los productos vienen directamente del catálogo con su descripción y precio unitario protegidos para mantener la exactitud de precios.
• El IVA se calcula automáticamente según la configuración de tu empresa (modalidad con IVA incluido o sobre el subtotal).
• Al terminar de agregar ítems, el sistema te muestra una **Vista previa interactiva** para verificar el desglose antes de guardar.
• Recuerda que solo los administradores pueden editar o eliminar cotizaciones ya emitidas.`;
    } else if (pLower.includes("cliente") || pLower.includes("nit") || pLower.includes("registro")) {
      respuestaFallback = `Para registrar un **Nuevo Cliente** en AZYVION:
• Son obligatorios: Razón Social, NIT, Teléfono General, Dirección, Ciudad, País y Fuente/Origen.
• Puedes asignarle una lista de precio (**Público**, **Plata** u **Oro**) para que el POS y las cotizaciones apliquen sus tarifas preferenciales en automático.`;
    } else if (pLower.includes("inventario") || pLower.includes("producto") || pLower.includes("sku") || pLower.includes("stock")) {
      respuestaFallback = `En el módulo de **Inventario / Producto**:
• Todos los productos están unificados en un catálogo centralizado con filtros por Marca, Línea y Familia.
• El código **SKU es obligatorio** para garantizar el rastreo de inventario.
• Puedes configurar los precios de nivel Público, Plata y Oro, y revisar las alertas de stock crítico para reabastecimiento.`;
    } else if (pLower.includes("encuesta") || pLower.includes("url") || pLower.includes("token")) {
      respuestaFallback = `En el módulo de **Encuestas**:
• Al crear una encuesta se genera automáticamente un **enlace público con token** (\`encuesta.html?token=...\`).
• Puedes compartir este enlace por WhatsApp o correo; los clientes pueden responderla directamente sin necesidad de tener usuario ni iniciar sesión en el CRM.`;
    } else if (!esAdmin && (pLower.includes("ganancia") || pLower.includes("total dinero") || pLower.includes("cartera") || pLower.includes("financiero"))) {
      respuestaFallback = `Hola ${userName}. Por políticas de seguridad y confidencialidad del CRM AZYVION, los reportes financieros globales y balances contables están reservados exclusivamente para los Administradores de la empresa. Con gusto puedo ayudarte con el catálogo, clientes, cotizaciones o el punto de venta.`;
    } else {
      respuestaFallback = `Hola ${userName}. Soy el Asistente IA propio de CRM AZYVION.
Puedo ayudarte en tiempo real con:
• **Punto de Venta (POS):** Cobros, tickets térmicos, turnos y cierres de caja.
• **Cotizaciones:** Reglas de catálogo, modalidades de IVA y vista previa.
• **Clientes & Prospectos:** Requisitos obligatorios y listas de precio (Público, Plata, Oro).
• **Inventario:** Códigos SKU, precios por nivel y alertas de stock crítico.
• **Encuestas públicas y Contabilidad:** Operaciones del sistema.

¿Qué proceso o duda te gustaría que revisemos?`;
    }

    return jsonResponse({
      ok: true,
      reply: respuestaFallback,
      model: "azyvion-native-engine",
      role: userRole,
      nota: "Para activar inferencia generativa profunda, configura GEMINI_API_KEY en los secretos de Supabase Edge Functions.",
    });

  } catch (error: any) {
    console.error("Error en ai-azyvion function:", error);
    return jsonResponse({
      ok: false,
      error: error.message || "Error procesando la solicitud en el asistente IA de AZYVION.",
    }, 500);
  }
});
