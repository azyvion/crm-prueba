package com.azyvion.crm.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.PointOfSale
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.azyvion.crm.data.MiLicencia
import com.azyvion.crm.data.Sesion
import com.azyvion.crm.ui.clientes.ClienteFormScreen
import com.azyvion.crm.ui.clientes.ClientesScreen
import com.azyvion.crm.ui.clientes.FichaScreen
import com.azyvion.crm.ui.common.app
import com.azyvion.crm.ui.cotizaciones.CotizacionDetalleScreen
import com.azyvion.crm.ui.cotizaciones.CotizacionNuevaScreen
import com.azyvion.crm.ui.cotizaciones.CotizacionesScreen
import com.azyvion.crm.ui.inicio.InicioScreen
import com.azyvion.crm.ui.inventario.InventarioScreen
import com.azyvion.crm.ui.licencia.BloqueoScreen
import com.azyvion.crm.ui.login.LoginScreen
import com.azyvion.crm.ui.mas.MasScreen
import com.azyvion.crm.ui.pos.PosScreen
import com.azyvion.crm.ui.prospectos.EmbudoScreen
import com.azyvion.crm.ui.prospectos.ProspectoFormScreen
import com.azyvion.crm.ui.tareas.TareasScreen

/** Raíz: sin sesión → login; con sesión → verifica la licencia y abre la app. */
@Composable
fun RaizApp() {
    val a = app()
    val sesion by a.sesiones.actual.collectAsState()
    val s = sesion
    if (s == null) { a.cache.limpiar(); LoginScreen(); return }

    // La licencia se verifica en el servidor al entrar (y el servidor igual niega los datos sin licencia).
    var licencia by remember(s.usuario) { mutableStateOf<MiLicencia?>(null) }
    var verificada by remember(s.usuario) { mutableStateOf(false) }
    LaunchedEffect(s.usuario, verificada) {
        if (!verificada) {
            licencia = runCatching { a.repo.miLicencia() }.getOrNull()
            verificada = true
        }
    }
    val lic = licencia
    when {
        !verificada -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
        lic != null && !lic.vigente -> BloqueoScreen(lic, alActivar = { licencia = it })
        else -> AppPrincipal(s, lic)
    }
}

private data class Pestana(val ruta: String, val texto: String, val icono: ImageVector, val modulo: String?)

@Composable
private fun AppPrincipal(s: Sesion, lic: MiLicencia?) {
    val nav = rememberNavController()
    val pestanas = listOf(
        Pestana("inicio", "Inicio", Icons.Default.Home, null),
        Pestana("clientes", "Clientes", Icons.Default.People, "clientes"),
        Pestana("tareas", "Tareas", Icons.Default.TaskAlt, null),
        Pestana("pos", "Vender", Icons.Default.PointOfSale, "pos"),
        Pestana("mas", "Más", Icons.Default.MoreHoriz, null),
    ).filter { it.modulo == null || s.puede(it.modulo) }
    val actual by nav.currentBackStackEntryAsState()
    val ruta = actual?.destination?.route
    val enPestana = pestanas.any { it.ruta == ruta }

    Scaffold(bottomBar = {
        if (enPestana) NavigationBar {
            pestanas.forEach { p ->
                NavigationBarItem(
                    selected = ruta == p.ruta, label = { Text(p.texto) }, icon = { Icon(p.icono, p.texto) },
                    onClick = { irPestana(nav, p.ruta) },
                )
            }
        }
    }) { pad ->
        NavHost(nav, startDestination = "inicio", modifier = Modifier.padding(bottom = if (enPestana) pad.calculateBottomPadding() else androidx.compose.ui.unit.Dp.Hairline)) {
            composable("inicio") { InicioScreen(nav, s, lic) }
            composable("clientes") { ClientesScreen(nav, s) }
            composable("tareas") { TareasScreen(nav) }
            composable("pos") { PosScreen(nav, lic) }
            composable("mas") { MasScreen(nav, s, lic) }
            composable("embudo") { EmbudoScreen(nav) }
            composable("inventario") { InventarioScreen(nav) }
            composable("cotizaciones") { CotizacionesScreen(nav) }
            composable("cotizacionNueva") { CotizacionNuevaScreen(nav) }
            composable("cotizacion/{id}", listOf(navArgument("id") { type = NavType.StringType })) {
                CotizacionDetalleScreen(nav, it.arguments?.getString("id").orEmpty())
            }
            composable("ficha/{tipo}/{id}", listOf(navArgument("tipo") { type = NavType.StringType }, navArgument("id") { type = NavType.StringType })) {
                FichaScreen(nav, it.arguments?.getString("tipo").orEmpty(), it.arguments?.getString("id").orEmpty())
            }
            composable("clienteForm?id={id}", listOf(navArgument("id") { type = NavType.StringType; nullable = true; defaultValue = null })) {
                ClienteFormScreen(nav, it.arguments?.getString("id"))
            }
            composable("prospectoForm?id={id}", listOf(navArgument("id") { type = NavType.StringType; nullable = true; defaultValue = null })) {
                ProspectoFormScreen(nav, it.arguments?.getString("id"))
            }
        }
    }
}

fun irPestana(nav: androidx.navigation.NavController, ruta: String) {
    nav.navigate(ruta) {
        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
