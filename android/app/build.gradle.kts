plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
}

val useEmulator = (findProperty("verified.emulator") as String? ?: "false").toBoolean()
val emulatorHost = findProperty("verified.emulatorHost") as String? ?: "10.0.2.2"

// shared/prompts.json is the single source of truth for prompts: copy it into assets at build time.
val copySharedAssets by tasks.registering(Copy::class) {
    from(rootProject.file("../shared/prompts.json"))
    into(layout.buildDirectory.dir("generated/sharedAssets"))
}

android {
    namespace = "com.mattricks.verified"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.mattricks.verified"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("boolean", "USE_EMULATOR", useEmulator.toString())
        buildConfigField("String", "EMULATOR_HOST", "\"$emulatorHost\"")
        buildConfigField("String", "DEFAULT_CLOUD_MODEL", "\"gemini-3.5-flash\"")
        // Sign-in: accounts.mattrickslauer.com (OIDC + PKCE via AppAuth), then a Firebase custom token.
        buildConfigField("String", "ACCOUNTS_ISSUER", "\"https://accounts.mattrickslauer.com/t/mattricks\"")
        buildConfigField("String", "ACCOUNTS_CLIENT_ID", "\"verified-app\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Hackathon: sign release with the debug key so it installs on a phone.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/sharedAssets"))

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    jvmToolchain(17)
}

tasks.named("preBuild") { dependsOn(copySharedAssets) }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.05.01")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")

    // Firebase
    implementation(platform("com.google.firebase:firebase-bom:35.2.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
    implementation("com.google.firebase:firebase-config")
    implementation("com.google.firebase:firebase-ai")
    // On-device SDK is not in the BoM yet (Firebase docs, hybrid/android/get-started)
    implementation("com.google.firebase:firebase-ai-ondevice:16.0.0-beta08")
    implementation("com.google.firebase:firebase-appcheck-debug")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")

    // Sign-in through accounts.mattrickslauer.com (Custom Tab, OIDC code + PKCE, loopback redirect)
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.lifecycle:lifecycle-process:2.9.1")

    // Sensors
    implementation("com.google.android.gms:play-services-location:21.3.0")
    val camerax = "1.4.2"
    implementation("androidx.camera:camera-camera2:$camerax")
    implementation("androidx.camera:camera-lifecycle:$camerax")
    implementation("androidx.camera:camera-view:$camerax")
    implementation("com.google.guava:guava:33.4.8-android") // ListenableFuture for CameraX provider

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
