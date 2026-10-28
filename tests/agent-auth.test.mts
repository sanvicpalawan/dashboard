import { test } from "node:test";
import assert from "node:assert/strict";

// The helpers read the environment per call, so each test sets its own keys.
const { validateAgentToken, validateAgentOrVaultToken, bearerToken } = await import("../src/lib/agent-auth.ts");

function requestWith(authorization?: string) {
  return new Request("http://localhost/api/agent/vault", {
    headers: authorization ? { authorization } : {},
  });
}

test("bearerToken extracts the credential and rejects other schemes", () => {
  assert.equal(bearerToken(requestWith("Bearer abc123")), "abc123");
  assert.equal(bearerToken(requestWith("bearer abc123")), "abc123");
  assert.equal(bearerToken(requestWith("Basic abc123")), null);
  assert.equal(bearerToken(requestWith("Bearer ")), null);
  assert.equal(bearerToken(requestWith()), null);
});

test("AGENT_API_KEY authenticates, a wrong key does not", () => {
  process.env.AGENT_API_KEY = "agent-key-value";
  assert.equal(validateAgentToken(requestWith("Bearer agent-key-value")), true);
  assert.equal(validateAgentToken(requestWith("Bearer agent-key-WALUE")), false);
  assert.equal(validateAgentToken(requestWith("Bearer agent-key-value-but-longer")), false);
});

test("an empty or unset AGENT_API_KEY authenticates nothing", () => {
  delete process.env.AGENT_API_KEY;
  assert.equal(validateAgentToken(requestWith("Bearer undefined")), false);
  assert.equal(validateAgentToken(requestWith("Bearer ")), false);
  process.env.AGENT_API_KEY = "";
  assert.equal(validateAgentToken(requestWith("Bearer ")), false);
  delete process.env.AGENT_API_KEY;
});

test("the legacy vault secret still opens the vault route", () => {
  process.env.AGENT_API_KEY = "agent-key-value";
  process.env.AGENT_VAULT_SECRET = "legacy-vault-secret";
  assert.equal(validateAgentOrVaultToken(requestWith("Bearer agent-key-value")), true);
  assert.equal(validateAgentOrVaultToken(requestWith("Bearer legacy-vault-secret")), true);
  assert.equal(validateAgentOrVaultToken(requestWith("Bearer something-else")), false);
});

test("the legacy path refuses to authenticate when it is unset", () => {
  delete process.env.AGENT_API_KEY;
  delete process.env.AGENT_VAULT_SECRET;
  assert.equal(validateAgentOrVaultToken(requestWith("Bearer undefined")), false);
});
