import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
    // Screenshot tests of the UI (Robolectric, JVM): ./gradlew :app:recordRoborazziDebug
    id("io.github.takahirom.roborazzi")
}

val useEmulator = (findProperty("verified.emulator") as String? ?: "false").toBoolean()
val appCheckDebugToken = (findProperty("verified.appCheckDebugToken") as String?)
    ?: rootProject.file("local.properties").takeIf { it.exists() }?.readLines()
        ?.firstOrNull { it.startsWith("verified.appCheckDebugToken=") }?.substringAfter("=")?.trim()
    ?: ""
val emulatorHost = findProperty("verified.emulatorHost") as String? ?: "10.0.2.2"

// Mapbox public token (pk.…): -PMAPBOX_ACCESS_TOKEN, ~/.gradle/gradle.properties, env, or android/local.properties.
// Never committed. Without it the app falls back to the offline track sketch.
val mapboxToken: String = (findProperty("MAPBOX_ACCESS_TOKEN") as String?)
    ?: System.getenv("MAPBOX_ACCESS_TOKEN")
    ?: rootProject.file("local.properties").takeIf { it.exists() }?.let { f ->
        Properties().apply { f.inputStream().use { load(it) } }.getProperty("MAPBOX_ACCESS_TOKEN")
    }
    ?: ""

// shared/prompts.json (prompts) and shared/ladder.json (ladder catalog) are the single source of truth: copied into assets.
val copySharedAssets by tasks.registering(Copy::class) {
    from(rootProject.file("../shared/prompts.json"), rootProject.file("../shared/ladder.json"))
    into(layout.buildDirectory.dir("generated/sharedAssets"))
}

android {
    namespace = "com.mattricks.verified"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.mattrickslauer.verified"  // Play listing id; Kotlin namespace stays com.mattricks.verified
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
        buildConfigField("String", "MAPBOX_TOKEN", "\"$mapboxToken\"")
        // Judge builds: one fixed, registered, revocable App Check debug token (verified.appCheckDebugToken in
        // android/local.properties or -P), so every sideloaded install passes App Check. Empty = per-install token.
        buildConfigField("String", "APPCHECK_DEBUG_TOKEN", "\"$appCheckDebugToken\"")
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
        unitTests.isIncludeAndroidResources = true
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
    implementation("com.google.firebase:firebase-functions") // v3 callables: getCredits, runLadderModule
    implementation("com.google.firebase:firebase-storage")   // v3 full_video: clip upload
    // On-device SDK is not in the BoM yet (Firebase docs, hybrid/android/get-started)
    implementation("com.google.firebase:firebase-ai-ondevice:16.0.0-beta08")
    implementation("com.google.firebase:firebase-appcheck-debug")
    implementation("com.google.firebase:firebase-appcheck-playintegrity")
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
    implementation("androidx.camera:camera-video:$camerax")

    // v4.12 shared video: feed autoplay + evidence-room player
    val media3 = "1.8.0"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-ui:$media3")

    // Maps
    val mapbox = "11.24.0"
    implementation("com.mapbox.maps:android-ndk27:$mapbox")
    implementation("com.mapbox.extension:maps-compose-ndk27:$mapbox")
    implementation("com.google.guava:guava:33.4.8-android") // ListenableFuture for CameraX provider

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation(composeBom)
    // UI screenshots (Roborazzi on Robolectric); no device needed.
    testImplementation("org.robolectric:robolectric:4.18.1")
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.79.0")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.79.0")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

// Screenshot output dir for the Roborazzi tests (-Pshots.dir=/abs/path); default app/build/shots.
tasks.withType<Test>().configureEach {
    systemProperty("shots.dir", (findProperty("shots.dir") as String?) ?: layout.buildDirectory.dir("shots").get().asFile.absolutePath)
}
