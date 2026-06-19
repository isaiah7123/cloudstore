// index.mjs
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME;
const USER_POOL_ID = process.env.USER_POOL_ID;
const CLIENT_ID = process.env.CLIENT_ID;

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function getUser(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;

  if (!claims || !claims.sub) {
    console.error("Missing JWT claims:", JSON.stringify(event.requestContext));
    throw new Error("Unauthorized");
  }

  return claims.sub;
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "https://main.dck2qgm59c4hv.amplifyapp.com",
    },
    body: JSON.stringify(body),
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  console.log("EVENT:", JSON.stringify(event));
  const method = event.requestContext?.http?.method;
  const path = event.rawPath;

  try {
    const userId = await getUser(event);

    // GET /files — list user's files
    if (method === "GET" && path === "/files") {
      const result = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: `users/${userId}/`,
      }));

      const files = (result.Contents ?? []).map((obj) => ({
        key: obj.Key,
        name: obj.Key.replace(`users/${userId}/`, ""),
        size: obj.Size,
        modified: obj.LastModified,
      }));

      return response(200, { files });
    }

    // GET /files/{filename} — get presigned download URL
    if (method === "GET" && path.startsWith("/files/")) {
      const filename = decodeURIComponent(path.replace("/files/", ""));
      const key = `users/${userId}/${filename}`;

      const url = await getSignedUrl(s3, new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
      }), { expiresIn: 3600 });

      return response(200, { url });
    }

    // POST /files/upload-url — get presigned upload URL
    if (method === "POST" && path === "/files/upload-url") {
      let body = {};
      try {
        body = JSON.parse(event.body ?? "{}");
      } catch (e) {
        return response(400, { error: "Invalid JSON" });
      }

      const { filename, contentType } = body;

      if (!filename) {
        return response(400, { error: "filename required" });
      }

      const key = `users/${userId}/${filename}`;

      const url = await getSignedUrl(s3, new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: contentType ?? "application/octet-stream",
        StorageClass: "GLACIER_IR",
      }), { expiresIn: 900 });

      return response(200, { url, key });
    }

    // HEAD /files/{filename} — get file metadata without downloading
    if (method === "HEAD" && path.startsWith("/files/")) {
      const filename = decodeURIComponent(path.replace("/files/", ""));
      const key = `users/${userId}/${filename}`;

      const result = await s3.send(new HeadObjectCommand({
        Bucket: BUCKET,
        Key: key,
      }));

      return response(200, {
        size: result.ContentLength,
        type: result.ContentType,
        modified: result.LastModified,
        storageClass: result.StorageClass,
      });
    }

    // DELETE /files/{filename}
    if (method === "DELETE" && path.startsWith("/files/")) {
      const filename = decodeURIComponent(path.replace("/files/", ""));
      const key = `users/${userId}/${filename}`;

      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      return response(200, { deleted: true });
    }

    return response(404, { error: "Not found" });

  } catch (err) {
    console.error("Lambda error:", err);

    if (
      err.message === "Unauthorized" ||
      err.name === "Unauthorized" ||
      err.message?.includes("Unauthorized")
    ) {
      return response(401, { error: "Unauthorized" });
    }

    return response(500, { error: "Internal server error" });
  }
};