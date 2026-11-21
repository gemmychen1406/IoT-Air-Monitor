[CmdletBinding()]
param(
  [ValidateSet('All', 'Temperature', 'Gas', 'Flame', 'Connectivity')]
  [string]$Scenario = 'All',
  [switch]$Provision,
  [string]$WebOrigin = 'http://127.0.0.1:5173',
  [string]$ApiUrl,
  [string]$EnvFile = (Join-Path ([System.IO.Path]::GetTempPath()) 'airguard-multi-device.env'),
  [string]$AdminEmail,
  [securestring]$AdminPassword
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$devices = [ordered]@{
  Temperature  = @{ Name = 'Demo - Nhiet do'; File = 'environment.json';   Room = 'Demo - Phong A' }
  Gas          = @{ Name = 'Demo - Gas';      File = 'gas-warning.json';  Room = 'Demo - Phong A' }
  Flame        = @{ Name = 'Demo - Lua';      File = 'incident.json';     Room = 'Demo - Phong B' }
  Connectivity = @{ Name = 'Demo - Ket noi';  File = 'connectivity.json'; Room = 'Demo - Phong B' }
}
$values = @{}
if (Test-Path -LiteralPath $EnvFile) {
  $values = ConvertFrom-StringData (Get-Content -LiteralPath $EnvFile -Raw)
}
if (!$ApiUrl) { $ApiUrl = $env:SIM_API_URL }
if (!$ApiUrl) { $ApiUrl = $values.SIM_API_URL }
if (!$ApiUrl) { $ApiUrl = 'http://127.0.0.1:4000' }

if ($Provision) {
  $web = [uri]$WebOrigin
  if (!$web.IsAbsoluteUri -or ($web.Scheme -ne 'https' -and !($web.Scheme -eq 'http' -and $web.IsLoopback))) {
    throw 'Use HTTPS or HTTP loopback for the admin login.'
  }
  $origin = $web.GetLeftPart([System.UriPartial]::Authority)
  if ($values.SIM_WEB_ORIGIN -and $values.SIM_WEB_ORIGIN -ne $origin) {
    throw 'The local credentials file belongs to another origin. Choose a new -EnvFile.'
  }
  $EnvFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($EnvFile)
  if (!(Test-Path -LiteralPath (Split-Path -Parent $EnvFile) -PathType Container)) {
    throw 'The parent directory of -EnvFile must exist.'
  }
  if (!$AdminEmail) { $AdminEmail = Read-Host 'AirGuard admin email' }
  if (!$AdminPassword) { $AdminPassword = Read-Host 'AirGuard admin password' -AsSecureString }
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $headers = @{ Origin = $origin; 'X-Requested-With' = 'AirGuard' }

  function Invoke-AirGuard([string]$Method, [string]$Path, [hashtable]$Payload) {
    $arguments = @{
      Method = $Method
      Uri = "$origin/api/v1$Path"
      Headers = $headers
      WebSession = $session
      MaximumRedirection = 0
    }
    if ($null -ne $Payload) {
      $arguments.ContentType = 'application/json'
      $arguments.Body = ConvertTo-Json $Payload -Compress
    }
    try { return (Invoke-RestMethod @arguments).data }
    catch {
      if ($_.Exception.Response) {
        $status = [int]$_.Exception.Response.StatusCode
        throw "AirGuard $Method ${Path} failed with HTTP $status."
      }
      throw "AirGuard $Method ${Path} failed. Check the web and API addresses."
    }
  }

  $login = Invoke-AirGuard POST '/auth/login' @{
    email = $AdminEmail
    password = [System.Net.NetworkCredential]::new('', $AdminPassword).Password
  }
  try {
    if ($login.user.role -ne 'admin') { throw 'Provisioning requires an AirGuard admin.' }
    $spaces = Invoke-AirGuard GET '/spaces'
    $areaName = 'Demo - AirGuard'
    $area = $spaces.areas | Where-Object { $_.name -eq $areaName } | Select-Object -First 1
    if (!$area) { $area = Invoke-AirGuard POST '/spaces/areas' @{ name = $areaName } }
    if ($area.archived_at) { throw 'Restore the archived demo area in AirGuard first.' }
    foreach ($roomName in @('Demo - Phong A', 'Demo - Phong B')) {
      $room = $spaces.rooms | Where-Object { $_.area_id -eq $area.id -and $_.name -eq $roomName } | Select-Object -First 1
      if (!$room) { $room = Invoke-AirGuard POST '/spaces/rooms' @{ area_id = $area.id; name = $roomName } }
      if ($room.archived_at) { throw "Restore archived room $roomName in AirGuard first." }
    }

    $values.SIM_WEB_ORIGIN = $origin
    $values.SIM_API_URL = $ApiUrl
    foreach ($name in $devices.Keys) {
      $prefix = 'SIM_' + $name.ToUpperInvariant()
      $idName = "${prefix}_DEVICE_ID"
      $keyName = "${prefix}_DEVICE_KEY"
      $entry = $devices[$name]
      if (!$values[$idName]) {
        $device = Invoke-AirGuard POST '/devices' @{ name = $entry.Name; source_kind = 'simulator' }
        $values[$idName] = $device.id
        $values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" } | Set-Content -LiteralPath $EnvFile -Encoding ASCII
      }
      if (!$values[$keyName]) {
        $credential = Invoke-AirGuard POST "/devices/$($values[$idName])/credentials" @{ label = 'AirGuard multi-device demo' }
        $values[$keyName] = $credential.key
        $values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" } | Set-Content -LiteralPath $EnvFile -Encoding ASCII
      }
      Write-Host "$($entry.Name) | $($values[$idName]) | assign in web to $($entry.Room)"
    }
    Write-Host "Credentials saved locally in $EnvFile"
  } finally {
    try { $null = Invoke-AirGuard POST '/auth/logout' @{} } catch {}
  }
  return
}

$selected = if ($Scenario -eq 'All') { $devices.Keys } else { @($Scenario) }
$targets = foreach ($name in $selected) {
  $prefix = 'SIM_' + $name.ToUpperInvariant()
  $idName = "${prefix}_DEVICE_ID"
  $keyName = "${prefix}_DEVICE_KEY"
  $id = [Environment]::GetEnvironmentVariable($idName)
  $key = [Environment]::GetEnvironmentVariable($keyName)
  if (!$id -and !$key) {
    $id = $values[$idName]
    $key = $values[$keyName]
  }
  if ($id -notmatch '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' -or $key -cnotmatch '^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$') {
    throw "Provide valid $idName and $keyName, or run with -Provision first."
  }
  [pscustomobject]@{ Name = $name; Id = $id; Key = $key; File = $devices[$name].File }
}
if (@($targets).Count -ne @($targets.Id | Sort-Object -Unique).Count -or
    @($targets).Count -ne @($targets.Key | Sort-Object -CaseSensitive -Unique).Count) {
  throw 'Each scenario needs its own device ID and DeviceKey.'
}

$node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$children = @()
try {
  foreach ($target in $targets) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $node
    $info.WorkingDirectory = $root
    $info.UseShellExecute = $false
    $info.Arguments = "--import tsx tools/device-simulator/src/main.ts --scenario-file tools/device-simulator/scenarios/$($target.File)"
    $info.EnvironmentVariables['SIM_DEVICE_ID'] = $target.Id
    $info.EnvironmentVariables['SIM_DEVICE_KEY'] = $target.Key
    $info.EnvironmentVariables['SIM_API_URL'] = $ApiUrl
    $children += [pscustomobject]@{ Name = $target.Name; Process = [System.Diagnostics.Process]::Start($info) }
    Write-Host "Started $($target.Name) | $($target.Id) | $($target.File)"
  }
  while ($true) {
    $running = $false
    foreach ($child in $children) {
      if (!$child.Process.HasExited) { $running = $true }
      elseif ($child.Process.ExitCode -ne 0) { throw "$($child.Name) exited with code $($child.Process.ExitCode)." }
    }
    if (!$running) { break }
    Start-Sleep -Milliseconds 300
  }
} finally {
  foreach ($child in $children) {
    if (!$child.Process.HasExited) { $child.Process.Kill() }
    $child.Process.Dispose()
  }
}
