$p = "static\mixer.js"

$s = Get-Content $p -Raw

$old = @"
function ensureExportDestination() {
  ensureBuses();
  if (!mx.exportDestination) {
    mx.exportDestination = ac().createMediaStreamDestination();
    // This taps the existing Main bus. It does not replace or reroute the
    // existing destination, so normal playback remains untouched.
    mx.mainBusGain.connect(mx.exportDestination);
  }
  return mx.exportDestination;
}
"@

$new = @"
function ensureExportDestination() {
  ensureBuses();
  if (!mx.exportDestination) {
    mx.exportDestination = ac().createMediaStreamDestination();

    // Capture the existing mixer Main bus.
    mx.mainBusGain.connect(mx.exportDestination);

    // Also capture the existing main-song Web Audio source.
    // Do not create another MediaElementSource.
    if (window.signalLabMainSongSource) {
      window.signalLabMainSongSource.connect(mx.exportDestination);
    }
  }
  return mx.exportDestination;
}
"@

if (-not $s.Contains($old)) {
    Write-Host "ERROR: Target function not found. NO CHANGES MADE."
    exit 1
}

$s = $s.Replace($old, $new)

Set-Content -Path $p -Value $s -Encoding utf8

Write-Host "PATCH APPLIED SUCCESSFULLY"