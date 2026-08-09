$p = "static\app.js"

$s = Get-Content $p -Raw

$old = '  const source = ctx.createMediaElementSource(state.htmlAudio);'

$new = @'
  const source = ctx.createMediaElementSource(state.htmlAudio);
  window.signalLabMainSongSource = source;
'@

if (-not $s.Contains($old)) {
    Write-Host "ERROR: Target line not found. NO CHANGES MADE."
    exit 1
}

if ($s.Contains("window.signalLabMainSongSource = source;")) {
    Write-Host "Main song source is already exposed. NO CHANGES MADE."
    exit 0
}

$s = $s.Replace($old, $new)

Set-Content -Path $p -Value $s -Encoding utf8

Write-Host "PATCH APPLIED SUCCESSFULLY"