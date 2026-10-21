plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

android {
    namespace = "app.chungushub.android"
    compileSdk = 36
    defaultConfig {
        applicationId = "app.chungushub.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "0.1.2"
    }
    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildTypes { release { isMinifyEnabled = false } }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.14.0")
    testImplementation("junit:junit:4.13.2")
}
