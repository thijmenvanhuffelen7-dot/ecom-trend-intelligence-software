import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/server";

// Alleen content-addressed sleutels die de workers zelf aanmaken (geen willekeurige objecten, geen SVG)
const KEY = /^(creatives|screenshots|products)\/[0-9a-f]{2}\/[0-9a-f]{64}\.(jpg|png|webp|gif|mp4)$/;

const g = globalThis as unknown as { __s3?: S3Client };
function s3() {
  g.__s3 ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION && process.env.S3_REGION !== "auto" ? process.env.S3_REGION : "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
  });
  return g.__s3;
}

/** Creatives en screenshots uit onze eigen opslag; alleen voor ingelogde gebruikers (geen hotlinking). */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (!(await getSession())) return new NextResponse("Unauthorized", { status: 401 });
  const key = (await params).key.join("/");
  if (!KEY.test(key)) return new NextResponse("Not found", { status: 404 });
  try {
    const obj = await s3().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    return new NextResponse(obj.Body?.transformToWebStream() as ReadableStream, {
      headers: {
        "Content-Type": obj.ContentType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
