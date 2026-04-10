const compressForm = document.getElementById("compressForm");
const splitForm = document.getElementById("splitForm");
const mergeForm = document.getElementById("mergeForm");
const imagesToPdfForm = document.getElementById("imagesToPdfForm");

const compressStatus = document.getElementById("compressStatus");
const splitStatus = document.getElementById("splitStatus");
const mergeStatus = document.getElementById("mergeStatus");
const imagesToPdfStatus = document.getElementById("imagesToPdfStatus");

compressForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fileInput = document.getElementById("compressFile");
  if (!fileInput.files.length) return;

  setStatus(compressStatus, "Comprimindo PDF...", false);
  const data = new FormData();
  data.append("pdf", fileInput.files[0]);

  await handleDownloadRequest({
    endpoint: "/api/compress",
    formData: data,
    fileName: `${stripExt(fileInput.files[0].name)}-comprimido.pdf`,
    successEl: compressStatus,
    successMessage: "PDF comprimido com sucesso."
  });
});

splitForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fileInput = document.getElementById("splitFile");
  const rangesInput = document.getElementById("splitRanges");
  if (!fileInput.files.length) return;

  setStatus(splitStatus, "Dividindo PDF...", false);
  const data = new FormData();
  data.append("pdf", fileInput.files[0]);
  data.append("ranges", rangesInput.value || "");

  await handleDownloadRequest({
    endpoint: "/api/split",
    formData: data,
    fileName: `${stripExt(fileInput.files[0].name)}-dividido.zip`,
    successEl: splitStatus,
    successMessage: "PDF dividido com sucesso."
  });
});

mergeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const filesInput = document.getElementById("mergeFiles");
  if (filesInput.files.length < 2) {
    setStatus(mergeStatus, "Selecione ao menos 2 PDFs.", true);
    return;
  }

  setStatus(mergeStatus, "Juntando PDFs...", false);
  const data = new FormData();
  for (const file of filesInput.files) data.append("pdfs", file);

  await handleDownloadRequest({
    endpoint: "/api/merge",
    formData: data,
    fileName: "pdf-junto.pdf",
    successEl: mergeStatus,
    successMessage: "PDFs juntados com sucesso."
  });
});

imagesToPdfForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const filesInput = document.getElementById("imageFiles");
  if (!filesInput.files.length) {
    setStatus(imagesToPdfStatus, "Selecione ao menos uma imagem.", true);
    return;
  }

  setStatus(imagesToPdfStatus, "Convertendo imagens para PDF...", false);
  const data = new FormData();
  for (const file of filesInput.files) data.append("images", file);

  await handleDownloadRequest({
    endpoint: "/api/images-to-pdf",
    formData: data,
    fileName: "imagens-para-pdf.pdf",
    successEl: imagesToPdfStatus,
    successMessage: "PDF criado com sucesso."
  });
});

async function handleDownloadRequest({
  endpoint,
  formData,
  fileName,
  successEl,
  successMessage
}) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new Error(message || "Ocorreu um erro na operacao.");
    }

    const blob = await response.blob();
    triggerDownload(blob, fileName);
    setStatus(successEl, successMessage, false, true);
  } catch (error) {
    setStatus(successEl, error.message, true);
  }
}

function setStatus(element, text, isError, isSuccess = false) {
  element.textContent = text;
  element.classList.remove("error", "success");
  if (isError) element.classList.add("error");
  if (isSuccess) element.classList.add("success");
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function readErrorMessage(response) {
  const payload = await safeJson(response);
  if (payload.error) return payload.error;

  try {
    const text = await response.text();
    return text || "";
  } catch {
    return "";
  }
}

function stripExt(name) {
  return name.replace(/\.[^/.]+$/, "");
}
