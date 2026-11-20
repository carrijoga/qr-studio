import type { State } from "./state";

export type ContentResult =
  | { ok: true; data: string; link: string | null }
  | { ok: false; error: string };

export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Require a dotted host (or localhost) so "https://" alone is rejected.
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
    return url.href;
  } catch {
    return null;
  }
}

export function buildContent(state: State): ContentResult {
  switch (state.contentType) {
    case "url": {
      const url = normalizeUrl(state.url);
      if (!url) return { ok: false, error: "Informe uma URL válida (ex.: https://exemplo.com)." };
      return { ok: true, data: url, link: url };
    }
    case "whatsapp": {
      const digits = state.phone.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) {
        return { ok: false, error: "Telefone inválido: use DDI + DDD + número (10 a 15 dígitos)." };
      }
      const message = state.message.trim();
      const link = message
        ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
        : `https://wa.me/${digits}`;
      return { ok: true, data: link, link };
    }
    case "text": {
      if (!state.text.trim()) return { ok: false, error: "Digite o texto do QR Code." };
      return { ok: true, data: state.text, link: null };
    }
  }
}

/** WCAG contrast ratio between two hex colors. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface QrGeometry {
  modules: number;
  /** Module size in px, as qr-code-styling computes it (floored). */
  modulePx: number;
  quietModules: number;
  moduleMm: number;
}

/** Mirrors qr-code-styling's layout: dot = floor((size - 2·margin) / modules), code centered. */
export function geometry(modules: number, sizePx: number, marginPx: number, printCm: number): QrGeometry {
  const modulePx = Math.floor((sizePx - 2 * marginPx) / modules);
  const quietPx = (sizePx - modules * modulePx) / 2;
  return {
    modules,
    modulePx,
    quietModules: quietPx / modulePx,
    moduleMm: (printCm * 10 * modulePx) / sizePx,
  };
}

export const MIN_QUIET_MODULES = 4;
export const MIN_MODULE_MM = 0.4;
export const MIN_CONTRAST = 3;

const fmt = (n: number, digits = 1) => n.toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function printWarnings(g: QrGeometry, printCm: number, dotColor: string, bgColor: string): string[] {
  const warnings: string[] = [];
  if (!isDarkerThan(dotColor, bgColor)) {
    warnings.push("Módulos mais claros que o fundo: muitos leitores não reconhecem QR invertido.");
  } else {
    const ratio = contrastRatio(dotColor, bgColor);
    if (ratio < MIN_CONTRAST)
      warnings.push(`Pouco contraste (${fmt(ratio)}:1). Use módulos mais escuros ou fundo mais claro.`);
  }
  if (g.moduleMm < MIN_MODULE_MM)
    warnings.push(
      `Código denso: módulos de ${fmt(g.moduleMm, 2)} mm em ${printCm} cm. ` +
        `Aumente o tamanho impresso ou encurte o conteúdo (ideal ≥ ${fmt(MIN_MODULE_MM, 1)} mm).`,
    );
  if (g.quietModules < MIN_QUIET_MODULES)
    warnings.push(
      `Margem de ${fmt(g.quietModules)} módulos; o recomendado são ${MIN_QUIET_MODULES}. Aumente a margem externa.`,
    );
  return warnings;
}

export function isDarkerThan(a: string, b: string): boolean {
  const sum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
  };
  return sum(a) < sum(b);
}
