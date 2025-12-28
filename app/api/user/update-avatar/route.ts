import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { updateUserProfile } from "@/src/lib/models/user";
import { createAuditEvent } from "@/src/lib/models/audit";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const body = await request.json();
    const { avatarUrl } = body;

    // Validate avatarUrl is either null or a base64 image string
    if (avatarUrl !== null && typeof avatarUrl !== "string") {
      return NextResponse.json(
        { error: "Invalid avatar data" },
        { status: 400 }
      );
    }

    // If avatarUrl is provided, validate it's a base64 image
    if (avatarUrl !== null) {
      if (!avatarUrl.startsWith("data:image/")) {
        return NextResponse.json(
          { error: "Avatar must be a base64-encoded image" },
          { status: 400 }
        );
      }

      // Check base64 size (rough estimate: base64 is ~33% larger than binary)
      // 2MB binary = ~2.7MB base64, so limit to 3MB base64 string
      if (avatarUrl.length > 3 * 1024 * 1024) {
        return NextResponse.json(
          { error: "Avatar image is too large" },
          { status: 400 }
        );
      }
    }

    // Update user avatar
    const updatedUser = await updateUserProfile(userId, {
      avatar_url: avatarUrl
    });

    if (!updatedUser) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Audit log
    await createAuditEvent({
      userId,
      action: avatarUrl ? "avatar_updated" : "avatar_deleted",
      entityType: "user",
      entityId: userId,
      summary: avatarUrl ? "User updated profile picture" : "User removed profile picture",
      data: JSON.stringify({ hasAvatar: !!avatarUrl })
    });

    return NextResponse.json({
      success: true,
      avatarUrl: updatedUser.avatar_url
    });
  } catch (error) {
    console.error("Avatar update error:", error);
    return NextResponse.json(
      { error: "Failed to update avatar" },
      { status: 500 }
    );
  }
}
