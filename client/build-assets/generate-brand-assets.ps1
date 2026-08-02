param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$brandDirectory = Join-Path $PSScriptRoot '..\public\assets\brand'
$brandDirectory = [System.IO.Path]::GetFullPath($brandDirectory)
[System.IO.Directory]::CreateDirectory($brandDirectory) | Out-Null

$resolvedSource = (Resolve-Path -LiteralPath $SourcePath).Path
$source = [System.Drawing.Bitmap]::FromFile($resolvedSource)

function New-Canvas {
  param(
    [int]$Size,
    [System.Drawing.Color]$Background
  )

  $canvas = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  $graphics.Clear($Background)
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

  return @{ Bitmap = $canvas; Graphics = $graphics }
}

function Save-Png {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [string]$Name
  )

  $outputPath = Join-Path $brandDirectory $Name
  $Bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}

try {
  # Mantém uma cópia canônica e sem alterações da arte entregue.
  [System.IO.File]::Copy($resolvedSource, (Join-Path $brandDirectory 'vertice-symbol-transparent.png'), $true)

  # Recorte quadrado central para a marca ficar legível em cabeçalhos de 28–32 px.
  # O desenho permanece intacto; removemos apenas parte da área transparente externa.
  $uiSize = 512
  $cropSize = [Math]::Min(1000, [Math]::Min($source.Width, $source.Height))
  $cropX = [int](($source.Width - $cropSize) / 2)
  $cropY = [int](($source.Height - $cropSize) / 2)
  $ui = New-Canvas -Size $uiSize -Background ([System.Drawing.Color]::Transparent)
  try {
    $destination = New-Object System.Drawing.Rectangle(0, 0, $uiSize, $uiSize)
    $crop = New-Object System.Drawing.Rectangle($cropX, $cropY, $cropSize, $cropSize)
    $ui.Graphics.DrawImage($source, $destination, $crop, [System.Drawing.GraphicsUnit]::Pixel)
    Save-Png -Bitmap $ui.Bitmap -Name 'vertice-symbol-ui.png'
  }
  finally {
    $ui.Graphics.Dispose()
    $ui.Bitmap.Dispose()
  }

  # Ícones de navegador e atalhos precisam de fundo opaco (especialmente no iOS).
  # A área transparente original já posiciona todo o símbolo dentro da safe zone maskable.
  $background = [System.Drawing.ColorTranslator]::FromHtml('#0F141A')
  foreach ($size in @(16, 32, 48, 180, 192, 512)) {
    $icon = New-Canvas -Size $size -Background $background
    try {
      $destination = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
      $sourceRect = New-Object System.Drawing.Rectangle(0, 0, $source.Width, $source.Height)
      $icon.Graphics.DrawImage($source, $destination, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
      Save-Png -Bitmap $icon.Bitmap -Name "vertice-icon-$size.png"

      if ($size -eq 512) {
        Save-Png -Bitmap $icon.Bitmap -Name 'vertice-icon-512-maskable.png'
      }
    }
    finally {
      $icon.Graphics.Dispose()
      $icon.Bitmap.Dispose()
    }
  }
}
finally {
  $source.Dispose()
}
