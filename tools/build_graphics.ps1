param(
    [string]$IconAtlas = "mods/starstone/art_source/starstone_icon_atlas_blue.png",
    [string]$BlockAtlas = "mods/starstone/art_source/starstone_block_atlas_blue.png",
    [string]$SurfaceIconAtlas = "mods/starstone/art_source/starstone_surface_icons_blue.png",
    [string]$SurfaceTextureAtlas = "mods/starstone/art_source/starstone_surface_textures_blue.png"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path  # workspace root
$resourcePack = Join-Path $workspace "mods/starstone/starstone_rp"
$itemOutput = Join-Path $resourcePack "textures/items"
$blockOutput = Join-Path $resourcePack "textures/blocks"

New-Item -ItemType Directory -Force $itemOutput, $blockOutput | Out-Null

function Export-AtlasCell {
    param(
        [Parameter(Mandatory)] [System.Drawing.Bitmap]$Atlas,
        [Parameter(Mandatory)] [int]$Column,
        [Parameter(Mandatory)] [int]$Row,
        [Parameter(Mandatory)] [int]$Columns,
        [Parameter(Mandatory)] [int]$Rows,
        [Parameter(Mandatory)] [int]$Size,
        [Parameter(Mandatory)] [string]$Destination
    )

    $x0 = [int][Math]::Round($Column * $Atlas.Width / $Columns)
    $x1 = [int][Math]::Round(($Column + 1) * $Atlas.Width / $Columns)
    $y0 = [int][Math]::Round($Row * $Atlas.Height / $Rows)
    $y1 = [int][Math]::Round(($Row + 1) * $Atlas.Height / $Rows)
    $sourceRect = [System.Drawing.Rectangle]::new($x0, $y0, $x1 - $x0, $y1 - $y0)

    $output = [System.Drawing.Bitmap]::new(
        $Size,
        $Size,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($output)
    try {
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
        $graphics.DrawImage(
            $Atlas,
            [System.Drawing.Rectangle]::new(0, 0, $Size, $Size),
            $sourceRect,
            [System.Drawing.GraphicsUnit]::Pixel
        )
    }
    finally {
        $graphics.Dispose()
    }

    $output.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    $output.Dispose()
}

$resolvedIconAtlas = (Resolve-Path (Join-Path $workspace $IconAtlas)).Path
$resolvedBlockAtlas = (Resolve-Path (Join-Path $workspace $BlockAtlas)).Path
$resolvedSurfaceIconAtlas = (Resolve-Path (Join-Path $workspace $SurfaceIconAtlas)).Path
$resolvedSurfaceTextureAtlas = (Resolve-Path (Join-Path $workspace $SurfaceTextureAtlas)).Path
$icons = [System.Drawing.Bitmap]::new($resolvedIconAtlas)
$blocks = [System.Drawing.Bitmap]::new($resolvedBlockAtlas)
$surfaceIcons = [System.Drawing.Bitmap]::new($resolvedSurfaceIconAtlas)
$surfaceTextures = [System.Drawing.Bitmap]::new($resolvedSurfaceTextureAtlas)

try {
    $iconCells = @(
        @{ Name = "starstone_dust.png"; Column = 0; Row = 0 },
        @{ Name = "starstone_crystal.png"; Column = 1; Row = 0 },
        @{ Name = "starstone_cable.png"; Column = 2; Row = 0 }
    )

    foreach ($cell in $iconCells) {
        Export-AtlasCell -Atlas $icons -Column $cell.Column -Row $cell.Row `
            -Columns 4 -Rows 2 -Size 32 -Destination (Join-Path $itemOutput $cell.Name)
    }

    $surfaceIconCells = @(
        @{ Name = "starstone_ore.png"; Column = 0; Row = 0 },
        @{ Name = "starstone_generator.png"; Column = 1; Row = 0 },
        @{ Name = "starstone_lamp.png"; Column = 2; Row = 0 },
        @{ Name = "starstone_redstone_input.png"; Column = 3; Row = 0 },
        @{ Name = "starstone_redstone_output.png"; Column = 0; Row = 1 },
        @{ Name = "starstone_bridge.png"; Column = 1; Row = 1 },
        @{ Name = "starstone_conduit.png"; Column = 2; Row = 1 }
    )

    foreach ($cell in $surfaceIconCells) {
        Export-AtlasCell -Atlas $surfaceIcons -Column $cell.Column -Row $cell.Row `
            -Columns 4 -Rows 2 -Size 32 -Destination (Join-Path $itemOutput $cell.Name)
    }

    $blockCells = @(
        @{ Name = "starstone_cable_off.png"; Column = 0; Row = 0 },
        @{ Name = "starstone_cable_on.png"; Column = 1; Row = 0 },
        @{ Name = "starstone_casing.png"; Column = 2; Row = 0 },
        @{ Name = "starstone_generator.png"; Column = 3; Row = 0 },
        @{ Name = "starstone_redstone_input.png"; Column = 2; Row = 1 },
        @{ Name = "starstone_redstone_output.png"; Column = 3; Row = 1 }
    )

    foreach ($cell in $blockCells) {
        Export-AtlasCell -Atlas $blocks -Column $cell.Column -Row $cell.Row `
            -Columns 4 -Rows 2 -Size 32 -Destination (Join-Path $blockOutput $cell.Name)
    }

    $surfaceTextureCells = @(
        @{ Name = "starstone_ore.png"; Column = 0; Row = 0 },
        @{ Name = "starstone_lamp_off.png"; Column = 2; Row = 0 },
        @{ Name = "starstone_lamp_on.png"; Column = 3; Row = 0 },
        @{ Name = "starstone_bridge.png"; Column = 2; Row = 1 },
        @{ Name = "starstone_conduit_end.png"; Column = 3; Row = 1 }
    )

    foreach ($cell in $surfaceTextureCells) {
        Export-AtlasCell -Atlas $surfaceTextures -Column $cell.Column -Row $cell.Row `
            -Columns 4 -Rows 2 -Size 32 -Destination (Join-Path $blockOutput $cell.Name)
    }
}
finally {
    $icons.Dispose()
    $blocks.Dispose()
    $surfaceIcons.Dispose()
    $surfaceTextures.Dispose()
}

Write-Output "Starstone graphics built in mods/starstone/starstone_rp"
foreach ($script in @("make_compressed_dust_icon.py", "make_inner_corner_icon.py", "make_power_state_textures.py", "make_pack_icons.py", "make_adapter_symbols.py", "make_cable_hub_textures.py")) {
    & python -B (Join-Path $PSScriptRoot $script)
    if ($LASTEXITCODE -ne 0) { throw "Could not export Starstone artwork: $script" }
}
