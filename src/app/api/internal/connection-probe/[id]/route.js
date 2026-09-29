import { NextResponse } from "next/server";
import { probeConnectionChat } from "@/lib/network/connectionChatProbe";

function modelFromBody(body) {
  const model = typeof body?.model === "string" ? body.model.trim() : "";
  if (!model) throw new Error("Model is required");
  return model;
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const model = modelFromBody(await request.json());
    const result = await probeConnectionChat(id, model);
    return NextResponse.json(result, { status: result.valid ? 200 : 502 });
  } catch (error) {
    if (error instanceof Error && error.message === "Model is required") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Connection probe failed" }, { status: 502 });
  }
}
