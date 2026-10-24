package com.azyvion.crm.ui.clientes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.azyvion.crm.data.Sesion
import com.azyvion.crm.domain.Calc
import com.azyvion.crm.domain.Embudo
import com.azyvion.crm.domain.hoyGT
import com.azyvion.crm.ui.common.Avatar
import com.azyvion.crm.ui.common.Buscador
import com.azyvion.crm.ui.common.Contenido
import com.azyvion.crm.ui.common.Etiqueta
import com.azyvion.crm.ui.common.PaddingLista
import com.azyvion.crm.ui.common.Tarjeta
import com.azyvion.crm.ui.common.Vacio
import com.azyvion.crm.ui.common.app
import com.azyvion.crm.ui.common.colorEtapa
import com.azyvion.crm.ui.common.fechaCorta
import com.azyvion.crm.ui.common.rememberCarga
import com.azyvion.crm.ui.theme.Rojo

/** Clientes y prospectos en pestañas (los vendedores solo ven sus clientes). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClientesScreen(nav: NavController, s: Sesion) {
    val verProspectos = s.puede("prospectos")
    var pestana by rememberSaveable { mutableIntStateOf(0) }
    Scaffold(
        topBar = {
            Column {
                TopAppBar(title = { Text(if (pestana == 0) "Clientes" else "Prospectos", fontWeight = FontWeight.Bold) },
                    actions = { if (pestana == 1) IconButton(onClick = { nav.navigate("embudo") }) { Icon(Icons.Default.Insights, "Embudo y pronóstico") } })
                if (verProspectos) TabRow(selectedTabIndex = pestana) {
                    Tab(pestana == 0, { pestana = 0 }, text = { Text("Clientes") })
                    Tab(pestana == 1, { pestana = 1 }, text = { Text("Prospectos") })
                }
            }
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { nav.navigate(if (pestana == 0) "clienteForm" else "prospectoForm") },
                icon = { Icon(Icons.Default.Add, null) }, text = { Text(if (pestana == 0) "Cliente" else "Prospecto") },
            )
        },
    ) { pad ->
        Column(Modifier.padding(pad)) {
            if (pestana == 0) ListaClientes(nav) else ListaProspectos(nav)
        }
    }
}

@Composable
private fun ListaClientes(nav: NavController) {
    val a = app()
    val c = rememberCarga { a.repo.clientes().also { a.cache.clientes = it } }
    var q by rememberSaveable { mutableStateOf("") }
    Buscador(q, { q = it }, "Buscar por nombre, NIT o teléfono", extra = { IconButton(onClick = { c.recargar() }) { Icon(Icons.Default.Refresh, "Actualizar") } })
    Contenido(c) { lista ->
        val t = q.trim().lowercase()
        val filtrados = if (t.isEmpty()) lista else lista.filter { x ->
            listOf(x.nombre, x.empresa, x.nit, x.telefono, x.correo).any { it.lowercase().contains(t) }
        }
        LazyColumn(contentPadding = PaddingLista, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Text("${filtrados.size} de ${lista.size} clientes", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (filtrados.isEmpty()) item { Vacio(if (lista.isEmpty()) "Aún no hay clientes. Crea el primero con el botón +." else "Sin resultados para «$q».") }
            items(filtrados, key = { it.id }) { x ->
                Tarjeta(onClick = { nav.navigate("ficha/Cliente/${x.id}") }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(x.nombre)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(x.nombre, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(listOf(x.empresa, x.telefono).filter { it.isNotBlank() }.joinToString(" · "), fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        if (x.listaPrecio != "Publico") Etiqueta(x.listaPrecio, MaterialTheme.colorScheme.tertiary)
                    }
                }
            }
        }
    }
}

@Composable
private fun ListaProspectos(nav: NavController) {
    val a = app()
    val c = rememberCarga { a.repo.prospectos().also { a.cache.prospectos = it } }
    var q by rememberSaveable { mutableStateOf("") }
    var filtro by rememberSaveable { mutableStateOf("Abiertos") }
    Buscador(q, { q = it }, "Buscar prospecto", extra = { IconButton(onClick = { c.recargar() }) { Icon(Icons.Default.Refresh, "Actualizar") } })
    val filtros = listOf("Abiertos", "Vencidos") + Embudo.ETAPAS
    LazyRow(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(filtros) { f -> FilterChip(selected = filtro == f, onClick = { filtro = f }, label = { Text(f) }) }
    }
    Contenido(c) { lista ->
        val hoy = hoyGT()
        val t = q.trim().lowercase()
        val filtrados = lista.filter { p ->
            when (filtro) {
                "Abiertos" -> Embudo.esAbierto(p.etapa)
                "Vencidos" -> Embudo.estaVencido(p.etapa, p.fechaCierreEstimada, hoy)
                else -> p.etapa == filtro
            } && (t.isEmpty() || listOf(p.nombre, p.empresa, p.telefono, p.correo).any { it.lowercase().contains(t) })
        }.sortedByDescending { it.valorEstimado }
        LazyColumn(contentPadding = PaddingLista, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Text("${filtrados.size} prospectos · ${Calc.qEntero(filtrados.sumOf { it.valorEstimado })} · ponderado ${Calc.qEntero(filtrados.sumOf { Embudo.ponderado(it.valorEstimado, it.probabilidad) })}",
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
            }
            if (filtrados.isEmpty()) item { Vacio("Sin prospectos con este filtro.") }
            items(filtrados, key = { it.id }) { p ->
                Tarjeta(onClick = { nav.navigate("ficha/Prospecto/${p.id}") }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(p.nombre, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(p.empresa, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                            val venc = Embudo.estaVencido(p.etapa, p.fechaCierreEstimada, hoy)
                            val cierre = when {
                                p.etapa == "Perdido" && p.motivoPerdida.isNotBlank() -> p.motivoPerdida
                                p.fechaCierreEstimada.isNotBlank() -> "Cierre ${fechaCorta(p.fechaCierreEstimada)}" + if (venc) " · vencido" else ""
                                else -> ""
                            }
                            if (cierre.isNotBlank()) Text(cierre, fontSize = 12.sp, color = if (venc) Rojo else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Etiqueta(p.etapa, colorEtapa(p.etapa))
                            Text(Calc.qEntero(p.valorEstimado), fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp))
                            Text("${p.probabilidad.toInt()}%", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}
