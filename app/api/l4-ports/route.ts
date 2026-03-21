import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, checkSameOrigin } from "@/src/lib/auth";
import { getL4PortsDiff, getL4PortsStatus, applyL4Ports } from "@/src/lib/l4-ports";

/**
 * GET /api/l4-ports — returns current port diff and apply status.
 */
export async function GET() {
  try {
    await requireAdmin();
    const [diff, status] = await Promise.all([
      getL4PortsDiff(),
      getL4PortsStatus(),
    ]);
    return NextResponse.json({ diff, status });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

/**
 * POST /api/l4-ports — trigger port apply (write override + trigger file).
 */
export async function POST(request: NextRequest) {
  const originCheck = checkSameOrigin(request);
  if (originCheck) return originCheck;

  try {
    await requireAdmin();
    const status = await applyL4Ports();
    return NextResponse.json({ status });
  } catch (error) {
    console.error("Failed to apply L4 ports:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to apply L4 ports" },
      { status: 500 }
    );
  }
}
