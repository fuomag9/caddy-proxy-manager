import { existsSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";

const COUNTRY_DB = "/usr/share/GeoIP/GeoLite2-Country.mmdb";
const ASN_DB = "/usr/share/GeoIP/GeoLite2-ASN.mmdb";

export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    return NextResponse.json({
      country: existsSync(COUNTRY_DB),
      asn: existsSync(ASN_DB),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
