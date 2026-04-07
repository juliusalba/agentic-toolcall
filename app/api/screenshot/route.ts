import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCREENSHOTS_DIR = join(process.cwd(), "public", "screenshots");

export async function POST(request: Request) {
  try {
    const { imageData, filename } = (await request.json()) as { imageData: string; filename: string };

    if (!imageData || !filename) {
      return NextResponse.json({ error: "Missing imageData or filename." }, { status: 400 });
    }

    // Strip the data URL prefix
    const base64 = imageData.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64, "base64");

    await mkdir(SCREENSHOTS_DIR, { recursive: true });
    const filepath = join(SCREENSHOTS_DIR, filename);
    await writeFile(filepath, buffer);

    return NextResponse.json({ ok: true, path: `/screenshots/${filename}` });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save screenshot." },
      { status: 500 }
    );
  }
}
