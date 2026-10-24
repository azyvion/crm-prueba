package com.azyvion.crm.ui.mas

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.azyvion.crm.BuildConfig
import com.azyvion.crm.data.MiLicencia
import com.azyvion.crm.data.Sesion
import com.azyvion.crm.ui.common.ContactoVentas
import com.azyvion.crm.ui.common.PaddingLista
import com.azyvion.crm.ui.common.Tarjeta
import com.azyvion.crm.ui.common.app
import com.azyvion.crm.ui.common.fechaCorta

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MasScreen(nav: NavController, s: Sesion, lic: MiLicencia?) {
    val a = app()
    val ctx = LocalContext.current
    var salir by remember { mutableStateOf(false) }
    Column {
        TopAppBar(title = { Text("Más", fontWeight = FontWeight.Bold) })
        LazyColumn(contentPadding = PaddingLista, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Tarjeta {
                    Text(s.nombre, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    Text("${s.usuario} · ${s.rol}", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
                }
            }
            if (s.puede("inventario")) item { Opcion(Icons.Default.Inventory2, "Inventario", "Existencias, precios y escáner") { nav.navigate("inventario") } }
            if (s.puede("cotizaciones")) item { Opcion(Icons.Default.Description, "Cotizaciones", "Crear, enviar por WhatsApp y dar seguimiento") { nav.navigate("cotizaciones") } }
            if (s.puede("prospectos")) item { Opcion(Icons.Default.Insights, "Embudo y pronóstico", "Valor por etapa, cierre por mes y motivos de pérdida") { nav.navigate("embudo") } }
            item {
                Opcion(Icons.Default.Language, "Abrir el CRM completo", "Contabilidad, reportes y configuración en la web") {
                    ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://azyvion.github.io/crm-prueba/login.html")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            }
            item {
                Tarjeta {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.VerifiedUser, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(10.dp))
                        Column {
                            Text("Licencia", fontWeight = FontWeight.SemiBold)
                            val detalle = when {
                                lic == null -> "No se pudo consultar."
                                lic.interna -> "Cuenta interna de Azyvion."
                                else -> listOfNotNull(
                                    lic.plan.ifBlank { null }?.let { "Plan $it" },
                                    if (lic.maxUsuarios > 0) "${lic.usuariosActivos} de ${lic.maxUsuarios} usuarios" else null,
                                    if (lic.venceEn.isBlank()) "Sin vencimiento" else "Vence el ${fechaCorta(lic.venceEn)}",
                                ).joinToString(" · ")
                            }
                            Text(detalle, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            item { ContactoVentas("¿Necesitas ayuda o más usuarios?", "Escríbenos o llámanos:") }
            item { Opcion(Icons.AutoMirrored.Filled.Logout, "Cerrar sesión", null) { salir = true } }
            item { Text("Versión ${BuildConfig.VERSION_NAME}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp)) }
        }
    }
    if (salir) AlertDialog(onDismissRequest = { salir = false }, title = { Text("¿Cerrar sesión?") },
        confirmButton = { TextButton(onClick = { salir = false; a.cache.limpiar(); a.repo.cerrarSesion() }) { Text("Cerrar sesión") } },
        dismissButton = { TextButton(onClick = { salir = false }) { Text("Cancelar") } })
}

@Composable
private fun Opcion(icono: ImageVector, titulo: String, sub: String?, onClick: () -> Unit) {
    Tarjeta(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icono, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(titulo, fontWeight = FontWeight.SemiBold)
                sub?.let { Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null)
        }
    }
}
