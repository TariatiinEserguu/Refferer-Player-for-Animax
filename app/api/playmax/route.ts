
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const episodeId = request.nextUrl.searchParams.get("episodeId");

  if (!episodeId || !/^\d+$/.test(episodeId)) {
    return Response.json(
      { error: "Ангийн ID буруу байна" },
      { status: 400 }
    );
  }

  // Одоогоор өмнөх кодод ашигласан ID.
  const mediaId = "1362689";
  const apiUrl =
    `https://playmax.mn/api/m/episode/${episodeId}/${mediaId}`;

  try {
    const upstream = await fetch(apiUrl, {
      headers: {
        Referer: "https://playmax.mn/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });

    const body = await upstream.text();

    if (!upstream.ok) {
      return Response.json(
        {
          error: "Playmax API хүсэлт амжилтгүй",
          upstreamStatus: upstream.status,
          details: body.slice(0, 500),
        },
        { status: 502 }
      );
    }

    let data: unknown;

    try {
      data = JSON.parse(body);
    } catch {
      return Response.json(
        {
          error: "Playmax JSON буцаасангүй",
          details: body.slice(0, 500),
        },
        { status: 502 }
      );
    }

    return Response.json(data, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Playmax API error:", error);

    return Response.json(
      {
        error: "Vercel сервер Playmax-той холбогдож чадсангүй",
      },
      { status: 502 }
    );
  }
}
