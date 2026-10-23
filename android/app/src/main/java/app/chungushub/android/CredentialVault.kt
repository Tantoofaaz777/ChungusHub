package app.chungushub.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The origin is authenticated too; moving an encrypted credential cannot change its destination. */
object CredentialEnvelope {
    fun seal(cipher: Cipher, origin: String, password: String): String {
        cipher.updateAAD(origin.toByteArray(Charsets.UTF_8))
        val encrypted = cipher.doFinal(password.toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(cipher.iv) + ":" + Base64.getEncoder().encodeToString(encrypted)
    }

    fun iv(envelope: String): ByteArray = Base64.getDecoder().decode(envelope.substringBefore(':'))
    fun open(cipher: Cipher, origin: String, envelope: String): String {
        cipher.updateAAD(origin.toByteArray(Charsets.UTF_8))
        return String(cipher.doFinal(Base64.getDecoder().decode(envelope.substringAfter(':'))), Charsets.UTF_8)
    }
}

class CredentialVault(context: Context, val origin: String) {
    private val id = MessageDigest.getInstance("SHA-256").digest(origin.toByteArray()).joinToString("") { "%02x".format(it) }
    val preferences = context.getSharedPreferences("lock-$id", Context.MODE_PRIVATE)
    private val alias = "chungus-biometric-$id"
    private val store get() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    fun hasCredential() = preferences.contains("credential")

    fun encryption(): Cipher {
        clear()
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
            .build()) // Per-operation biometric authorization on every supported Android version.
        return Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, generator.generateKey()) }
    }

    fun decryption(): Cipher {
        val envelope = preferences.getString("credential", null) ?: error("No saved credential")
        val key = store.getKey(alias, null) as SecretKey
        return Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, CredentialEnvelope.iv(envelope)))
        }
    }

    fun save(cipher: Cipher, password: String) {
        check(preferences.edit().putString("credential", CredentialEnvelope.seal(cipher, origin, password)).commit())
    }
    fun read(cipher: Cipher): String = CredentialEnvelope.open(cipher, origin, preferences.getString("credential", null) ?: error("No saved credential"))
    fun clear() {
        preferences.edit().remove("credential").commit()
        store.let { if (it.containsAlias(alias)) it.deleteEntry(alias) }
    }
}
