// lib/services/esign/docusign-auth.service.ts
// DocuSign JWT Grant authentication (RSA private key → access token)
// Handles both PKCS#1 ("RSA PRIVATE KEY") and PKCS#8 ("PRIVATE KEY") PEM formats

import { createSign } from "crypto";

export function isDocuSignConfigured(): boolean {
  const key = process.env.DOCUSIGN_INTEGRATION_KEY ?? "";
  const userId = process.env.DOCUSIGN_USER_ID ?? "";
  const privateKey = process.env.DOCUSIGN_PRIVATE_KEY_BASE64 ?? "";
  // Require UUID-format keys (DocuSign integration keys and user IDs are GUIDs)
  const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  return !!(key && userId && privateKey && isUuid(key) && isUuid(userId));
}

export function getDocuSignConfig() {
  return {
    integrationKey:   process.env.DOCUSIGN_INTEGRATION_KEY ?? "",
    clientId:         process.env.DOCUSIGN_CLIENT_ID ?? process.env.DOCUSIGN_INTEGRATION_KEY ?? "",
    userId:           process.env.DOCUSIGN_USER_ID ?? "",
    accountId:        process.env.DOCUSIGN_ACCOUNT_ID ?? "",
    authServer:       process.env.DOCUSIGN_AUTH_SERVER ?? "account.docusign.com",
    baseUrl:          process.env.DOCUSIGN_BASE_URL ?? "https://na4.docusign.net/restapi",
    oauthBaseUrl:     process.env.DOCUSIGN_OAUTH_BASE_URL ?? "https://account.docusign.com",
    env:              process.env.DOCUSIGN_ENV ?? "production",
    isSandbox:        (process.env.DOCUSIGN_ENV ?? "production") === "sandbox",
    privateKeyBase64: process.env.DOCUSIGN_PRIVATE_KEY_BASE64 ?? "",
    dealerTemplateId: process.env.DOCUSIGN_DEALER_TEMPLATE_ID ?? "",
    returnUrl:        process.env.DOCUSIGN_RETURN_URL ?? "",
    webhookSecret:    process.env.DOCUSIGN_WEBHOOK_SECRET ?? "",
  };
}

/**
 * Obtain a DocuSign access token via JWT Grant.
 * Signs the JWT with the RSA private key (supports PKCS#1 and PKCS#8 formats).
 * @throws Error with the DocuSign API error description on failure
 */
export async function getDocuSignAccessToken(): Promise<string> {
  const config = getDocuSignConfig();

  if (!config.privateKeyBase64) throw new Error("DOCUSIGN_PRIVATE_KEY_BASE64 is not set");
  const pem = Buffer.from(config.privateKeyBase64, "base64").toString("utf8");

  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss:   config.integrationKey,
    sub:   config.userId,
    aud:   config.authServer,
    scope: "signature impersonation",
    iat:   now,
    exp:   now + 3600,
  })).toString("base64url");

  // Sign with RSA-SHA256 (works with PKCS#1 and PKCS#8 PEM keys)
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(pem, "base64url");
  const jwt = `${header}.${payload}.${signature}`;

  const tokenUrl = `https://${config.authServer}/oauth/token`;
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }),
  });

  const data = await res.json() as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(
      `DocuSign JWT auth failed (${res.status}): ${data.error ?? "unknown"} — ${data.error_description ?? JSON.stringify(data)}`
    );
  }

  return data.access_token;
}
