Add-Type -AssemblyName System.Drawing
$iconOutput = Join-Path $PSScriptRoot '../assets'
New-Item -ItemType Directory -Force -Path $iconOutput | Out-Null
$bitmap = New-Object System.Drawing.Bitmap 256,256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)
$shape = New-Object System.Drawing.Drawing2D.GraphicsPath
$shape.AddArc(4,4,80,80,180,90)
$shape.AddArc(172,4,80,80,270,90)
$shape.AddArc(172,172,80,80,0,90)
$shape.AddArc(4,172,80,80,90,90)
$shape.CloseFigure()
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(43,102,81))
$graphics.FillPath($brush,$shape)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White),13
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$points = [System.Drawing.PointF[]]@((New-Object System.Drawing.PointF 45,132),(New-Object System.Drawing.PointF 82,132),(New-Object System.Drawing.PointF 106,73),(New-Object System.Drawing.PointF 139,185),(New-Object System.Drawing.PointF 163,126),(New-Object System.Drawing.PointF 208,126))
$graphics.DrawLines($pen,$points)
$pngPath = Join-Path $iconOutput 'icon.png'
$bitmap.Save($pngPath,[System.Drawing.Imaging.ImageFormat]::Png)
$bytes = [System.IO.File]::ReadAllBytes($pngPath)
$stream = [System.IO.File]::Create((Join-Path $iconOutput 'icon.ico'))
$writer = New-Object System.IO.BinaryWriter $stream
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$bytes.Length); $writer.Write([uint32]22); $writer.Write($bytes)
$writer.Close(); $graphics.Dispose(); $bitmap.Dispose(); $pen.Dispose(); $brush.Dispose(); $shape.Dispose()
