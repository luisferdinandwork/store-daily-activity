import { NextRequest, NextResponse } from "next/server";
import { resolveOpsScope } from "@/lib/performance/ops-scope";
import {
  getOpsImpactResult,
  recordImpactCheck,
} from "@/lib/db/utils/ops-impact-results";

type Context = { params: Promise<{ id: string }> };
const missing = () =>
  NextResponse.json(
    { success: false, error: "Hasil visit tidak ditemukan." },
    { status: 404 },
  );

export async function GET(_req: NextRequest, { params }: Context) {
  const scope = await resolveOpsScope();
  if (!scope.ok)
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status },
    );
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return missing();
  try {
    const visit = await getOpsImpactResult(scope, id);
    return visit ? NextResponse.json({ success: true, visit }) : missing();
  } catch (error) {
    console.error("[impact-result GET]", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat hasil visit." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, { params }: Context) {
  const scope = await resolveOpsScope();
  if (!scope.ok)
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status },
    );
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return missing();
  const body: unknown = await req.json().catch(() => null);
  try {
    const result = await recordImpactCheck(scope, id, body);
    return result.success
      ? NextResponse.json({ success: true, visit: result.data })
      : NextResponse.json(
          { success: false, error: result.error },
          { status: result.status },
        );
  } catch (error) {
    console.error("[impact-result POST]", error);
    return NextResponse.json(
      {
        success: false,
        error: "Gagal menyimpan pemeriksaan. Muat ulang sebelum mencoba lagi.",
      },
      { status: 500 },
    );
  }
}
