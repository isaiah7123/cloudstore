// src/api.js
import { fetchAuthSession } from "aws-amplify/auth";

const API = "https://fohkc53ail.execute-api.us-west-2.amazonaws.com";

async function authHeaders() {
  const session = await fetchAuthSession();
  const token = session.tokens.idToken.toString();
  return { Authorization: `Bearer ${token}` };
}

export async function listFiles() {
  const headers = await authHeaders();
  const res = await fetch(`${API}/files`, { headers });
  const { files } = await res.json();
  return files;
}

export async function getUploadUrl(filename, contentType, storageClass) {
  const headers = await authHeaders();
  return (await fetch(`${API}/files/upload-url`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType, storageClass }),
  })).json();
}

export async function uploadFile(file, storageClass, relativePath) {
  const filename = relativePath || file.name;
  const { url } = await getUploadUrl(filename, file.type, storageClass);
  await fetch(url, { method: "PUT", body: file });
}

export async function getDownloadUrl(filename) {
  const headers = await authHeaders();
  const encoded = filename.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${API}/files/${encoded}`, { headers });
  const { url } = await res.json();
  return url;
}

export async function deleteFile(filename) {
  const headers = await authHeaders();
  const encoded = filename.split("/").map(encodeURIComponent).join("/");
  await fetch(`${API}/files/${encoded}`, {
    method: "DELETE",
    headers,
  });
}