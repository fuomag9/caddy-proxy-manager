import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { listOAuthProviders, createOAuthProvider } from "@/src/lib/models/oauth-providers";
import type { OAuthProvider } from "@/src/lib/models/oauth-providers";
import { createAuditEvent } from "@/src/lib/models/audit";
import { invalidateProviderCache } from "@/src/lib/auth-server";

function redactSecrets(provider: OAuthProvider) {
  const clientId = provider.clientId;
  return {
    ...provider,
    clientId: clientId.length > 4 ? "••••" + clientId.slice(-4) : "••••",
    clientSecret: "••••••••",
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const providers = await listOAuthProviders();
    return NextResponse.json(providers.map(redactSecrets));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireApiAdmin(request);
    const body = await request.json();

    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!body.clientId || typeof body.clientId !== "string") {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }
    if (!body.clientSecret || typeof body.clientSecret !== "string") {
      return NextResponse.json({ error: "clientSecret is required" }, { status: 400 });
    }

    const provider = await createOAuthProvider({
      name: body.name,
      type: body.type ?? "oidc",
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      issuer: body.issuer ?? null,
      authorizationUrl: body.authorizationUrl ?? null,
      tokenUrl: body.tokenUrl ?? null,
      userinfoUrl: body.userinfoUrl ?? null,
      scopes: body.scopes ?? "openid email profile",
      autoLink: body.autoLink ?? false,
      source: "ui",
    });

    invalidateProviderCache();

    await createAuditEvent({
      userId,
      action: "create",
      entityType: "oauth_provider",
      entityId: null,
      summary: `Created OAuth provider "${provider.name}"`,
      data: JSON.stringify({ providerId: provider.id, name: provider.name, type: provider.type }),
    });

    return NextResponse.json(redactSecrets(provider), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
