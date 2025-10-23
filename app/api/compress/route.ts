import { NextResponse } from "next/server"

export async function POST() {
  // This endpoint is no longer needed as compression is handled client-side
  return NextResponse.json(
    { error: "This endpoint is deprecated. Compression is handled client-side." },
    { status: 410 },
  )
}
