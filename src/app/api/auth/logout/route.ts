import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/security/session";
import { isSameOrigin } from "@/lib/security/request";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  await deleteSession();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
