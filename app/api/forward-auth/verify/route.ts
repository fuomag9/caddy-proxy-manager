import { NextRequest, NextResponse } from "next/server";
import {
  validateForwardAuthSession,
  checkHostAccess,
} from "@/src/lib/models/forward-auth";
import { getUserById } from "@/src/lib/models/user";
import { getGroupsForUser } from "@/src/lib/models/groups";
import {
  FORWARD_AUTH_PORTAL_TARGET_HEADER,
  getForwardAuthPortalTarget,
  resolveTrustedForwardAuthAudience,
} from "@/src/lib/forward-auth-trust";

const COOKIE_NAME = "_cpm_fa";

/**
 * A 401/403 for Caddy, which answers it with a redirect to the portal.  The
 * portal target header carries the protected URL encoded for the portal's
 * query string.
 */
function deny(request: NextRequest, status: 401 | 403): NextResponse {
  const target = getForwardAuthPortalTarget(request.headers);
  return new NextResponse(status === 403 ? "Forbidden" : null, {
    status,
    headers: target ? { [FORWARD_AUTH_PORTAL_TARGET_HEADER]: target } : undefined,
  });
}

/**
 * Forward auth verify endpoint — called by Caddy as a subrequest.
 * Returns 200 + user headers on success, 401/403 on failure.
 */
export async function GET(request: NextRequest) {
  // Never trust X-Forwarded-* from a client reaching Next.js directly.  Only
  // generated Caddy routes know the purpose-derived proof value, and the
  // audience must be the proxy host whose route issued the subrequest.
  const audience = await resolveTrustedForwardAuthAudience(request.headers);
  if (!audience) {
    return deny(request, 401);
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return deny(request, 401);
  }

  const session = await validateForwardAuthSession(token, audience);
  if (!session) {
    return deny(request, 401);
  }

  const user = await getUserById(session.userId);
  if (!user || user.status !== "active") {
    return deny(request, 401);
  }

  const hasAccess = await checkHostAccess(session.userId, audience.proxyHostId);
  if (!hasAccess) {
    return deny(request, 403);
  }

  // Get user's groups for the header
  const userGroups = await getGroupsForUser(session.userId);
  const groupNames = userGroups.map((g) => g.name).join(",");

  // Return 200 with user info headers that Caddy will copy to upstream
  return new NextResponse(null, {
    status: 200,
    headers: {
      "X-CPM-User": user.name ?? user.email.split("@")[0],
      "X-CPM-Email": user.email,
      "X-CPM-Groups": groupNames,
      "X-CPM-User-Id": String(user.id)
    }
  });
}
