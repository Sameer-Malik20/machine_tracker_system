import { NextRequest, NextResponse } from "next/server";
import { SettingsManager } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = SettingsManager.getSettings();
    return NextResponse.json(settings);
  } catch (error) {
    console.error("[API - Admin Settings] Failed to get settings:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Simple verification
    if (!body || !body.windows || !body.mac) {
      return NextResponse.json({ error: "Invalid settings payload" }, { status: 400 });
    }

    SettingsManager.saveSettings(body);
    return NextResponse.json({ success: true, settings: body });
  } catch (error) {
    console.error("[API - Admin Settings] Failed to save settings:", error);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
