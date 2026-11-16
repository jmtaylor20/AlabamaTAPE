/**
 * What may be uploaded as evidence and how a file is checked before anyone can
 * open it. Pure functions so they are unit tested without storage.
 */

export const BUCKET = "evidence";
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_PROGRAM_BYTES = 1024 * 1024 * 1024;
export const LINK_TTL_SECONDS = 60;

type Kind = { ext: string[]; mime: string[]; label: string; magic: (b: Uint8Array) => boolean };

const ascii = (b: Uint8Array, at: number, s: string) => b.length >= at + s.length && s.split("").every((ch, i) => b[at + i] === ch.charCodeAt(0));
const bytes = (b: Uint8Array, at: number, sig: number[]) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ftyp = (b: Uint8Array) => ascii(b, 4, "ftyp");

export const KINDS: Kind[] = [
  { ext: ["pdf"], mime: ["application/pdf"], label: "PDF", magic: (b) => ascii(b, 0, "%PDF") },
  { ext: ["docx"], mime: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], label: "Word", magic: (b) => bytes(b, 0, [0x50, 0x4b, 0x03, 0x04]) },
  { ext: ["xlsx"], mime: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], label: "Excel", magic: (b) => bytes(b, 0, [0x50, 0x4b, 0x03, 0x04]) },
  { ext: ["pptx"], mime: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"], label: "PowerPoint", magic: (b) => bytes(b, 0, [0x50, 0x4b, 0x03, 0x04]) },
  { ext: ["doc"], mime: ["application/msword"], label: "Word (legacy)", magic: (b) => bytes(b, 0, [0xd0, 0xcf, 0x11, 0xe0]) },
  { ext: ["xls"], mime: ["application/vnd.ms-excel"], label: "Excel (legacy)", magic: (b) => bytes(b, 0, [0xd0, 0xcf, 0x11, 0xe0]) },
  { ext: ["ppt"], mime: ["application/vnd.ms-powerpoint"], label: "PowerPoint (legacy)", magic: (b) => bytes(b, 0, [0xd0, 0xcf, 0x11, 0xe0]) },
  { ext: ["png"], mime: ["image/png"], label: "PNG image", magic: (b) => bytes(b, 0, [0x89, 0x50, 0x4e, 0x47]) },
  { ext: ["jpg", "jpeg"], mime: ["image/jpeg"], label: "JPEG image", magic: (b) => bytes(b, 0, [0xff, 0xd8, 0xff]) },
  { ext: ["gif"], mime: ["image/gif"], label: "GIF image", magic: (b) => ascii(b, 0, "GIF8") },
  { ext: ["heic", "heif"], mime: ["image/heic", "image/heif"], label: "HEIC image", magic: ftyp },
  { ext: ["mp4", "m4v"], mime: ["video/mp4", "video/x-m4v"], label: "MP4 video", magic: ftyp },
  { ext: ["mov"], mime: ["video/quicktime"], label: "QuickTime video", magic: ftyp },
  { ext: ["webm"], mime: ["video/webm"], label: "WebM video", magic: (b) => bytes(b, 0, [0x1a, 0x45, 0xdf, 0xa3]) },
];

export const ACCEPT = KINDS.flatMap((k) => k.ext.map((e) => `.${e}`)).join(",");
export const ALLOWED_MIME = KINDS.flatMap((k) => k.mime);

export function kindFor(name: string, contentType: string): Kind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const byExt = KINDS.find((k) => k.ext.includes(ext));
  if (!byExt) return null;
  // Browsers sometimes send a generic type; the extension decides, the bytes are checked at scan time.
  if (contentType && contentType !== "application/octet-stream" && !byExt.mime.includes(contentType)) return null;
  return byExt;
}

/** Validates a proposed upload before a storage slot is issued. */
export function validateUpload(input: { name: string; size: number; contentType: string; alreadyUsedBytes: number }): { ok: true; kind: Kind; contentType: string } | { ok: false; reason: string } {
  const name = input.name.trim();
  if (!name || name.length > 200) return { ok: false, reason: "The file name is missing or too long." };
  if (input.size <= 0) return { ok: false, reason: "The file is empty." };
  if (input.size > MAX_FILE_BYTES) return { ok: false, reason: `Files are limited to ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB. Compress the file or split it.` };
  if (input.alreadyUsedBytes + input.size > MAX_PROGRAM_BYTES) return { ok: false, reason: "This program has reached its evidence storage limit for the year. Remove files you no longer need." };
  const kind = kindFor(name, input.contentType);
  if (!kind) return { ok: false, reason: "That file type is not accepted. Upload PDF, Word, Excel, PowerPoint, images, or common video." };
  return { ok: true, kind, contentType: kind.mime[0]! };
}

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export type ScanResult = { status: "clean" | "infected" | "failed"; scanner: string; detail?: string };

/** Built-in checks: the bytes must match the declared type and must not carry the antivirus test signature. */
export function basicScan(buf: Uint8Array, name: string, contentType: string): ScanResult {
  const kind = kindFor(name, contentType);
  if (!kind) return { status: "failed", scanner: "basic", detail: "type not accepted" };
  if (!kind.magic(buf)) return { status: "infected", scanner: "basic", detail: `content does not match a ${kind.label} file` };
  const head = Buffer.from(buf.subarray(0, Math.min(buf.length, 4096))).toString("latin1");
  if (head.includes(EICAR)) return { status: "infected", scanner: "basic", detail: "antivirus test signature" };
  return { status: "clean", scanner: "basic" };
}

/**
 * Full scan: built-in checks, then ClamAV when CLAMAV_URL is configured
 * (a clamav-rest endpoint; POST /scan with the file). Any scanner error leaves
 * the file unreadable with status failed, which an admin can retry.
 */
export async function scanFile(buf: Uint8Array, name: string, contentType: string, clamavUrl = process.env.CLAMAV_URL): Promise<ScanResult> {
  const basic = basicScan(buf, name, contentType);
  if (basic.status !== "clean") return basic;
  if (!clamavUrl) return basic;
  try {
    const form = new FormData();
    form.append("file", new Blob([buf as BlobPart], { type: contentType }), name);
    const res = await fetch(`${clamavUrl.replace(/\/$/, "")}/scan`, { method: "POST", body: form, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    if (!res.ok) return { status: "failed", scanner: "clamav", detail: `scanner returned ${res.status}` };
    if (/FOUND|infected/i.test(text)) return { status: "infected", scanner: "clamav", detail: text.slice(0, 200) };
    if (/OK|clean/i.test(text)) return { status: "clean", scanner: "clamav" };
    return { status: "failed", scanner: "clamav", detail: text.slice(0, 200) };
  } catch (err) {
    return { status: "failed", scanner: "clamav", detail: (err as Error).message.slice(0, 200) };
  }
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
