plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Versión: la pone el CI (número de ejecución); en local queda 1.
val versionCodeCi = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

// Firma de release: solo si el CI recibe la llave (secretos de GitHub). Sin llave se genera el APK de depuración.
val firmaArchivo = System.getenv("ANDROID_KEYSTORE_PATH")?.let { file(it) }?.takeIf { it.exists() }

android {
    namespace = "com.azyvion.crm"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.azyvion.crm"
        minSdk = 26
        targetSdk = 34
        versionCode = versionCodeCi
        versionName = "1.0.$versionCodeCi"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Mismo proyecto y clave pública (anon) que la web. La seguridad la dan la sesión y la RLS.
        buildConfigField("String", "SUPABASE_URL", "\"https://dwtykzporgjjvdustjfq.supabase.co\"")
        buildConfigField(
            "String", "SUPABASE_ANON_KEY",
            "\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3dHlrenBvcmdqanZkdXN0amZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MjM2MjIsImV4cCI6MjEwNTQ5OTYyMn0.0SXLE5HhIjHbHz2k0cgyat9bvCper_sjAiiCrkOSmF8\""
        )
    }

    signingConfigs {
        if (firmaArchivo != null) {
            create("release") {
                storeFile = firmaArchivo
                storeType = "pkcs12"
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "azyvion"
                keyPassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (firmaArchivo != null) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging { resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" } }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.03")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.navigation:navigation-compose:2.8.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Escáner de códigos de barras (cámara)
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
}
