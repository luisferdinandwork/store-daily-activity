import { NextResponse } from "next/server";
import { resolveOpsScope } from "@/lib/performance/ops-scope";
import { listOpsImpactResults } from "@/lib/db/utils/ops-impact-results";

export async function GET() {
  const scope = await resolveOpsScope();
  if (!scope.ok)
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status },
    );
  try {
    return NextResponse.json({
      success: true,
      isHO: scope.scope === "all_areas",
      visits: await listOpsImpactResults(scope),
    });
  } catch (error) {
    console.error("[impact-results GET]", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat hasil visit." },
      { status: 500 },
    );
  }
}
