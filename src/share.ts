import { isLogo, shrinkLogoForShare, type Logo } from "./logo";
import { sanitizeState, type State } from "./state";

/**
 * Shared links carry the whole configuration in the URL fragment (#s=…), deflate-compressed
 * and base64url-encoded. The fragment never reaches a server, so nothing is stored anywhere.
 */
const HASH_PREFIX = "#s=";
const VERSION = 1;
/** Rejects absurd payloads before decompressing (a logo-bearing link is typically < 100 KB). */
const MAX_ENCODED_CHARS = 2_000_000;
const MAX_JSON_BYTES = 4_000_000;

interface Payload {
  v: number;
  state: State;
  logo: Logo | null;
}

export interface Shared {
  state: State;
  logo: Logo | null;
}

async function compress(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflates with an output cap, so a crafted link can't expand into gigabytes. */
async function decompress(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("payload too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function buildShareUrl(state: State, logo: Logo | null): Promise<string> {
  const payload: Payload = { v: VERSION, state, logo: logo && (await shrinkLogoForShare(logo)) };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const encoded = toBase64Url(await compress(json));
  const url = new URL(location.href);
  url.hash = "";
  return `${url.href}${HASH_PREFIX}${encoded}`;
}

export function hasSharedHash(hash = location.hash): boolean {
  return hash.startsWith(HASH_PREFIX);
}

/** Decodes and validates a shared link. Returns null for anything malformed. */
export async function readShareHash(hash = location.hash): Promise<Shared | null> {
  if (!hasSharedHash(hash)) return null;
  const encoded = hash.slice(HASH_PREFIX.length);
  if (!encoded || encoded.length > MAX_ENCODED_CHARS || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const json = await decompress(fromBase64Url(encoded), MAX_JSON_BYTES);
    const payload = JSON.parse(new TextDecoder().decode(json)) as Partial<Payload>;
    if (payload?.v !== VERSION) return null;
    return { state: sanitizeState(payload.state), logo: isLogo(payload.logo) ? payload.logo : null };
  } catch {
    return null;
  }
}

/** Removes #s=… from the address bar so a reload doesn't re-apply the link. */
export function clearShareHash(): void {
  history.replaceState(null, "", location.pathname + location.search);
}
