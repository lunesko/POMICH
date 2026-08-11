param(
    [Parameter(Mandatory = $true)]
    [string]$PublicUrl,

    [string]$ProviderId = "provider-oleksandr",
    [string]$ProviderToken = "",
    [switch]$Mutating
)

$ErrorActionPreference = "Stop"

$baseUrl = $PublicUrl.TrimEnd("/")
if ($baseUrl -match "localhost|127\.0\.0\.1") {
    throw "PublicUrl must be a public origin, not localhost."
}

function Invoke-JsonRequest {
    param(
        [string]$Method,
        [string]$Path,
        [object]$Body = $null,
        [hashtable]$Headers = @{}
    )

    $url = "$baseUrl$Path"
    Write-Host "$Method $url"

    $params = @{
        Method = $Method
        Uri = $url
        Headers = $Headers
    }

    if ($null -ne $Body) {
        $params.ContentType = "application/json"
        $params.Body = ($Body | ConvertTo-Json -Depth 10)
    }

    Invoke-RestMethod @params
}

$health = Invoke-JsonRequest -Method "GET" -Path "/api/health"
if ($health.status -ne "ok") {
    throw "Health check failed."
}

$providers = Invoke-JsonRequest -Method "GET" -Path "/api/providers"
if ($null -eq $providers) {
    throw "Providers response is empty."
}

Write-Host "Providers returned: $($providers.Count)"

if (-not $Mutating) {
    Write-Host "Non-mutating smoke check passed. Add -Mutating on staging to test partner heartbeat and order creation."
    exit 0
}

$headers = @{}
if ($ProviderToken) {
    $headers["X-POMICH-Provider-Token"] = $ProviderToken
}

$presence = Invoke-JsonRequest `
    -Method "PATCH" `
    -Path "/api/providers/$ProviderId/presence" `
    -Headers $headers `
    -Body @{
        status = "online"
        location = @{
            lat = 50.4501
            lng = 30.5234
        }
        etaMinutes = 8
    }

if ($presence.status -ne "online" -and $presence.status -ne "busy") {
    throw "Provider did not go online."
}

$order = Invoke-JsonRequest `
    -Method "POST" `
    -Path "/api/orders" `
    -Body @{
        source = "public-smoke"
        service = "tow"
        customerLocation = "Smoke test Kyiv"
        customerCoordinates = @{
            lat = 50.4502
            lng = 30.5235
        }
        destination = "Smoke test destination"
        destinationCoordinates = @{
            lat = 50.455
            lng = 30.530
        }
        distanceKm = 2.4
        status = "searching"
    }

if (-not $order.id) {
    throw "Order creation did not return an id."
}

$loadedOrder = Invoke-JsonRequest -Method "GET" -Path "/api/orders/$($order.id)"
if ($loadedOrder.id -ne $order.id) {
    throw "Created order could not be loaded."
}

Write-Host "Mutating smoke check passed. Created order: $($order.id)"
