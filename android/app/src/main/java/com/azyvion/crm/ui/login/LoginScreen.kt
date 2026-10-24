package com.azyvion.crm.ui.login

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.azyvion.crm.R
import com.azyvion.crm.data.ResultadoLogin
import com.azyvion.crm.ui.common.BotonPrincipal
import com.azyvion.crm.ui.common.ContactoVentas
import com.azyvion.crm.ui.common.app
import kotlinx.coroutines.launch

@Composable
fun LoginScreen() {
    val a = app()
    val scope = rememberCoroutineScope()
    var usuario by remember { mutableStateOf(a.sesiones.ultimoUsuario) }
    var clave by remember { mutableStateOf("") }
    var ver by remember { mutableStateOf(false) }
    var ocupado by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sinLicencia by remember { mutableStateOf<ResultadoLogin.SinLicencia?>(null) }

    fun entrar() {
        if (usuario.isBlank() || clave.isEmpty()) { error = "Ingresa tu correo y contraseña."; return }
        ocupado = true; error = null; sinLicencia = null
        scope.launch {
            try {
                when (val r = a.repo.login(usuario, clave)) {
                    ResultadoLogin.Ok -> Unit                       // RaizApp cambia de pantalla sola
                    // Administrador: entra a la pantalla de bloqueo, que permite activar una licencia
                    is ResultadoLogin.SinLicencia -> if (r.sesionPendiente != null) a.repo.usarSesion(r.sesionPendiente) else sinLicencia = r
                    is ResultadoLogin.Error -> error = r.mensaje
                }
            } catch (e: Exception) { error = e.message }
            ocupado = false
        }
    }

    Column(
        Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(24.dp))
        Image(painterResource(R.mipmap.ic_launcher), null, Modifier.size(84.dp))
        Spacer(Modifier.height(12.dp))
        Text("Azyvion CRM", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        Text("Inicia sesión para continuar", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(
            value = usuario, onValueChange = { usuario = it }, label = { Text("Correo electrónico") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = clave, onValueChange = { clave = it }, label = { Text("Contraseña") }, singleLine = true,
            visualTransformation = if (ver) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = { IconButton(onClick = { ver = !ver }) { Icon(if (ver) Icons.Default.VisibilityOff else Icons.Default.Visibility, "Mostrar") } },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { entrar() }),
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Spacer(Modifier.height(10.dp)); Text(it, color = MaterialTheme.colorScheme.error) }
        Spacer(Modifier.height(20.dp))
        BotonPrincipal("Iniciar sesión", { entrar() }, ocupado = ocupado)

        sinLicencia?.let { sl ->
            Spacer(Modifier.height(20.dp))
            ContactoVentas("Sin licencia vigente", sl.mensaje + " Contáctanos:")
        }
        Spacer(Modifier.height(24.dp))
    }
}

