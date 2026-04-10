const express = require("express");
const multer = require("multer");
const fs = require("fs/promises");
const fssync = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const archiver = require("archiver");
const { PDFDocument } = require("pdf-lib");
const sharp = require("sharp");

const MAX_PDF_SIZE_MB = 500;
const MAX_PDF_SIZE_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024;

function createApp() {
  const app = express();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_PDF_SIZE_BYTES
    }
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/compress", upload.single("pdf"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Envie um arquivo PDF." });
    }

    const inputName = sanitizePdfName(req.file.originalname || "arquivo.pdf");

    try {
      const compressed = await compressPdfWithBestQuality(req.file.buffer);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${baseName(inputName)}-comprimido.pdf"`
      );
      return res.send(compressed);
    } catch (error) {
      return res.status(500).json({
        error:
          "Nao foi possivel comprimir o PDF. Verifique se o Ghostscript esta instalado no sistema."
      });
    }
  });

  app.post("/api/merge", upload.array("pdfs", 20), async (req, res) => {
    const files = req.files || [];
    if (!files.length || files.length < 2) {
      return res.status(400).json({ error: "Envie pelo menos 2 PDFs para juntar." });
    }

    try {
      const outputDoc = await PDFDocument.create();

      for (const file of files) {
        const doc = await PDFDocument.load(file.buffer);
        const pages = await outputDoc.copyPages(doc, doc.getPageIndices());
        for (const page of pages) outputDoc.addPage(page);
      }

      const mergedBytes = await outputDoc.save({ useObjectStreams: true });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="pdf-junto.pdf"');
      return res.send(Buffer.from(mergedBytes));
    } catch (error) {
      return res.status(500).json({ error: "Falha ao juntar PDFs." });
    }
  });

  app.post("/api/split", upload.single("pdf"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Envie um arquivo PDF." });
    }

    try {
      const sourceDoc = await PDFDocument.load(req.file.buffer);
      const pageCount = sourceDoc.getPageCount();
      const rangesInput = (req.body.ranges || "").trim();
      const ranges = rangesInput
        ? parsePageRanges(rangesInput, pageCount)
        : Array.from({ length: pageCount }, (_, i) => [i + 1, i + 1]);

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", () => {
        if (!res.headersSent) {
          res.status(500).json({ error: "Falha ao gerar ZIP de divisao." });
        }
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="pdf-dividido.zip"');
      archive.pipe(res);

      for (let i = 0; i < ranges.length; i += 1) {
        const [start, end] = ranges[i];
        const newDoc = await PDFDocument.create();
        const indexes = [];
        for (let p = start; p <= end; p += 1) indexes.push(p - 1);
        const pages = await newDoc.copyPages(sourceDoc, indexes);
        pages.forEach((page) => newDoc.addPage(page));
        const bytes = await newDoc.save({ useObjectStreams: true });

        archive.append(Buffer.from(bytes), {
          name: `${baseName(req.file.originalname || "arquivo.pdf")}-parte-${i + 1}.pdf`
        });
      }

      await archive.finalize();
      return undefined;
    } catch (error) {
      return res.status(400).json({
        error:
          "Falha ao dividir PDF. Confira os intervalos no formato 1-3,4-6 ou deixe vazio para separar pagina por pagina."
      });
    }
  });

  app.post("/api/images-to-pdf", upload.array("images", 100), async (req, res) => {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: "Envie ao menos uma imagem." });
    }

    try {
      const outputDoc = await PDFDocument.create();

      for (const file of files) {
        if (!String(file.mimetype || "").startsWith("image/")) {
          return res.status(400).json({
            error: `O arquivo "${file.originalname}" nao e uma imagem valida.`
          });
        }

        const pngBuffer = await normalizeImageBufferToPng(file.buffer, file.originalname);
        const image = await outputDoc.embedPng(pngBuffer);
        const page = outputDoc.addPage([image.width, image.height]);
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: image.width,
          height: image.height
        });
      }

      const pdfBytes = await outputDoc.save({ useObjectStreams: true });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="imagens-para-pdf.pdf"');
      return res.send(Buffer.from(pdfBytes));
    } catch (error) {
      return res.status(400).json({
        error:
          "Nao foi possivel converter uma ou mais imagens. Tente PNG/JPG/WebP/BMP/TIFF/GIF."
      });
    }
  });

  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: `Arquivo excede o limite de ${MAX_PDF_SIZE_MB} MB.`
        });
      }

      return res.status(400).json({
        error: "Falha no upload do arquivo. Tente novamente com um PDF valido."
      });
    }

    return res.status(500).json({
      error: "Ocorreu um erro inesperado no servidor."
    });
  });

  return app;
}

function startServer(port = 3000) {
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({ app, server, port: actualPort });
    });
  });
}

function baseName(fileName) {
  return fileName.replace(/\.pdf$/i, "");
}

function sanitizePdfName(name) {
  const cleaned = name.replace(/[^\w.\-() ]/g, "_");
  if (/\.pdf$/i.test(cleaned)) return cleaned;
  return `${cleaned}.pdf`;
}

function parsePageRanges(text, pageCount) {
  const chunks = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!chunks.length) throw new Error("sem faixas");

  return chunks.map((chunk) => {
    const parts = chunk.split("-").map((n) => n.trim());
    let start;
    let end;

    if (parts.length === 1) {
      start = Number(parts[0]);
      end = start;
    } else if (parts.length === 2) {
      start = Number(parts[0]);
      end = Number(parts[1]);
    } else {
      throw new Error("faixa invalida");
    }

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 1 ||
      end < 1 ||
      start > end ||
      end > pageCount
    ) {
      throw new Error("pagina fora do limite");
    }

    return [start, end];
  });
}

async function compressPdfWithBestQuality(inputBuffer) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-tools-"));
  const inputPath = path.join(tempRoot, "input.pdf");
  await fs.writeFile(inputPath, inputBuffer);

  const profiles = ["printer", "ebook", "screen"];
  const compressedCandidates = [];
  const gsExecutables = await findGhostscriptExecutables();

  if (!gsExecutables.length) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    throw new Error("ghostscript nao encontrado");
  }

  try {
    for (const executable of gsExecutables) {
      for (const profile of profiles) {
        const outputPath = path.join(
          tempRoot,
          `output-${path.basename(executable).replace(/\W+/g, "_")}-${profile}.pdf`
        );

        try {
          await runGhostscript(executable, inputPath, outputPath, profile);
          const data = await fs.readFile(outputPath);
          compressedCandidates.push(data);
        } catch {
          // Tenta proximo executavel/perfil sem interromper.
        }
      }
    }

    const originalSize = inputBuffer.length;
    const smaller = compressedCandidates
      .map((buffer) => ({ buffer, size: buffer.length }))
      .filter((item) => item.size < originalSize)
      .sort((a, b) => a.size - b.size);

    if (smaller.length) {
      // Retorna o menor arquivo gerado entre os perfis testados.
      return smaller[0].buffer;
    }

    const pdfDoc = await PDFDocument.load(inputBuffer);
    const fallback = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
    return Buffer.from(fallback);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function findGhostscriptExecutables() {
  const ordered = [];
  const seen = new Set();

  const envPath = process.env.GHOSTSCRIPT_PATH;
  if (envPath) pushCandidate(ordered, seen, envPath);

  // nomes que funcionam quando estao no PATH do processo Node.
  pushCandidate(ordered, seen, "gswin64c");
  pushCandidate(ordered, seen, "gswin64c.exe");
  pushCandidate(ordered, seen, "gswin32c");
  pushCandidate(ordered, seen, "gswin32c.exe");
  pushCandidate(ordered, seen, "gs");

  // caminhos comuns no Windows quando nao esta no PATH.
  const programFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
  for (const baseDir of programFiles) {
    const gsRoot = path.join(baseDir, "gs");
    if (!fssync.existsSync(gsRoot)) continue;

    let versionDirs = [];
    try {
      versionDirs = await fs.readdir(gsRoot, { withFileTypes: true });
    } catch {
      versionDirs = [];
    }

    const versions = versionDirs
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort(compareVersionNamesDesc);

    for (const version of versions) {
      pushCandidate(ordered, seen, path.join(gsRoot, version, "bin", "gswin64c.exe"));
      pushCandidate(ordered, seen, path.join(gsRoot, version, "bin", "gswin32c.exe"));
    }
  }

  return ordered.filter((candidate) => isLikelyUsablePath(candidate));
}

function pushCandidate(arr, seen, value) {
  if (!value || seen.has(value)) return;
  seen.add(value);
  arr.push(value);
}

function isLikelyUsablePath(candidate) {
  if (!candidate.includes("\\") && !candidate.includes("/")) return true;
  return fssync.existsSync(candidate);
}

function compareVersionNamesDesc(a, b) {
  const normalize = (v) => v.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const aa = normalize(a);
  const bb = normalize(b);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i += 1) {
    const av = aa[i] || 0;
    const bv = bb[i] || 0;
    if (av !== bv) return bv - av;
  }
  return 0;
}

function runGhostscript(executable, inputPath, outputPath, profile) {
  return new Promise((resolve, reject) => {
    const args = [
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      `-dPDFSETTINGS=/${profile}`,
      "-dNOPAUSE",
      "-dQUIET",
      "-dBATCH",
      `-sOutputFile=${outputPath}`,
      inputPath
    ];

    const child = spawn(executable, args, { windowsHide: true });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ghostscript falhou com codigo ${code}`));
    });
  });
}

async function normalizeImageBufferToPng(buffer, originalName) {
  try {
    return await sharp(buffer, { animated: false }).png().toBuffer();
  } catch {
    throw new Error(`imagem invalida: ${originalName}`);
  }
}

module.exports = { createApp, startServer };

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  startServer(port).then(({ port: activePort }) => {
    console.log(`Servidor ativo em http://localhost:${activePort}`);
  });
}
