# Windows 缩略图批处理：一次 PowerShell 启动处理多张（单张启动约 1 秒，批量后每张约 70 毫秒）。
# 由 core/lib/thumbs.mjs 调用：
#   powershell -NoProfile -ExecutionPolicy Bypass -File resize-batch.ps1 -Jobs <json>
# JSON 形状： [{ "src": "C:\\a.png", "dst": "C:\\out.jpg" }, ...]
param(
  [Parameter(Mandatory = $true)][string]$Jobs
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$list = Get-Content -LiteralPath $Jobs -Raw -Encoding UTF8 | ConvertFrom-Json
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
if ($null -eq $codec) { throw 'no jpeg encoder' }

foreach ($job in $list) {
  $image = $null
  $bitmap = $null
  try {
    $image = [System.Drawing.Image]::FromFile($job.src)
    # 与 macOS `sips -Z` 对齐：约束最长边
    $ratio = [Math]::Min(1.0, [Math]::Min([double]$job.max / [double]$image.Width, [double]$job.max / [double]$image.Height))
    $width = [Math]::Max(1, [int][Math]::Round($image.Width * $ratio))
    $height = [Math]::Max(1, [int][Math]::Round($image.Height * $ratio))
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::White) # 透明 PNG 存 JPEG 会变黑底
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($image, 0, 0, $width, $height)
    } finally {
      $graphics.Dispose()
    }
    $parameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]72)
    $bitmap.Save($job.dst, $codec, $parameters)
  } catch {
    # 单张失败不影响整批：调用方按「输出文件是否存在」判定结果
    Write-Output ("ERR " + $job.src + " :: " + $_.Exception.Message)
  } finally {
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    if ($null -ne $image) { $image.Dispose() }
  }
}
