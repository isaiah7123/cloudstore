// index.mjs
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME;
const USER_POOL_ID = process.env.USER_POOL_ID;
const CLIENT_ID = process.env.CLIENT_ID;

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function getUser(event) {
  const token = auth.slice(7);
  const payload = await verifier.verify(token);
  return payload.sub; // Cognito user ID
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
  const method = event.requestContext?.http?.method;
  const path = event.rawPath;

  // CORS preflight — must return 200 before any auth check
  if (method === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,HEAD,OPTIONS",
        "Access-Control-Allow-Headers": "Authorization,Content-Type",
      },
      body: "",
    };
  }

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
      const { filename, contentType } = JSON.parse(event.body ?? "{}");
      if (!filename) return response(400, { error: "filename required" });

      const key = `users/${userId}/${filename}`;

      const url = await getSignedUrl(s3, new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: contentType ?? "application/octet-stream",
        StorageClass: "GLACIER_IR",
      }), { expiresIn: 900 }); // 15 min to upload

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
    if (err.message === "Unauthorized") return response(401, { error: "Unauthorized" });
    console.error(err);
    return response(500, { error: "Internal server error" });
  }
};