import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join, basename } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCREENSHOTS_DIR = join(process.cwd(), "public", "screenshots");
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB max

export async function POST(request: Request) {
  try {
    // Check content length
    const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: "Payload too large. Max 10MB." }, { status: 413 });
    }

    const { imageData, filename } = (await request.json()) as { imageData: string; filename: string };

    if (!imageData || !filename) {
      return NextResponse.json({ error: "Missing imageData or filename." }, { status: 400 });
    }

    // Sanitize filename — strip path components, allow only safe chars
    const safe = basename(filename).replace(/[^a-zA-Z0-9._-]/g, "");
    if (!safe || !safe.endsWith(".png")) {
      return NextResponse.json({ error: "Filename must be a .png file." }, { status: 400 });
    }

    // Validate it's actually a PNG data URL
    if (!imageData.startsWith("data:image/png;base64,")) {
      return NextResponse.json({ error: "Only PNG data URLs accepted." }, { status: 400 });
    }

    const base64 = imageData.slice("data:image/png;base64,".length);
    const buffer = Buffer.from(base64, "base64");

    // Double-check decoded size
    if (buffer.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: "Decoded image too large." }, { status: 413 });
    }

    await mkdir(SCREENSHOTS_DIR, { recursive: true });
    await writeFile(join(SCREENSHOTS_DIR, safe), buffer);

    return NextResponse.json({ ok: true, path: `/screenshots/${safe}` });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save screenshot." },
      { status: 500 }
    );
  }
}
