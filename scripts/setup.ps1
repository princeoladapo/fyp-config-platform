<#
.SYNOPSIS
  Sets up the local environment for the configuration validation platform.

.DESCRIPTION
  Checks the prerequisites, creates the kind cluster, loads the application
  images, applies the sample manifests and the read-only RBAC, creates the
  fyp-readonly kubeconfig context, starts PostgreSQL, installs packages,
  applies the database migrations and runs the demo.

  Safe to re-run: every step checks what already exists and skips or repeats
  harmlessly. If the script stops, fix the problem it names and run it again.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#>
[CmdletBinding()]
param(
    [string]$PostgresContainer = 'fyp-postgres',
    [string]$PostgresVolume    = 'fyp-postgres-data',
    [string]$PostgresImage     = 'postgres:18',
    [string]$BaseImage         = 'nginxinc/nginx-unprivileged:1.31',
    [int]$TokenHours           = 720
)

# Native tools (docker, kind, kubectl, npm) report failure through exit codes,
# which are checked explicitly. 'Stop' would also turn harmless stderr output
# into errors in Windows PowerShell 5.1.
$ErrorActionPreference = 'Continue'

$ClusterName     = 'fyp-cluster'
$AdminContext    = "kind-$ClusterName"
$NodeContainer   = "$ClusterName-control-plane"
$ReadOnlyContext = 'fyp-readonly'
$ReadOnlyUser    = 'config-validator'
$Namespaces      = @('development', 'staging', 'production')
$TotalSteps      = 10

$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot

# ---------------------------------------------------------------- helpers

function Write-Step([int]$Number, [string]$Text) {
    Write-Host ''
    Write-Host "[$Number/$TotalSteps] $Text" -ForegroundColor Cyan
}

function Write-Ok([string]$Text)   { Write-Host "  OK    $Text" -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host "        $Text" }

function Stop-Setup([string]$Message) {
    Write-Host ''
    Write-Host 'SETUP STOPPED' -ForegroundColor Red
    Write-Host $Message -ForegroundColor Red
    Write-Host ''
    Write-Host 'Fix the problem above, then run the script again. Finished steps are skipped.'
    Pop-Location
    exit 1
}

# Runs a native command and stops the script if it fails.
function Invoke-Checked([string]$What, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { Stop-Setup "$What failed (exit code $LASTEXITCODE). See the output above." }
}

# Runs a native command, hides its error output, and returns stdout (or $null on failure).
function Get-Quiet([scriptblock]$Command) {
    $out = & $Command 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return $out
}

# Runs a native command quietly and returns $true if it exited with code 0.
function Test-Succeeds([scriptblock]$Command) {
    & $Command 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Test-Command([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-Version([string]$Text) {
    if ($Text -match '(\d+)\.(\d+)\.(\d+)') {
        return [version]"$($matches[1]).$($matches[2]).$($matches[3])"
    }
    return $null
}

# ---------------------------------------------------------------- 1. prerequisites

Write-Step 1 'Checking prerequisites'

if ($env:OS -ne 'Windows_NT') { Stop-Setup 'This script is for Windows 11.' }

$problems = New-Object System.Collections.Generic.List[string]
$reopen = 'After installing, close this window, open a new one, and run the script again.'

# WSL 2
$env:WSL_UTF8 = '1'   # makes wsl.exe print plain text instead of UTF-16
$wslList = $null
if (Test-Command 'wsl') { $wslList = Get-Quiet { wsl -l -v } }
if (-not $wslList -or -not ($wslList | Where-Object { $_ -match '\s2\s*$' })) {
    $problems.Add("WSL 2 is not installed or has no WSL 2 distribution.`n    Install: open PowerShell as Administrator, run 'wsl --install', then restart Windows.")
} else {
    Write-Ok 'WSL 2'
}

# Git
$gitVersion = $null
if (Test-Command 'git') { $gitVersion = Get-Version (Get-Quiet { git --version } | Out-String) }
if (-not $gitVersion) {
    $problems.Add("Git is not installed.`n    Install: winget install --id Git.Git -e`n    $reopen")
} elseif ($gitVersion -lt [version]'2.30.0') {
    $problems.Add("Git $gitVersion is too old (need 2.30 or newer).`n    Update: winget upgrade --id Git.Git -e")
} else {
    Write-Ok "Git $gitVersion"
}

# Docker Desktop, installed and running
$dockerArch = $null
if (-not (Test-Command 'docker')) {
    $problems.Add("Docker Desktop is not installed.`n    Install: winget install --id Docker.DockerDesktop -e`n    Then start Docker Desktop once and accept its terms. $reopen")
} else {
    $serverInfo = Get-Quiet { docker version --format '{{.Server.Version}} {{.Server.Arch}}' }
    if (-not $serverInfo) {
        $problems.Add("Docker Desktop is installed but not running.`n    Start Docker Desktop from the Start menu, wait until it shows 'Engine running', then run the script again.")
    } else {
        $parts = ("$serverInfo").Trim().Split(' ')
        $dockerArch = $parts[1]
        Write-Ok "Docker Engine $($parts[0]) ($dockerArch)"
    }
}

# kind
$kindVersion = $null
if (Test-Command 'kind') { $kindVersion = Get-Version (Get-Quiet { kind version } | Out-String) }
if (-not $kindVersion) {
    $problems.Add("kind is not installed.`n    Install: winget install --id Kubernetes.kind -e`n    $reopen")
} elseif ($kindVersion -lt [version]'0.33.0') {
    $problems.Add("kind $kindVersion is too old (need 0.33.0 or newer for the pinned node image).`n    Update: winget upgrade --id Kubernetes.kind -e")
} else {
    Write-Ok "kind $kindVersion"
}

# kubectl
$kubectlVersion = $null
if (Test-Command 'kubectl') {
    $json = Get-Quiet { kubectl version --client -o json }
    if ($json) { $kubectlVersion = Get-Version (($json | Out-String | ConvertFrom-Json).clientVersion.gitVersion) }
}
if (-not $kubectlVersion) {
    $problems.Add("kubectl is not installed.`n    Install: winget install --id Kubernetes.kubectl -e`n    $reopen")
} elseif ($kubectlVersion -lt [version]'1.36.0') {
    $problems.Add("kubectl $kubectlVersion is too old (need 1.36 or newer; the cluster runs 1.37).`n    Update: winget upgrade --id Kubernetes.kubectl -e")
} else {
    Write-Ok "kubectl $kubectlVersion"
}

# Node.js
$nodeVersion = $null
if (Test-Command 'node') { $nodeVersion = Get-Version (Get-Quiet { node --version } | Out-String) }
if (-not $nodeVersion) {
    $problems.Add("Node.js is not installed.`n    Install: winget install --id OpenJS.NodeJS.22 -e`n    $reopen")
} elseif ($nodeVersion -lt [version]'22.19.0') {
    $problems.Add("Node.js $nodeVersion is too old (need 22.19 or newer).`n    Update: winget install --id OpenJS.NodeJS.22 -e`n    $reopen")
} elseif (-not (Test-Command 'npm')) {
    $problems.Add("npm was not found, although Node.js is installed. Reinstall Node.js: winget install --id OpenJS.NodeJS.22 -e")
} else {
    Write-Ok "Node.js $nodeVersion"
}

if ($problems.Count -gt 0) {
    $list = ($problems | ForEach-Object { "  - $_" }) -join "`n"
    Stop-Setup "Missing or outdated prerequisites:`n$list"
}

switch ($dockerArch) {
    'amd64'   { $platform = 'linux/amd64' }
    'x86_64'  { $platform = 'linux/amd64' }
    'arm64'   { $platform = 'linux/arm64' }
    'aarch64' { $platform = 'linux/arm64' }
    default   { Stop-Setup "Unsupported Docker architecture '$dockerArch'. Only amd64 and arm64 are supported." }
}

# ---------------------------------------------------------------- 2. cluster

Write-Step 2 "Creating the kind cluster '$ClusterName'"

$clusters = Get-Quiet { kind get clusters }
if ($clusters -contains $ClusterName) {
    $state = Get-Quiet { docker inspect $NodeContainer --format '{{.State.Status}}' }
    if ("$state".Trim() -ne 'running') {
        Write-Info 'Cluster exists but its node is stopped; starting it.'
        Invoke-Checked 'Starting the cluster node' { docker start $NodeContainer | Out-Null }
    }
    Write-Ok 'Cluster already exists.'
} else {
    Invoke-Checked 'Creating the kind cluster' { kind create cluster --config k8s/kind-config.yaml --wait 180s }
    Write-Ok 'Cluster created.'
}

# The kubeconfig entry can be missing if the cluster was created on another account.
$contexts = Get-Quiet { kubectl config get-contexts -o name }
if (-not ($contexts -contains $AdminContext)) {
    Invoke-Checked 'Exporting the cluster kubeconfig' { kind export kubeconfig --name $ClusterName }
}

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    if ((Get-Quiet { kubectl get --raw /readyz --context $AdminContext }) -eq 'ok') { $ready = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $ready) { Stop-Setup 'The cluster API did not become ready within 2 minutes. Restart Docker Desktop and try again.' }
Write-Ok "Cluster API is ready (context $AdminContext)."

# ---------------------------------------------------------------- 3. images

Write-Step 3 "Loading application images into kind ($platform)"

# The image names come from the manifests, so they stay in step with them.
$appImages = Get-ChildItem sample-config/environments -Recurse -Include *.yaml, *.yml |
    Select-String -Pattern '^\s*image:\s*["'']?([^"''\s]+)' |
    ForEach-Object { $_.Matches[0].Groups[1].Value } |
    Sort-Object -Unique
if (-not $appImages) { Stop-Setup 'No image names found in sample-config/environments.' }

$missingInCluster = @()
foreach ($image in $appImages) {
    if (-not (Test-Succeeds { docker exec $NodeContainer crictl inspecti $image })) { $missingInCluster += $image }
}

if ($missingInCluster.Count -eq 0) {
    Write-Ok "Already loaded: $($appImages -join ', ')"
} else {
    Invoke-Checked "Pulling $BaseImage" { docker pull --platform $platform $BaseImage }
    foreach ($image in $appImages) {
        Invoke-Checked "Tagging $image" { docker tag $BaseImage $image }
    }
    # 'kind load docker-image' fails on Docker Desktop's containerd image store
    # (content digest not found), so export one platform to an archive and load that.
    $archive = Join-Path $env:TEMP "fyp-web-app-images-$PID.tar"
    try {
        Invoke-Checked 'Exporting images' { docker save --platform $platform -o $archive @appImages }
        Invoke-Checked 'Loading images into kind' { kind load image-archive $archive --name $ClusterName }
    } finally {
        Remove-Item $archive -ErrorAction SilentlyContinue
    }
    Write-Ok "Loaded: $($appImages -join ', ')"
}

# ---------------------------------------------------------------- 4. namespaces and manifests

Write-Step 4 'Creating namespaces and applying the sample manifests'

foreach ($ns in $Namespaces) {
    Invoke-Checked "Creating namespace $ns" {
        kubectl create namespace $ns --dry-run=client -o yaml | kubectl apply --context $AdminContext -f - | Out-Null
    }
    Invoke-Checked "Applying manifests to $ns" {
        kubectl apply --context $AdminContext -n $ns -f "sample-config/environments/$ns/"
    }
}
foreach ($ns in $Namespaces) {
    Invoke-Checked "Waiting for deployments in $ns" {
        kubectl wait --context $AdminContext -n $ns --for=condition=Available deployment --all --timeout=180s
    }
}
Write-Ok 'All deployments are available.'

# ---------------------------------------------------------------- 5. RBAC

Write-Step 5 'Applying the read-only service account (k8s/rbac.yaml)'
Invoke-Checked 'Applying k8s/rbac.yaml' { kubectl apply --context $AdminContext -f k8s/rbac.yaml }
Write-Ok 'ServiceAccount, Roles and RoleBindings are in place.'

# ---------------------------------------------------------------- 6. token and context

Write-Step 6 "Creating the read-only token and the '$ReadOnlyContext' context"

# A new token is issued on every run; this also renews an expiring one.
$token = Get-Quiet { kubectl create token $ReadOnlyUser -n config-validator --duration="$($TokenHours)h" --context $AdminContext }
if (-not $token) { Stop-Setup 'Could not create a token for the config-validator service account.' }
Invoke-Checked 'Saving the token in kubeconfig' { kubectl config set-credentials $ReadOnlyUser "--token=$token" | Out-Null }
Invoke-Checked "Creating context $ReadOnlyContext" {
    kubectl config set-context $ReadOnlyContext --cluster=$AdminContext --user=$ReadOnlyUser | Out-Null
}
$token = $null

$canList   = "$(Get-Quiet { kubectl auth can-i list deployments -n production --context $ReadOnlyContext })".Trim()
$canDelete = "$(kubectl auth can-i delete deployments -n production --context $ReadOnlyContext 2>$null)".Trim()
if ($canList -ne 'yes' -or $canDelete -ne 'no') {
    Stop-Setup "The read-only context is not set up correctly (list=$canList, delete=$canDelete; expected yes/no)."
}
Write-Ok "Context $ReadOnlyContext can list deployments and cannot delete them. Token valid for $TokenHours hours."

# ---------------------------------------------------------------- 7. PostgreSQL

Write-Step 7 "Starting PostgreSQL ($PostgresContainer)"

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
if (-not (Test-Path .env)) {
    if (-not (Test-Path .env.example)) { Stop-Setup '.env.example is missing from the repository.' }
    $bytes = New-Object byte[] 18
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $password = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
    $text = [System.IO.File]::ReadAllText((Join-Path $RepoRoot '.env.example')).Replace('CHANGE_ME', $password)
    [System.IO.File]::WriteAllText((Join-Path $RepoRoot '.env'), $text, $utf8NoBom)
    Write-Ok 'Created .env with a random database password.'
} else {
    Write-Ok '.env already exists; keeping it.'
}

$urlLine = Get-Content .env | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
if ($urlLine -notmatch 'postgres(?:ql)?://([^:/@]+):([^@]+)@([^:/]+):(\d+)/([^?"\s]+)') {
    Stop-Setup '.env has no DATABASE_URL in the form postgresql://user:password@localhost:5432/database'
}
$dbUser = $matches[1]; $dbPassword = $matches[2]; $dbHost = $matches[3]; $dbPort = [int]$matches[4]; $dbName = $matches[5]
if ($dbPassword -eq 'CHANGE_ME') { Stop-Setup 'Replace CHANGE_ME in .env with a password (or delete .env and the script will create one).' }

if ($dbHost -notin @('localhost', '127.0.0.1')) {
    Write-Info "DATABASE_URL points at $dbHost, not this machine; skipping the local container."
} else {
    $state = "$(Get-Quiet { docker ps -a --filter "name=^/$PostgresContainer$" --format '{{.State}}' })".Trim()
    if ($state -eq 'running') {
        Write-Ok 'Container is already running.'
    } elseif ($state) {
        Invoke-Checked "Starting container $PostgresContainer" { docker start $PostgresContainer | Out-Null }
        Write-Ok 'Started the existing container.'
    } else {
        if (Get-NetTCPConnection -LocalPort $dbPort -State Listen -ErrorAction SilentlyContinue) {
            Stop-Setup "Port $dbPort is already in use by another program. Stop it, or change the port in DATABASE_URL in .env."
        }
        Invoke-Checked "Creating container $PostgresContainer" {
            docker run -d --name $PostgresContainer `
                -e "POSTGRES_USER=$dbUser" -e "POSTGRES_PASSWORD=$dbPassword" -e "POSTGRES_DB=$dbName" `
                -p "$($dbPort):5432" -v "$($PostgresVolume):/var/lib/postgresql" `
                --restart unless-stopped $PostgresImage | Out-Null
        }
        Write-Ok "Created container from $PostgresImage (data in volume $PostgresVolume)."
    }

    # Checking over TCP avoids a false 'ready' while the image is still initialising.
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        if (Test-Succeeds { docker exec $PostgresContainer pg_isready -h 127.0.0.1 -U $dbUser -d $dbName }) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { Stop-Setup "PostgreSQL did not become ready. Check: docker logs $PostgresContainer" }
    Write-Ok "PostgreSQL is accepting connections on port $dbPort."
}

# ---------------------------------------------------------------- 8. npm

Write-Step 8 'Installing Node packages (npm ci)'
# npm ci installs exactly what package-lock.json lists and never changes it.
Invoke-Checked 'npm ci' { npm ci --no-audit --no-fund }
Write-Ok 'Packages installed.'

# ---------------------------------------------------------------- 9. Prisma

Write-Step 9 'Applying database migrations and generating the Prisma client'
# migrate deploy only applies committed migrations; it never creates new ones or resets data.
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
    Stop-Setup ("Database migration failed. If the error mentions authentication, the password in .env " +
        "does not match the one the $PostgresContainer container was created with.")
}
Invoke-Checked 'prisma generate' { npx prisma generate }
Write-Ok 'Database schema is up to date.'

# ---------------------------------------------------------------- 10. demo

Write-Step 10 'Running the demo'
$output = npx tsx src/demo.ts
$demoExit = $LASTEXITCODE
$output | ForEach-Object { Write-Host "        $_" }
if ($demoExit -ne 0) { Stop-Setup 'The demo failed to run. See the output above.' }
if (-not ($output -contains 'CONSISTENT: no violations found.')) {
    Stop-Setup 'The demo ran but reported findings. The baseline should have zero; check the output above.'
}

Write-Host ''
Write-Host 'SETUP COMPLETE: the demo reports zero findings.' -ForegroundColor Green
Write-Host "Run the demo any time with: npx tsx src/demo.ts"
Pop-Location
exit 0
