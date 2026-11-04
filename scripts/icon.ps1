$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDirectory = Join-Path $PSScriptRoot '../assets'
New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null
$bitmap = [System.Drawing.Bitmap]::new(256,256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(38,44,38))
$foreground = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(245,247,239))
$shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
$shape.AddArc(8,8,72,72,180,90)
$shape.AddArc(176,8,72,72,270,90)
$shape.AddArc(176,176,72,72,0,90)
$shape.AddArc(8,176,72,72,90,90)
$shape.CloseFigure()
$graphics.FillPath($background,$shape)
$font = [System.Drawing.Font]::new('Georgia',190,[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString('a',$font,$foreground,[System.Drawing.RectangleF]::new(0,-18,256,256),$format)
$stream = [System.IO.MemoryStream]::new()
$bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)
$png = $stream.ToArray()
$file = [System.IO.File]::Create((Join-Path $assetDirectory 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($file)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$png.Length); $writer.Write([uint32]22); $writer.Write($png)
$writer.Dispose(); $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $font.Dispose(); $background.Dispose(); $foreground.Dispose(); $shape.Dispose(); $format.Dispose()
