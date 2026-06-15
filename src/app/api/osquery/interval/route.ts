import { NextRequest, NextResponse } from "next/server";
import { SettingsManager } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const settings = await SettingsManager.getSettings();
    const intervalMins = settings.logIntervalMinutes || 10;
    return NextResponse.json({
      logIntervalMinutes: intervalMins,
      logIntervalSeconds: intervalMins * 60
    });
  } catch (error) {
    return NextResponse.json({ logIntervalMinutes: 10, logIntervalSeconds: 600 });
  }
}
