param(
  [Parameter(Position = 0)]
  [string]$PdfPath
)

$ErrorActionPreference = "Stop"
$readerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPath = Join-Path $readerDir "server.mjs"

$resolvedPdf = $null
if (-not [string]::IsNullOrWhiteSpace($PdfPath)) {
  $resolvedPdf = (Resolve-Path -LiteralPath $PdfPath).Path

  if ([IO.Path]::GetExtension($resolvedPdf) -ine ".pdf") {
    throw "Please choose a PDF file."
  }
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $nodePath = $nodeCommand.Source
} else {
  throw "Node.js was not found. Install Node.js 18 or newer and try again."
}

$nodeVersion = (& $nodePath --version).Trim().TrimStart("v")
if ([version]$nodeVersion -lt [version]"18.0.0") {
  throw "Node.js $nodeVersion was found, but version 18 or newer is required."
}

$portFile = Join-Path $env:TEMP ("pdf-flow-reader-{0}.json" -f [guid]::NewGuid().ToString("N"))
if ($resolvedPdf) {
  $argumentLine = '"{0}" "{1}" "{2}"' -f $serverPath, $resolvedPdf, $portFile
} else {
  $argumentLine = '"{0}" --port-file "{1}"' -f $serverPath, $portFile
}
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
