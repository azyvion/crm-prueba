package com.azyvion.crm.ui.common

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.azyvion.crm.AzyvionApp
import com.azyvion.crm.ui.theme.Ambar
import com.azyvion.crm.ui.theme.Azul
import com.azyvion.crm.ui.theme.Rojo
import com.azyvion.crm.ui.theme.Verde

@Composable fun app(): AzyvionApp = LocalContext.current.applicationContext as AzyvionApp

/** Datos que se cargan de forma asíncrona, con estado de carga, error y recarga. */
@Stable
class Carga<T> {
    var datos by mutableStateOf<T?>(null)
    var error by mutableStateOf<String?>(null)
    var cargando by mutableStateOf(true)
    internal var version by mutableIntStateOf(0)
    fun recargar() { version++ }
}

@Composable
fun <T> rememberCarga(vararg claves: Any?, cargar: suspend () -> T): Carga<T> {
    val c = remember(*claves) { Carga<T>() }
    LaunchedEffect(c.version, *claves) {
        c.cargando = true; c.error = null
        try { c.datos = cargar() } catch (e: Exception) { c.error = e.message ?: "Error inesperado." }
        c.cargando = false
    }
    return c
}

/** Muestra carga / error / contenido. */
@Composable
fun <T> Contenido(c: Carga<T>, contenido: @Composable (T) -> Unit) {
    val d = c.datos
    when {
        d != null -> contenido(d)
        c.cargando -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
        else -> ErrorBox(c.error ?: "No se pudo cargar.") { c.recargar() }
    }
}

@Composable
fun ErrorBox(mensaje: String, reintentar: (() -> Unit)? = null) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Default.ErrorOutline, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(40.dp))
        Spacer(Modifier.height(12.dp))
        Text(mensaje, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (reintentar != null) { Spacer(Modifier.height(16.dp)); OutlinedButton(onClick = reintentar) { Text("Reintentar") } }
    }
}

@Composable
fun Vacio(texto: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(40.dp), Alignment.Center) {
        Text(texto, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}

@Composable
fun Buscador(valor: String, onCambio: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, extra: @Composable (() -> Unit)? = null) {
    OutlinedTextField(
        value = valor, onValueChange = onCambio, singleLine = true,
        placeholder = { Text(placeholder) }, leadingIcon = { Icon(Icons.Default.Search, null) },
        trailingIcon = {
            Row {
                if (valor.isNotEmpty()) IconButton(onClick = { onCambio("") }) { Icon(Icons.Default.Clear, "Borrar") }
                extra?.invoke()
            }
        },
        shape = RoundedCornerShape(14.dp),
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
fun Tarjeta(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, contenido: @Composable () -> Unit) {
    val colores = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    val borde = CardDefaults.outlinedCardBorder()
    val m = modifier.fillMaxWidth()
    if (onClick != null) Card(onClick = onClick, modifier = m, colors = colores, border = borde, shape = RoundedCornerShape(14.dp)) { Column(Modifier.padding(14.dp)) { contenido() } }
    else Card(modifier = m, colors = colores, border = borde, shape = RoundedCornerShape(14.dp)) { Column(Modifier.padding(14.dp)) { contenido() } }
}

@Composable
fun Etiqueta(texto: String, color: Color) {
    Surface(color = color.copy(alpha = 0.14f), shape = RoundedCornerShape(50)) {
        Text(texto, color = color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

fun colorEtapa(e: String): Color = when (e) {
    "Nuevo" -> Color(0xFF8E8E93); "Contactado" -> Color(0xFF0A84FF); "Calificado" -> Color(0xFF14B8A6)
    "Propuesta" -> Color(0xFFBF5AF2); "Negociación" -> Color(0xFFFF9F0A); "Ganado" -> Verde; "Perdido" -> Rojo
    else -> Color.Gray
}
fun colorEstadoCot(e: String): Color = when (e) { "Aprobada" -> Verde; "Rechazada", "Vencida" -> Rojo; "Enviada" -> Azul; else -> Color(0xFF8E8E93) }
fun colorPrioridad(p: String): Color = when (p) { "Alta" -> Rojo; "Baja" -> Color(0xFF8E8E93); else -> Ambar }

@Composable
fun Avatar(nombre: String, color: Color = Azul) {
    val ini = nombre.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "?" }
    Box(Modifier.size(40.dp).background(color.copy(alpha = 0.15f), CircleShape), Alignment.Center) {
        Text(ini, color = color, fontWeight = FontWeight.Bold, fontSize = 14.sp)
    }
}

@Composable
fun Titulo(texto: String, modifier: Modifier = Modifier) =
    Text(texto, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = modifier)

@Composable
fun Dato(etiqueta: String, valor: String) {
    if (valor.isBlank()) return
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(etiqueta, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(110.dp), fontSize = 13.sp)
        Text(valor, fontSize = 14.sp, modifier = Modifier.weight(1f), maxLines = 3, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun BotonPrincipal(texto: String, onClick: () -> Unit, modifier: Modifier = Modifier, ocupado: Boolean = false, habilitado: Boolean = true) {
    Button(onClick = onClick, enabled = habilitado && !ocupado, modifier = modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(12.dp)) {
        if (ocupado) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
        else Text(texto, fontWeight = FontWeight.SemiBold)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Selector(etiqueta: String, opciones: List<String>, valor: String, onCambio: (String) -> Unit, modifier: Modifier = Modifier) {
    var abierto by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = abierto, onExpandedChange = { abierto = it }, modifier = modifier) {
        OutlinedTextField(
            value = valor, onValueChange = {}, readOnly = true, label = { Text(etiqueta) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(abierto) },
            modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = abierto, onDismissRequest = { abierto = false }) {
            opciones.forEach { o -> DropdownMenuItem(text = { Text(o) }, onClick = { onCambio(o); abierto = false }) }
        }
    }
}

@Composable
fun Campo(etiqueta: String, valor: String, onCambio: (String) -> Unit, modifier: Modifier = Modifier, teclado: androidx.compose.ui.text.input.KeyboardType = androidx.compose.ui.text.input.KeyboardType.Text, lineas: Int = 1) {
    OutlinedTextField(
        value = valor, onValueChange = onCambio, label = { Text(etiqueta) }, singleLine = lineas == 1, minLines = lineas,
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = teclado),
        modifier = modifier.fillMaxWidth().padding(vertical = 4.dp),
    )
}

val PaddingLista = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 96.dp)

// ── Contacto de ventas (licencias) ──
const val VENTAS_TELEFONO = "+502 5145 5610"
const val VENTAS_CORREO = "ventas@azyvion.com"

@Composable
fun ContactoVentas(titulo: String, mensaje: String) {
    val ctx = LocalContext.current
    Tarjeta {
        Text(titulo, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Spacer(Modifier.height(4.dp))
        Text(mensaje, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = { abrirWhatsApp(ctx, VENTAS_TELEFONO, "Hola, necesito una licencia de Azyvion CRM.") }, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Default.Phone, null); Spacer(Modifier.width(8.dp)); Text("$VENTAS_TELEFONO · WhatsApp")
        }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = { enviarCorreo(ctx, VENTAS_CORREO, "Licencia Azyvion CRM", "Hola, necesito una licencia de Azyvion CRM.") }, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Default.Email, null); Spacer(Modifier.width(8.dp)); Text(VENTAS_CORREO)
        }
    }
}

// ── Acciones del teléfono ──
fun soloDigitos(t: String) = t.filter { it.isDigit() }

/** Número para WhatsApp: si tiene 8 dígitos se asume Guatemala (+502). */
fun numeroWhatsApp(t: String): String {
    val d = soloDigitos(t)
    return if (d.length == 8) "502$d" else d
}

fun abrirWhatsApp(ctx: Context, telefono: String, texto: String = "") {
    val n = numeroWhatsApp(telefono)
    if (n.isEmpty()) { toast(ctx, "No hay teléfono registrado."); return }
    abrir(ctx, Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$n?text=" + Uri.encode(texto))))
}

fun llamar(ctx: Context, telefono: String) {
    if (soloDigitos(telefono).isEmpty()) { toast(ctx, "No hay teléfono registrado."); return }
    abrir(ctx, Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + telefono.filter { it.isDigit() || it == '+' })))
}

fun enviarCorreo(ctx: Context, correo: String, asunto: String = "", cuerpo: String = "") {
    if (!correo.contains("@")) { toast(ctx, "No hay correo registrado."); return }
    abrir(ctx, Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$correo?subject=" + Uri.encode(asunto) + "&body=" + Uri.encode(cuerpo))))
}

fun compartirTexto(ctx: Context, texto: String, titulo: String = "Compartir") {
    val i = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, texto) }
    abrir(ctx, Intent.createChooser(i, titulo))
}

private fun abrir(ctx: Context, i: Intent) {
    try { ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) { toast(ctx, "No hay una app para abrir esto.") }
}

fun toast(ctx: Context, m: String) = Toast.makeText(ctx, m, Toast.LENGTH_LONG).show()

/** "2026-10-23" o ISO → "23/10/2026". */
fun fechaCorta(iso: String): String {
    val f = iso.take(10)
    return if (Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(f)) "${f.substring(8, 10)}/${f.substring(5, 7)}/${f.substring(0, 4)}" else iso
}
