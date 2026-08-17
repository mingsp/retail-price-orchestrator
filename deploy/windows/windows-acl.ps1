Set-StrictMode -Version Latest

function Protect-RetailRadarPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$Container
    )

    $rights = if ($Container) { '(OI)(CI)F' } else { 'F' }
    $grants = [Collections.Generic.List[string]]::new()
    $grants.Add("*S-1-5-18:$rights")
    $grants.Add("*S-1-5-32-544:$rights")

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $currentSid = if ($identity.User) { $identity.User.Value } else { '' }
    if ($currentSid -and $currentSid -notin @('S-1-5-18', 'S-1-5-32-544')) {
        $grants.Add("*${currentSid}:$rights")
    }

    & icacls.exe $Path /inheritance:r /grant:r $grants | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to protect path ACL: $Path" }
}
