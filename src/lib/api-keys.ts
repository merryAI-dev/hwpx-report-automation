/**
 * API key management with AES-256-GCM encryption.
 *
 * Keys are stored encrypted in the database so they are never
 * persisted as plain text. The encryption key is derived from
 * AUTH_SECRET (which should be a strong random value in production).
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/persistence/client";
import { log } from "@/lib/logger";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/** Derive a 32-byte encryption key from AUTH_SECRET. */
function getEncryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET || "hwpx-dev-secret";
  return createHash("sha256").update(secret).digest();
}

function encrypt(plaintext: string): { encrypted: string; iv: string; authTag: string } {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let enc = cipher.update(plaintext, "utf8", "base64");
  enc += cipher.final("base64");
  return {
    encrypted: enc,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decrypt(encrypted: string, ivB64: string, authTagB64: string): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let dec = decipher.update(encrypted, "base64", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

export type ApiProvider = "anthropic" | "openai";

/**
 * Save an API key for a user+provider, encrypted at rest.
 */
export async function saveApiKey(
  userEmail: string,
  provider: ApiProvider,
  apiKey: string,
): Promise<void> {
  const { encrypted, iv, authTag } = encrypt(apiKey);
  await prisma.apiKeyConfig.upsert({
    where: {
      userEmail_provider: { userEmail, provider },
    },
    update: {
      encryptedKey: encrypted,
      iv,
      authTag,
    },
    create: {
      userEmail,
      provider,
      encryptedKey: encrypted,
      iv,
      authTag,
    },
  });
  log.info("API key saved", { userEmail, provider });
}

/**
 * Retrieve the decrypted API key for a user+provider.
 * Falls back to env vars if no DB key is configured.
 */
export async function getApiKey(
  userEmail: string | null,
  provider: ApiProvider,
): Promise<string | undefined> {
  // Try DB first if user is known
  if (userEmail) {
    try {
      const record = await prisma.apiKeyConfig.findUnique({
        where: {
          userEmail_provider: { userEmail, provider },
        },
      });
      if (record) {
        return decrypt(record.encryptedKey, record.iv, record.authTag);
      }
    } catch (err) {
      log.warn("Failed to read API key from DB, falling back to env", {
        provider,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Fallback to environment variables
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    default:
      return undefined;
  }
}

/**
 * Delete an API key for a user+provider.
 */
export async function deleteApiKey(
  userEmail: string,
  provider: ApiProvider,
): Promise<boolean> {
  try {
    await prisma.apiKeyConfig.delete({
      where: {
        userEmail_provider: { userEmail, provider },
      },
    });
    log.info("API key deleted", { userEmail, provider });
    return true;
  } catch {
    log.warn("API key deletion failed", { userEmail, provider });
    return false;
  }
}

/**
 * Check if a user has a key configured (without decrypting).
 */
export async function hasApiKey(
  userEmail: string,
  provider: ApiProvider,
): Promise<boolean> {
  const count = await prisma.apiKeyConfig.count({
    where: { userEmail, provider },
  });
  return count > 0;
}
