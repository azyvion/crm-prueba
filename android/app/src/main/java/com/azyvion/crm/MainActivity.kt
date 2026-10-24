package com.azyvion.crm

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.azyvion.crm.ui.RaizApp
import com.azyvion.crm.ui.theme.AzyvionTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { AzyvionTheme { RaizApp() } }
    }
}
