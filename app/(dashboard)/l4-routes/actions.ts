"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import { actionError, actionSuccess, type ActionState } from "@/src/lib/actions";
import {
  createL4Route,
  updateL4Route,
  deleteL4Route,
  toggleL4Route,
  type L4RouteInput,
  type L4Matcher,
  type L4Upstream,
  type L4RouteMeta,
  type L4HandlerType,
} from "@/src/lib/models/l4-routes";
import {
  parseCertificateId,
  parseCheckbox,
  parseOptionalText,
  parseUpstreams,
} from "@/src/lib/form-parse";

function parseJsonField<T>(formData: FormData, key: string): T | null {
  const raw = formData.get(key);
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

export async function createL4RouteAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const session = await requireAdmin();

    const name = formData.get("name");
    if (!name || typeof name !== "string" || !name.trim()) {
      return actionError(new Error("Name is required"), "Name is required");
    }

    const listenRaw = formData.get("listen_addresses");
    const listenAddresses = parseUpstreams(listenRaw);
    if (listenAddresses.length === 0) {
      return actionError(new Error("At least one listen address is required"), "At least one listen address is required");
    }

    const handlerType = (parseOptionalText(formData.get("handler_type")) ?? "proxy") as L4HandlerType;

    const matchersJson = parseJsonField<L4Matcher[]>(formData, "matchers");
    const upstreamsJson = parseJsonField<L4Upstream[]>(formData, "upstreams_json");

    // Fallback: parse upstreams from text field
    let upstreams = upstreamsJson;
    if (!upstreams && handlerType === "proxy") {
      const upstreamDials = parseUpstreams(formData.get("upstreams"));
      if (upstreamDials.length > 0) {
        upstreams = upstreamDials.map((dial) => ({ dial: [dial] }));
      }
    }

    const tlsTermination = parseCheckbox(formData.get("tls_termination"));
    const certificateId = parseCertificateId(formData.get("certificate_id"));
    const proxyProtocol = parseOptionalText(formData.get("proxy_protocol"));
    const matchingTimeout = parseOptionalText(formData.get("matching_timeout"));
    const metaJson = parseJsonField<L4RouteMeta>(formData, "meta");

    const input: L4RouteInput = {
      name: name.toString().trim(),
      listen_addresses: listenAddresses,
      matchers: matchersJson,
      handler_type: handlerType,
      upstreams,
      tls_termination: tlsTermination,
      certificate_id: tlsTermination ? certificateId : null,
      proxy_protocol: proxyProtocol,
      matching_timeout: matchingTimeout,
      enabled: true,
      meta: metaJson,
    };

    await createL4Route(input, Number(session.user.id));
    revalidatePath("/l4-routes");
    return actionSuccess("L4 route created");
  } catch (error) {
    return actionError(error, "Failed to create L4 route");
  }
}

export async function updateL4RouteAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const session = await requireAdmin();

    const idRaw = formData.get("id");
    if (!idRaw) return actionError(new Error("ID is required"), "ID is required");
    const id = parseInt(idRaw.toString(), 10);
    if (!Number.isFinite(id)) return actionError(new Error("Invalid ID"), "Invalid ID");

    const name = formData.get("name");
    if (!name || typeof name !== "string" || !name.trim()) {
      return actionError(new Error("Name is required"), "Name is required");
    }

    const listenRaw = formData.get("listen_addresses");
    const listenAddresses = parseUpstreams(listenRaw);
    if (listenAddresses.length === 0) {
      return actionError(new Error("At least one listen address is required"), "At least one listen address is required");
    }

    const handlerType = (parseOptionalText(formData.get("handler_type")) ?? "proxy") as L4HandlerType;

    const matchersJson = parseJsonField<L4Matcher[]>(formData, "matchers");
    const upstreamsJson = parseJsonField<L4Upstream[]>(formData, "upstreams_json");
    let upstreams = upstreamsJson;
    if (!upstreams && handlerType === "proxy") {
      const upstreamDials = parseUpstreams(formData.get("upstreams"));
      if (upstreamDials.length > 0) {
        upstreams = upstreamDials.map((dial) => ({ dial: [dial] }));
      }
    }

    const tlsTermination = parseCheckbox(formData.get("tls_termination"));
    const certificateId = parseCertificateId(formData.get("certificate_id"));
    const proxyProtocol = parseOptionalText(formData.get("proxy_protocol"));
    const matchingTimeout = parseOptionalText(formData.get("matching_timeout"));
    const metaJson = parseJsonField<L4RouteMeta>(formData, "meta");

    const input: Partial<L4RouteInput> = {
      name: name.toString().trim(),
      listen_addresses: listenAddresses,
      matchers: matchersJson,
      handler_type: handlerType,
      upstreams,
      tls_termination: tlsTermination,
      certificate_id: tlsTermination ? certificateId : null,
      proxy_protocol: proxyProtocol,
      matching_timeout: matchingTimeout,
      meta: metaJson,
    };

    await updateL4Route(id, input, Number(session.user.id));
    revalidatePath("/l4-routes");
    return actionSuccess("L4 route updated");
  } catch (error) {
    return actionError(error, "Failed to update L4 route");
  }
}

export async function deleteL4RouteAction(id: number): Promise<ActionState> {
  try {
    const session = await requireAdmin();
    await deleteL4Route(id, Number(session.user.id));
    revalidatePath("/l4-routes");
    return actionSuccess("L4 route deleted");
  } catch (error) {
    return actionError(error, "Failed to delete L4 route");
  }
}

export async function toggleL4RouteAction(id: number, enabled: boolean): Promise<ActionState> {
  try {
    const session = await requireAdmin();
    await toggleL4Route(id, enabled, Number(session.user.id));
    revalidatePath("/l4-routes");
    return actionSuccess(enabled ? "L4 route enabled" : "L4 route disabled");
  } catch (error) {
    return actionError(error, "Failed to toggle L4 route");
  }
}
