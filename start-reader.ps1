param(
  [Parameter(Position = 0)]
  [string]$PdfPath
)

$ErrorActionPreference = "Stop"
$readerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPath = Join-Path $readerDir "server.mjs"

if ([string]::IsNullOrWhiteSpace($PdfPath)) {
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = "Choose a PDF"
  $dialog.Filter = "PDF files (*.pdf)|*.pdf"
  $dialog.CheckFileExists = $true
  $dialog.Multiselect = $false

  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    exit 0
  }

  $PdfPath = $dialog.FileName
}

$resolvedPdf = (Resolve-Path -LiteralPath $PdfPath).Path

if ([IO.Path]::GetExtension($resolvedPdf) -ne ".pdf") {
  throw "Please choose a PDF file."
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $nodePath = $nodeCommand.Source
} else {
  throw "Node.js was not found. Install Node.js 18 or newer and try again."
}

$portFile = Join-Path $env:TEMP ("pdf-flow-reader-{0}.json" -f [guid]::NewGuid().ToString("N"))
$argumentLine = '"{0}" "{1}" "{2}"' -f $serverPath, $resolvedPdf, $portFile
$serverProcess = Start-Process -FilePath $nodePath -ArgumentList $argumentLine -WindowStyle Hidden -PassThru

try {
  $deadline = (Get-Date).AddSeconds(12)
  while (-not (Test-Path -LiteralPath $portFile)) {
    if ($serverProcess.HasExited) {
      throw "The reader service stopped before it was ready."
    }
    if ((Get-Date) -gt $deadline) {
      throw "The reader took too long to start."
    }
    Start-Sleep -Milliseconds 100
  }

  $serverInfo = Get-Content -Raw -LiteralPath $portFile | ConvertFrom-Json
  if ($serverInfo.error) {
    throw $serverInfo.error
  }

  $readerUrl = "http://127.0.0.1:{0}/" -f $serverInfo.port
  Start-Process $readerUrl
} catch {
  if (-not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
  }
  throw
} finally {
  Remove-Item -LiteralPath $portFile -Force -ErrorAction SilentlyContinue
}
