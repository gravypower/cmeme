$modelUrl = "https://huggingface.co/ezioruan/inswapper_128.onnx/resolve/main/inswapper_128.onnx"
$modelsDir = "$PSScriptRoot\face_api\models"
$outputPath = "$modelsDir\inswapper_128.onnx"

# Create models dir if it doesn't exist
if (-not (Test-Path $modelsDir)) {
    New-Item -ItemType Directory -Path $modelsDir | Out-Null
    Write-Host "Created $modelsDir"
}

# Skip if already downloaded
if (Test-Path $outputPath) {
    Write-Host "inswapper_128.onnx already exists at $outputPath — skipping download."
    exit 0
}

Write-Host "Downloading inswapper_128.onnx (~500 MB) from HuggingFace..."
Write-Host "This may take a while depending on your connection speed.`n"

try {
    # Use BITS for a progress bar and resume support, fall back to Invoke-WebRequest
    if (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue) {
        Start-BitsTransfer -Source $modelUrl -Destination $outputPath -DisplayName "inswapper_128.onnx"
    } else {
        $ProgressPreference = 'Continue'
        Invoke-WebRequest -Uri $modelUrl -OutFile $outputPath
    }
    Write-Host "`n✅ Downloaded to: $outputPath"
} catch {
    Write-Error "❌ Download failed: $_"
    # Remove partial file if download failed
    if (Test-Path $outputPath) { Remove-Item $outputPath }
    exit 1
}
