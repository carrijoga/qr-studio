export interface Logo {
  name: string;
  /** Data URL, embedded directly in the exported SVG. */
  data: string;
}

const STORAGE_KEY = "qr-studio:logo";
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
/** Small SVGs stay vector: sharpest result for print. */
const MAX_INLINE_SVG_BYTES = 150 * 1024;
/** At 30% of a 5 cm code, 768 px is ~1300 dpi: plenty for print, small for storage. */
const MAX_SIDE_PX = 768;
/** Shared links carry the logo inline, so it's shrunk further to keep the URL usable. */
const SHARE_SIDE_PX = 256;
const MAX_SHARE_SVG_CHARS = 12 * 1024;
const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;

export function isLogo(value: unknown): value is Logo {
  const v = value as Logo | null;
  return typeof v?.name === "string" && typeof v.data === "string" && LOGO_DATA_URL.test(v.data);
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function decodeImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** Validates the file is a decodable image and shrinks it for storage. Throws a user-facing message. */
export async function optimizeLogo(file: File): Promise<Logo> {
  if (!file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("Imagem muito grande (máx. 10 MB).");

  const original = await readAsDataUrl(file);
  let img: HTMLImageElement;
  try {
    img = await decodeImage(original);
  } catch {
    throw new Error("Não foi possível ler a imagem.");
  }

  if (file.type === "image/svg+xml" && file.size <= MAX_INLINE_SVG_BYTES) {
    return { name: file.name, data: original };
  }

  return { name: file.name, data: rasterize(img, MAX_SIDE_PX) };
}

/** Downscales to maxSide; PNG keeps alpha losslessly, WebP (also with alpha) is used when clearly smaller. */
function rasterize(img: HTMLImageElement, maxSide: number): string {
  const w = img.naturalWidth || maxSide;
  const h = img.naturalHeight || maxSide;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL("image/png");
  const webp = canvas.toDataURL("image/webp", 0.9);
  return webp.startsWith("data:image/webp") && webp.length < png.length * 0.8 ? webp : png;
}

/** Smaller copy of the logo for embedding in a shared link (small SVGs stay vector). */
export async function shrinkLogoForShare(logo: Logo): Promise<Logo> {
  if (logo.data.startsWith("data:image/svg+xml") && logo.data.length <= MAX_SHARE_SVG_CHARS) return logo;
  return { name: logo.name, data: rasterize(await decodeImage(logo.data), SHARE_SIDE_PX) };
}

export function loadLogo(): Logo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const logo: unknown = JSON.parse(raw);
    return isLogo(logo) ? logo : null;
  } catch {
    return null;
  }
}

/** Returns false when storage is full or unavailable (the logo still works for this session). */
export function saveLogo(logo: Logo | null): boolean {
  try {
    if (logo) localStorage.setItem(STORAGE_KEY, JSON.stringify(logo));
    else localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
