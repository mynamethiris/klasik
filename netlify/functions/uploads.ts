import type { Handler, HandlerEvent } from "@netlify/functions";

export const handler: Handler = async (event: HandlerEvent) => {
  const filename = event.path
    .replace(/^\/.netlify\/functions\/uploads/, "")
    .replace(/^\/uploads/, "")
    .replace(/^\/+/, "");

  if (!filename) {
    return { statusCode: 400, body: "Filename diperlukan" };
  }

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    return { statusCode: 500, body: "TURSO_DATABASE_URL belum diset" };
  }

  try {
    const { createClient } = await import("@libsql/client/http");
    const db = createClient({ url, authToken });

    const res = await db.execute({
      sql: "SELECT data, mime_type FROM file_uploads WHERE filename = ?",
      args: [filename],
    });

    if (res.rows.length === 0) {
      return { statusCode: 404, body: "File tidak ditemukan" };
    }

    const { data, mime_type } = res.rows[0];

    return {
      statusCode: 200,
      headers: {
        "Content-Type": mime_type as string,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
      body: data as string,
      isBase64Encoded: true,
    };
  } catch (err: any) {
    console.error("Upload fetch error:", err);
    return { statusCode: 500, body: "Gagal mengambil file: " + err.message };
  }
};
