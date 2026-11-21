# QR Studio

Gerador de QR Codes personalizados que roda 100% no navegador — sem backend, sem rastreamento, sem serviços externos.

## Rodar

```bash
npm install
npm run dev
```

Abra o endereço exibido no terminal (normalmente http://localhost:5173).

Build de produção (funciona offline, basta servir a pasta `dist/`):

```bash
npm run build
npm run preview
```

## Testes

```bash
npm test
```

Teste ponta a ponta (Playwright) que gera o build, clica em **Baixar PNG/SVG**, decodifica os arquivos baixados com jsQR e compara com o conteúdo original. Também confere que o PNG é idêntico ao SVG rasterizado, a persistência do logo, os alertas, a restauração de preset, o fundo transparente e os links de compartilhamento (inclusive links adulterados). Usa o Microsoft Edge instalado (sem download de navegador); para outro navegador: `PW_CHANNEL=chrome npm test`.

`npm run typecheck` roda o TypeScript em modo estrito (o projeto não tem linter separado).

## Recursos

- Conteúdo: URL, WhatsApp (`https://wa.me/NUMERO?text=MENSAGEM`) ou texto livre (UTF-8, aceita acentos e emoji)
- Presets Wedding Sage, Minimal Black e Custom; cores, estilo dos módulos, marcadores e pontos internos
- Logo central opcional (upload local; força correção de erros H). Imagens raster são reduzidas para no máx. 768 px e o logo fica salvo entre sessões; SVGs pequenos ficam vetoriais
- Exportação PNG (até 4096 px, padrão 2048) e SVG vetorial — o PNG é rasterizado do mesmo SVG do preview
- Contagem de módulos e alertas de densidade (módulo < 0,4 mm no tamanho impresso), contraste baixo, QR invertido e margem < 4 módulos
- Visualização de impressão em 3, 4 e 5 cm (escala na tela aproximada; não altera a exportação)
- Botão para restaurar o preset selecionado
- Preferências e logo salvos no `localStorage`
- Fundo transparente opcional (PNG com canal alpha, SVG sem fundo); o preview mostra um quadriculado que não vai para o arquivo
- **Compartilhar link**: copia um link com todas as configurações (inclusive o logo, reduzido para 256 px) compactadas depois do `#`. O trecho após o `#` não é enviado ao servidor, então nada fica guardado em lugar nenhum. Abrir o link em outro navegador restaura tudo; se já houver configurações salvas, o app pergunta antes de substituí-las. Os dados do link são validados antes de usar

## Estrutura

- `src/state.ts` — estado, presets e persistência
- `src/content.ts` — montagem e validação do conteúdo, geometria e alertas de impressão
- `src/logo.ts` — otimização e persistência do logo
- `src/share.ts` — links de compartilhamento (codificação, validação e leitura)
- `src/main.ts` — interface, renderização (`qr-code-styling`) e exportação
- `src/style.css` — estilos
- `tests/export.spec.ts` — teste de decodificação dos arquivos exportados
