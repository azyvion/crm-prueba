package com.azyvion.crm.ui.inicio

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.azyvion.crm.data.MiLicencia
import com.azyvion.crm.data.Sesion
import com.azyvion.crm.domain.Calc
import com.azyvion.crm.domain.Embudo
import com.azyvion.crm.domain.hoyGT
import com.azyvion.crm.ui.common.Contenido
import com.azyvion.crm.ui.common.Etiqueta
import com.azyvion.crm.ui.common.PaddingLista
import com.azyvion.crm.ui.common.Tarjeta
import com.azyvion.crm.ui.common.Titulo
import com.azyvion.crm.ui.common.app
import com.azyvion.crm.ui.common.colorPrioridad
import com.azyvion.crm.ui.common.rememberCarga
import com.azyvion.crm.ui.irPestana
import com.azyvion.crm.ui.licencia.avisoVencimiento
import com.azyvion.crm.ui.theme.Ambar
import com.azyvion.crm.ui.theme.Rojo
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

private data class Resumen(val tareasHoy: Int, val vencidas: Int, val proximas: List<com.azyvion.crm.data.Tarea>, val ponderado: Double?, val abiertas: Int?, val clientes: Int?)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InicioScreen(nav: NavController, s: Sesion, lic: MiLicencia?) {
    val a = app()
    val c = rememberCarga {
        coroutineScope {
            val t = async { runCatching { a.repo.tareas(soloMias = true, completadas = false) }.getOrDefault(emptyList()) }
            val p = async { if (s.puede("prospectos")) runCatching { a.repo.prospectos().also { a.cache.prospectos = it } }.getOrNull() else null }
            val cl = async { if (s.puede("clientes")) runCatching { a.repo.clientes().also { a.cache.clientes = it } }.getOrNull() else null }
            val hoy = hoyGT().toString()
            val tareas = t.await()
            val pros = p.await()
            val abiertas = pros?.filter { Embudo.esAbierto(it.etapa) }
            Resumen(
                tareasHoy = tareas.count { it.fechaSeguimiento == hoy }, vencidas = tareas.count { it.fechaSeguimiento < hoy },
                proximas = tareas.take(5), ponderado = abiertas?.sumOf { Embudo.ponderado(it.valorEstimado, it.probabilidad) },
                abiertas = abiertas?.size, clientes = cl.await()?.size,
            )
        }
    }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Column { Text("Hola, ${s.nombre.substringBefore(' ')}", fontWeight = FontWeight.Bold); Text(lic?.plan?.takeIf { it.isNotBlank() }?.let { "Plan $it" } ?: "Azyvion CRM", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) } },
            actions = { IconButton(onClick = { c.recargar() }) { Icon(Icons.Default.Refresh, "Actualizar") } },
        )
        avisoVencimiento(lic)?.let { aviso ->
            Surface(color = Ambar.copy(alpha = 0.15f), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Warning, null, tint = Ambar); Spacer(Modifier.padding(4.dp)); Text(aviso, fontSize = 13.sp)
                }
            }
        }
        Contenido(c) { r ->
            LazyColumn(contentPadding = PaddingLista, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Kpi("Tareas de hoy", r.tareasHoy.toString(), Modifier.weight(1f)) { irPestana(nav, "tareas") }
                        Kpi("Vencidas", r.vencidas.toString(), Modifier.weight(1f), if (r.vencidas > 0) Rojo else null) { irPestana(nav, "tareas") }
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (r.ponderado != null) Kpi("Embudo ponderado", Calc.qEntero(r.ponderado), Modifier.weight(1f), sub = "${r.abiertas} oportunidades") { nav.navigate("embudo") }
                        if (r.clientes != null) Kpi("Clientes", r.clientes.toString(), Modifier.weight(1f)) { irPestana(nav, "clientes") }
                    }
                }
                item { Titulo("Próximas tareas", Modifier.padding(top = 8.dp)) }
                if (r.proximas.isEmpty()) item { Text("No tienes tareas pendientes. 🎉", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                r.proximas.forEach { t ->
                    item {
                        Tarjeta(onClick = { irPestana(nav, "tareas") }) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(t.titulo, fontWeight = FontWeight.SemiBold)
                                    Text(listOfNotNull(com.azyvion.crm.ui.common.fechaCorta(t.fechaSeguimiento), t.hora.ifBlank { null }, t.refNombre.ifBlank { null }).joinToString(" · "),
                                        fontSize = 13.sp, color = if (t.fechaSeguimiento < hoyGT().toString()) Rojo else MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Etiqueta(t.prioridad, colorPrioridad(t.prioridad))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Kpi(titulo: String, valor: String, modifier: Modifier, color: androidx.compose.ui.graphics.Color? = null, sub: String? = null, onClick: () -> Unit) {
    Tarjeta(modifier, onClick = onClick) {
        Text(titulo, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(4.dp))
        Text(valor, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = color ?: MaterialTheme.colorScheme.onSurface)
        sub?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
