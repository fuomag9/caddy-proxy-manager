import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { getOAuthProvider, updateOAuthProvider, deleteOAuthProvider } from "@/src/lib/models/oauth-providers";
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiAdmin(request);
    const { id } = await params;
    const provider = await getOAuthProvider(id);
    if (!provider) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(redactSecrets(provider));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id } = await params;
    const body = await request.json();

    const existing = await getOAuthProvider(id);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Env-sourced providers can only have `enabled` toggled
    if (existing.source === "env") {
      const allowedKeys = ["enabled"];
      const bodyKeys = Object.keys(body).filter((k) => body[k] !== undefined);
      const disallowed = bodyKeys.filter((k) => !allowedKeys.includes(k));
      if (disallowed.length > 0) {
        return NextResponse.json(
          { error: `Environment-sourced providers can only update: ${allowedKeys.join(", ")}` },
          { status: 400 }
        );
      }
    }

    const updated = await updateOAuthProvider(id, body);
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    invalidateProviderCache();

    await createAuditEvent({
      userId,
      action: "update",
      entityType: "oauth_provider",
      entityId: null,
      summary: `Updated OAuth provider "${updated.name}"`,
      data: JSON.stringify({ providerId: updated.id, fields: Object.keys(body) }),
    });

    return NextResponse.json(redactSecrets(updated));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireApiAdmin(request);
    const { id } = await params;

    const existing = await getOAuthProvider(id);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (existing.source === "env") {
      return NextResponse.json(
        { error: "Cannot delete an environment-sourced OAuth provider" },
        { status: 400 }
      );
    }

    await deleteOAuthProvider(id);

    invalidateProviderCache();

    await createAuditEvent({
      userId,
      action: "delete",
      entityType: "oauth_provider",
      entityId: null,
      summary: `Deleted OAuth provider "${existing.name}"`,
      data: JSON.stringify({ providerId: existing.id, name: existing.name }),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
