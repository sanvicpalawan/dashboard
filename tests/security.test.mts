import { test } from "node:test";
import assert from "node:assert/strict";

process.env.CREDENTIAL_ENCRYPTION_KEY = "unit-test-key-32-bytes-minimum-value";
delete process.env.AUTH_SECRET;

const { encryptSecret, decryptSecret, secretHint, safeExternalUrl, hashPassword, verifyPassword } = await import("../src/lib/security.ts");

test("credentials round-trip through AES-256-GCM", () => {
  const value = "example-token-value-0123456789";
  const sealed = encryptSecret(value);
  assert.notEqual(sealed, value);
  assert.ok(sealed.startsWith("v1."));
  assert.equal(sealed.includes(value), false);
  assert.equal(decryptSecret(sealed), value);
});

test("sealed credentials are unique per write and never reused", () => {
  const first = encryptSecret("same-value");
  const second = encryptSecret("same-value");
  assert.notEqual(first, second);
  assert.equal(decryptSecret(first), decryptSecret(second));
});

test("tampered ciphertext is rejected instead of returning garbage", () => {
  const sealed = encryptSecret("secret-value");
  const parts = sealed.split(".");
  const payload = Buffer.from(parts[3], "base64url");
  payload[0] = payload[0] ^ 0xff;
  parts[3] = payload.toString("base64url");
  assert.throws(() => decryptSecret(parts.join(".")));
});

test("the invalid-format case fails with a reconnect instruction", () => {
  assert.throws(() => decryptSecret("not-a-sealed-value"), /Reconnect this integration/);
  assert.equal(decryptSecret(null), null);
});

test("credential hints never expose more than four trailing characters", () => {
  const hint = secretHint("example-token-abcd1234");
  assert.equal(hint, "••••1234");
});

test("passwords are salted, verifiable and reject wrong input", () => {
  const stored = hashPassword("correct horse battery staple");
  assert.ok(stored.startsWith("scrypt:"));
  assert.ok(!stored.includes("correct horse"));
  assert.equal(verifyPassword("correct horse battery staple", stored), true);
  assert.equal(verifyPassword("wrong", stored), false);
  assert.equal(verifyPassword("", "garbage"), false);
});

test("cloud metadata and private destinations are blocked", () => {
  for (const url of [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:3000/",
    "http://10.0.0.5/",
    "http://192.168.1.10/",
    "http://172.16.0.1/",
    "http://localhost:3100/",
    "http://metadata.google.internal/",
  ]) {
    assert.throws(() => safeExternalUrl(url), /publicly routable|allowlist/, url);
  }
});

test("public https destinations and non-http protocols are handled", () => {
  assert.equal(safeExternalUrl("https://api.github.com/").hostname, "api.github.com");
  assert.throws(() => safeExternalUrl("file:///etc/passwd"), /HTTP/);
});

test("production refuses the demo fallback encryption key", () => {
  const original = process.env.CREDENTIAL_ENCRYPTION_KEY;
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "local-demo-only-not-for-production";
    process.env.NODE_ENV = "production";
    assert.throws(() => encryptSecret("value"), /CREDENTIAL_ENCRYPTION_KEY must be set/);
  } finally {
    process.env.CREDENTIAL_ENCRYPTION_KEY = original;
    process.env.NODE_ENV = originalNodeEnv;
  }
});
