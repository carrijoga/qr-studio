import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const DEFAULT_MESSAGE =
  "Olá, Vivian! Tudo bem? 💚\n" +
  "Ganhei um Vale Cuidado dos Pés na raspadinha do casamento da Eveline e do Gabriel! 🎁\n" +
  "Gostaria de agendar meu atendimento e aproveitar esse presente especial.\n" +
  "Você poderia me informar os dias e horários disponíveis?\n" +
  "Muito obrigado(a)!";
const DEFAULT_LINK = `https://wa.me/5516993280760?text=${encodeURIComponent(DEFAULT_MESSAGE)}`;

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#627A61"/><text x="50" y="62" font-size="34" text-anchor="middle" fill="#fff" font-family="serif">E&amp;G</text></svg>`;

interface Decoded {
  text: string | null;
  width: number;
  height: number;
}

/** Downloads a file through the real export button and returns its bytes. */
async function exportFile(page: Page, kind: "png" | "svg"): Promise<{ name: string; bytes: Buffer }> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click(kind === "png" ? "#dl-png" : "#dl-svg"),
  ]);
  return { name: download.suggestedFilename(), bytes: readFileSync((await download.path())!) };
}

/** Decodes a QR file with jsQR inside the browser, reading the file exactly as it was exported. */
async function decodeFile(page: Page, bytes: Buffer, mime: string): Promise<Decoded> {
  await page.addScriptTag({ path: "node_modules/jsqr/dist/jsQR.js" });
  return page.evaluate(
    async ({ b64, mime }) => {
      const img = new Image();
      img.src = `data:${mime};base64,${b64}`;
      await img.decode();
      const side = 1000;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = side;
      const ctx = canvas.getContext("2d")!;
      // Composite onto white, like printing a transparent code on paper.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, side, side);
      ctx.drawImage(img, 0, 0, side, side);
      const { data } = ctx.getImageData(0, 0, side, side);
      const result = (window as any).jsQR(data, side, side);
      return {
        text: result ? new TextDecoder().decode(new Uint8Array(result.binaryData)) : null,
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    },
    { b64: bytes.toString("base64"), mime },
  );
}

/** Fraction of pixels that differ between the PNG and the SVG rasterized at the same size. */
async function pngVsSvgDiff(page: Page, png: Buffer, svg: Buffer, size: number): Promise<number> {
  return page.evaluate(
    async ({ png, svg, size }) => {
      const draw = async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = c.height = size;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0, size, size);
        return ctx.getImageData(0, 0, size, size).data;
      };
      const a = await draw(`data:image/png;base64,${png}`);
      const b = await draw(`data:image/svg+xml;base64,${svg}`);
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]) > 24) diff++;
      }
      return diff / (size * size);
    },
    { png: png.toString("base64"), svg: svg.toString("base64"), size },
  );
}

async function expectExportsDecodeTo(page: Page, expected: string, size = 2048) {
  const png = await exportFile(page, "png");
  const svg = await exportFile(page, "svg");
  expect(png.name).toMatch(/\.png$/);
  expect(svg.name).toMatch(/\.svg$/);

  const fromPng = await decodeFile(page, png.bytes, "image/png");
  expect(fromPng.text).toBe(expected);
  expect([fromPng.width, fromPng.height]).toEqual([size, size]);

  const fromSvg = await decodeFile(page, svg.bytes, "image/svg+xml");
  expect(fromSvg.text).toBe(expected);

  expect(await pngVsSvgDiff(page, png.bytes, svg.bytes, size)).toBeLessThan(0.001);
}

async function setValue(page: Page, selector: string, value: string) {
  await page.fill(selector, value);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#preview svg")).toBeVisible();
});

test("WhatsApp padrão: PNG e SVG decodificam no link original", async ({ page }) => {
  await expect(page.locator("#status")).toHaveText(/Pronto/);
  await expectExportsDecodeTo(page, DEFAULT_LINK);
});

test("Texto com acentos e emoji é preservado em UTF-8", async ({ page }) => {
  const text = "Ação, coração 💚 — ñ";
  await page.check('input[name=contentType][value=text]', { force: true });
  await setValue(page, "textarea[name=text]", text);
  await expectExportsDecodeTo(page, text);
});

test("URL é normalizada e exportada; resolução personalizada respeitada", async ({ page }) => {
  await page.check('input[name=contentType][value=url]', { force: true });
  await setValue(page, "input[name=url]", "exemplo.com/abc");
  await page.locator("input[name=size]").fill("1024");
  await expectExportsDecodeTo(page, "https://exemplo.com/abc", 1024);
});

test("Exportar imediatamente após editar usa o conteúdo mais recente", async ({ page }) => {
  await page.check('input[name=contentType][value=text]', { force: true });
  await setValue(page, "textarea[name=text]", "primeiro");
  await expect(page.locator("#status")).toHaveText(/Pronto/);
  // Edit and export in the same tick, before the next animation frame renders.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.evaluate(() => {
      const ta = document.querySelector<HTMLTextAreaElement>("textarea[name=text]")!;
      ta.value = "segundo";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector<HTMLButtonElement>("#dl-svg")!.click();
    }),
  ]);
  const bytes = readFileSync((await download.path())!);
  expect((await decodeFile(page, bytes, "image/svg+xml")).text).toBe("segundo");
});

test("Logo é otimizado, persiste entre sessões e o código continua legível", async ({ page }) => {
  await page.setInputFiles("input[name=logo]", {
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(LOGO_SVG),
  });
  await expect(page.locator("#logo-remove")).toBeVisible();
  await expect(page.locator("select[name=ecl]")).toHaveValue("H");
  await expectExportsDecodeTo(page, DEFAULT_LINK);

  await page.reload();
  await expect(page.locator("#logo-label")).toHaveText("logo.svg");
  await expect(page.locator("#logo-remove")).toBeVisible();
  const svg = await exportFile(page, "svg");
  expect(svg.bytes.toString()).toContain("<image");
  expect((await decodeFile(page, svg.bytes, "image/svg+xml")).text).toBe(DEFAULT_LINK);

  await page.click("#logo-remove");
  await page.reload();
  await expect(page.locator("#logo-remove")).toBeHidden();
});

test("Logo raster grande é reduzido antes de salvar", async ({ page }) => {
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = c.height = 3000;
    const ctx = c.getContext("2d")!;
    for (let i = 0; i < 3000; i += 10) {
      ctx.fillStyle = `hsl(${i % 360} 60% 50%)`;
      ctx.fillRect(i, 0, 10, 3000);
    }
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.setInputFiles("input[name=logo]", { name: "big.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await expect(page.locator("#logo-remove")).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("qr-studio:logo")!).data as string);
  const dims = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    return Math.max(img.naturalWidth, img.naturalHeight);
  }, stored);
  expect(dims).toBeLessThanOrEqual(768);
  await expectExportsDecodeTo(page, DEFAULT_LINK);
});

test("Restaurar preset volta ao estilo do preset selecionado", async ({ page }) => {
  const reset = page.locator("#preset-reset");
  await expect(reset).toBeDisabled();
  await page.locator("input[name=dotColor]").fill("#aa3300");
  await page.check('input[name=dotType][value=square]', { force: true });
  await expect(page.locator('input[name=preset][value=custom]')).toBeChecked();
  await expect(reset).toHaveText("Restaurar Wedding Sage");
  await reset.click();
  await expect(page.locator('input[name=preset][value=wedding]')).toBeChecked();
  await expect(page.locator("input[name=dotColor]")).toHaveValue("#627a61");
  await expect(page.locator('input[name=dotType][value=rounded]')).toBeChecked();
  await expect(reset).toBeDisabled();
});

test("Alertas de densidade, contraste e margem", async ({ page }) => {
  const warnings = page.locator("#warnings");
  await expect(page.locator("#qr-meta")).toHaveText(/\d+ × \d+ módulos/);

  // Default WhatsApp message is dense: at 3 cm the modules get too small.
  await page.check('input[name=printCm][value="3"]', { force: true });
  await expect(warnings).toContainText("Código denso");
  await page.check('input[name=printCm][value="5"]', { force: true });
  await expect(warnings).not.toContainText("Código denso");

  await page.locator("input[name=dotColor]").fill("#d8d8d0");
  await expect(warnings).toContainText("Pouco contraste");
  await page.locator("input[name=dotColor]").fill("#ffffff");
  await page.locator("input[name=bgColor]").fill("#000000");
  await expect(warnings).toContainText("QR invertido");
  await page.click("#preset-reset");
  await expect(warnings).toBeEmpty();

  await page.check('input[name=contentType][value=url]', { force: true });
  await setValue(page, "input[name=url]", "https://a.co");
  await page.locator("input[name=marginPct]").fill("2");
  await expect(warnings).toContainText("Margem de");
});

test("Fundo transparente: PNG com alpha, SVG sem fundo, preview quadriculado e persistência", async ({ page }) => {
  const toggle = page.locator("input[name=transparentBg]");
  expect((await exportFile(page, "svg")).bytes.toString()).toMatch(/clip-path-background-color/);

  await toggle.check();
  await expect(page.locator("#preview")).toHaveClass(/transparent/);
  await expect(page.locator("input[name=bgColor]")).toBeDisabled();
  await expect(page.locator("#warnings")).toContainText("Fundo transparente");
  await expectExportsDecodeTo(page, DEFAULT_LINK);

  const svg = (await exportFile(page, "svg")).bytes.toString();
  expect(svg).not.toMatch(/clip-path-background-color/);
  expect(svg).not.toMatch(/FAF9F5/i);
  // The checkerboard is CSS on the container only; the preview SVG itself has no background either.
  await expect(page.locator("#preview svg [id^=clip-path-background-color]")).toHaveCount(0);

  const png = (await exportFile(page, "png")).bytes;
  const alpha = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const corner = ctx.getImageData(5, 5, 1, 1).data[3];
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] === 255) opaque++;
    return { corner, opaque };
  }, png.toString("base64"));
  expect(alpha.corner).toBe(0); // quiet zone is kept, but transparent
  expect(alpha.opaque).toBeGreaterThan(0); // modules are still drawn

  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(page.locator("#preview")).toHaveClass(/transparent/);

  // Presets don't touch it; turning it off restores the background.
  await page.check('input[name=preset][value=minimal]', { force: true });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.locator("#preview")).not.toHaveClass(/transparent/);
  expect((await exportFile(page, "svg")).bytes.toString()).toMatch(/clip-path-background-color/);
});

test("Conteúdo longo demais bloqueia a exportação", async ({ page }) => {
  await page.check('input[name=contentType][value=text]', { force: true });
  await setValue(page, "textarea[name=text]", "x".repeat(4000));
  await expect(page.locator("#status")).toContainText("longo demais");
  await expect(page.locator("#dl-png")).toBeDisabled();
  await expect(page.locator("#dl-svg")).toBeDisabled();
});
