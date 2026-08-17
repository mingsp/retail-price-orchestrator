[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot,

    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,

    [Parameter(Mandatory = $true)]
    [string]$VerifyExtractPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$source = [IO.Path]::GetFullPath($SourceRoot)
$archive = [IO.Path]::GetFullPath($ArchivePath)
$verify = [IO.Path]::GetFullPath($VerifyExtractPath)

if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    throw "Source directory does not exist: $source"
}

if (Test-Path -LiteralPath $archive) {
    throw "Archive already exists: $archive"
}

if (Test-Path -LiteralPath $verify) {
    throw "Verification directory already exists: $verify"
}

$archiveParent = Split-Path -Parent $archive
New-Item -ItemType Directory -Path $archiveParent -Force | Out-Null

$stream = [IO.File]::Open($archive, [IO.FileMode]::CreateNew)
try {
    $zip = [IO.Compression.ZipArchive]::new(
        $stream,
        [IO.Compression.ZipArchiveMode]::Create,
        $false,
        [Text.Encoding]::UTF8
    )
    try {
        Get-ChildItem -LiteralPath $source -Recurse -File |
            Sort-Object FullName |
            ForEach-Object {
                $relativePath = $_.FullName.Substring($source.Length).TrimStart('\').Replace('\', '/')
                [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $zip,
                    $_.FullName,
                    $relativePath,
                    [IO.Compression.CompressionLevel]::Optimal
                ) | Out-Null
            }
    }
    finally {
        $zip.Dispose()
    }
}
finally {
    $stream.Dispose()
}

[IO.Compression.ZipFile]::ExtractToDirectory($archive, $verify)

$sourceFiles = @(Get-ChildItem -LiteralPath $source -Recurse -File)
$verifiedFiles = @(Get-ChildItem -LiteralPath $verify -Recurse -File)
if ($sourceFiles.Count -ne $verifiedFiles.Count) {
    throw "Archive verification failed: source=$($sourceFiles.Count), extracted=$($verifiedFiles.Count)"
}

$manifestPath = Join-Path $verify 'SOURCE_MANIFEST.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'Archive verification failed: SOURCE_MANIFEST.json is missing'
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
[pscustomobject]@{
    archivePath = $archive
    archiveSize = (Get-Item -LiteralPath $archive).Length
    archiveSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    sourceFiles = $sourceFiles.Count
    extractedFiles = $verifiedFiles.Count
    manifestFiles = $manifest.fileCount
    sourceSha256 = $manifest.sourceSha256
    gitHead = $manifest.gitHead
} | ConvertTo-Json -Compress
