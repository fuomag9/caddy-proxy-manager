import { existsSync } from "node:fs";
import { NextResponse } from "next/server";

const COUNTRY_DB = "/usr/share/GeoIP/GeoLite2-Country.mmdb";
const ASN_DB = "/usr/share/GeoIP/GeoLite2-ASN.mmdb";

export async function GET() {
  return NextResponse.json({
    country: existsSync(COUNTRY_DB),
    asn: existsSync(ASN_DB),
  });
}
