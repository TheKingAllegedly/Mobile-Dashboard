plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.levi.dashboard"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.levi.dashboard"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            // Unsigned by default; CI signs with a debug key so the APK is
            // installable straight from a GitHub Actions run.
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
    }
}

/*
 * The dashboard itself lives in /web at the repository root and is the single
 * source of truth. Copy it into the APK so the app works with no server.
 */
val copyWebApp = tasks.register<Copy>("copyWebApp") {
    from(rootProject.file("../web"))
    into(layout.buildDirectory.dir("generated/webAssets/web"))
    exclude("**/.DS_Store")
}

android.sourceSets["main"].assets.srcDir(
    layout.buildDirectory.dir("generated/webAssets").get().asFile
)

tasks.matching { it.name.startsWith("merge") && it.name.contains("Assets") }
    .configureEach { dependsOn(copyWebApp) }
tasks.matching { it.name == "preBuild" }.configureEach { dependsOn(copyWebApp) }

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.material)
}
