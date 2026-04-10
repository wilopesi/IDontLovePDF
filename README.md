# Ferramentas PDF (Web)

Interface web simples com 4 opcoes:

- Comprimir PDF
- Dividir PDF
- Juntar PDFs
- Transformar imagens em PDF (PNG, JPG e outros formatos suportados)

## Requisitos

- Node.js 18+
- Ghostscript instalado no sistema (necessario para compressao com melhor resultado)

## Como rodar

```bash
npm install
npm start
```

Abra:

`http://localhost:3000`

## App Desktop (Windows .exe)

Para abrir como aplicativo (sem navegador):

```bash
npm install
npm run start:desktop
```

Para gerar instalador `.exe`:

```bash
npm install
npm run build:win
```

O instalador sera gerado na pasta `dist`.

## Observacao sobre compressao

A compressao tenta perfis de qualidade em ordem e retorna a melhor reducao de tamanho encontrada.  
Se o Ghostscript nao estiver disponivel, o servidor informa erro na operacao de compressao.

Caso o executavel nao esteja no PATH, voce pode definir manualmente:

```powershell
$env:GHOSTSCRIPT_PATH="C:\Program Files\gs\gs10.07.0\bin\gswin64c.exe"
npm start
```

Para o app desktop, a variavel pode ser definida antes de abrir o app:

```powershell
$env:GHOSTSCRIPT_PATH="C:\Program Files\gs\gs10.07.0\bin\gswin64c.exe"
npm run start:desktop
```
