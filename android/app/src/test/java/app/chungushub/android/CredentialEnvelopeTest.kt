package app.chungushub.android

import org.junit.Assert.*
import org.junit.Test
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class CredentialEnvelopeTest {
    private fun key() = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private fun encrypt(key: SecretKey) = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
    private fun decrypt(key: SecretKey, envelope: String) = Cipher.getInstance("AES/GCM/NoPadding").apply {
        init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, CredentialEnvelope.iv(envelope)))
    }

    @Test fun encryptedCredentialRoundTripsWithoutPersistingPlaintext() {
        val key = key()
        val password = "private 密碼 with spaces 🔐"
        val envelope = CredentialEnvelope.seal(encrypt(key), "https://example.com", password)
        assertFalse(envelope.contains(password))
        assertEquals(password, CredentialEnvelope.open(decrypt(key, envelope), "https://example.com", envelope))
    }

    @Test fun credentialCannotBeMovedToAnotherServer() {
        val key = key()
        val envelope = CredentialEnvelope.seal(encrypt(key), "https://example.com", "secret")
        assertThrows(Exception::class.java) { CredentialEnvelope.open(decrypt(key, envelope), "https://other.example.com", envelope) }
    }

    @Test fun alteredCiphertextAndWrongKeysAreRejected() {
        val key = key()
        val envelope = CredentialEnvelope.seal(encrypt(key), "https://example.com", "secret")
        val parts = envelope.split(':')
        val bytes = java.util.Base64.getDecoder().decode(parts[1]); bytes[0] = (bytes[0].toInt() xor 1).toByte()
        val changed = parts[0] + ":" + java.util.Base64.getEncoder().encodeToString(bytes)
        assertThrows(Exception::class.java) { CredentialEnvelope.open(decrypt(key, changed), "https://example.com", changed) }
        assertThrows(Exception::class.java) { CredentialEnvelope.open(decrypt(key(), envelope), "https://example.com", envelope) }
    }
}
