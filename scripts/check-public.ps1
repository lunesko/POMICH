param(
    [Parameter(Mandatory = $true)]
    [string]$PublicUrl,

    [string]$ProviderId = "provider-oleksandr",
    [string]$SecondProviderId = "provider-mykhailo",
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
        [hashtable]$Headers = @{},
        [int[]]$ExpectedStatusCodes = @(200)
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

    try {
        $response = Invoke-WebRequest @params
        $statusCode = [int]$response.StatusCode
        $content = $response.Content
    } catch {
        if ($null -eq $_.Exception.Response) {
            throw
        }
        $errorResponse = $_.Exception.Response
        $statusCode = [int]$errorResponse.StatusCode
        if ($errorResponse -is [System.Net.Http.HttpResponseMessage]) {
            $content = $errorResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        } else {
            $reader = New-Object System.IO.StreamReader($errorResponse.GetResponseStream())
            try {
                $content = $reader.ReadToEnd()
            } finally {
                $reader.Dispose()
            }
        }
    }

    Write-Host "=> $statusCode"
    if ($ExpectedStatusCodes -notcontains $statusCode) {
        throw "Expected HTTP $($ExpectedStatusCodes -join ',') for $Method $url, got $statusCode. $content"
    }

    if ([string]::IsNullOrWhiteSpace($content)) {
        return $null
    }

    $content | ConvertFrom-Json
}

function New-ProviderSessionHeaders {
    param(
        [string]$SessionProviderId
    )

    $session = Invoke-JsonRequest `
        -Method "POST" `
        -Path "/api/auth/provider/session" `
        -Headers @{ "X-POMICH-Provider-Token" = $ProviderToken } `
        -Body @{ providerId = $SessionProviderId } `
        -ExpectedStatusCodes @(200)

    if (-not $session.accessToken) {
        throw "Provider session did not return an access token."
    }

    @{ Authorization = "Bearer $($session.accessToken)" }
}

function Set-ProviderOnline {
    param(
        [string]$OnlineProviderId,
        [hashtable]$Headers,
        [double]$Lat,
        [double]$Lng
    )

    $presence = Invoke-JsonRequest `
        -Method "PATCH" `
        -Path "/api/providers/$OnlineProviderId/presence" `
        -Headers $Headers `
        -Body @{
            status = "online"
            location = @{
                lat = $Lat
                lng = $Lng
            }
            etaMinutes = 8
        } `
        -ExpectedStatusCodes @(200)

    if ($presence.status -ne "online" -and $presence.status -ne "busy") {
        throw "Provider $OnlineProviderId did not go online."
    }
}

function Wait-ProviderOffer {
    param(
        [string]$OfferProviderId,
        [hashtable]$Headers,
        [string]$OrderId
    )

    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        $offers = @(Invoke-JsonRequest `
            -Method "GET" `
            -Path "/api/providers/$OfferProviderId/offers" `
            -Headers $Headers `
            -ExpectedStatusCodes @(200))
        $offer = $offers | Where-Object { $_.orderId -eq $OrderId } | Select-Object -First 1
        if ($offer) {
            return $offer
        }
        Start-Sleep -Seconds 1
    }

    throw "Provider $OfferProviderId did not receive an offer for order $OrderId."
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
    Write-Host "Non-mutating smoke check passed. Add -Mutating on staging to test provider sessions, dispatch, race conflict and lifecycle."
    exit 0
}

if (-not $ProviderToken) {
    throw "ProviderToken is required for mutating staging smoke."
}

$providerHeaders = New-ProviderSessionHeaders -SessionProviderId $ProviderId
$secondProviderHeaders = New-ProviderSessionHeaders -SessionProviderId $SecondProviderId

Set-ProviderOnline -OnlineProviderId $ProviderId -Headers $providerHeaders -Lat 50.4501 -Lng 30.5234
Set-ProviderOnline -OnlineProviderId $SecondProviderId -Headers $secondProviderHeaders -Lat 50.4503 -Lng 30.5236

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
    } `
    -ExpectedStatusCodes @(201)

if (-not $order.id) {
    throw "Order creation did not return an id."
}

$firstOffer = Wait-ProviderOffer -OfferProviderId $ProviderId -Headers $providerHeaders -OrderId $order.id
$secondOffer = Wait-ProviderOffer -OfferProviderId $SecondProviderId -Headers $secondProviderHeaders -OrderId $order.id

$accepted = Invoke-JsonRequest `
    -Method "POST" `
    -Path "/api/providers/$ProviderId/offers/$($firstOffer.id)/accept" `
    -Headers $providerHeaders `
    -ExpectedStatusCodes @(200)

if ($accepted.order.status -ne "assigned") {
    throw "Accepted order did not move to assigned."
}

$lost = Invoke-JsonRequest `
    -Method "POST" `
    -Path "/api/providers/$SecondProviderId/offers/$($secondOffer.id)/accept" `
    -Headers $secondProviderHeaders `
    -ExpectedStatusCodes @(409)

if ($lost.detail.code -ne "ORDER_ALREADY_ACCEPTED") {
    throw "Second provider did not receive ORDER_ALREADY_ACCEPTED."
}

foreach ($status in @("en_route", "arrived", "in_progress", "completed")) {
    $updatedOrder = Invoke-JsonRequest `
        -Method "PATCH" `
        -Path "/api/providers/$ProviderId/orders/$($order.id)/status" `
        -Headers $providerHeaders `
        -Body @{ status = $status } `
        -ExpectedStatusCodes @(200)

    if ($updatedOrder.status -ne $status) {
        throw "Order did not advance to $status."
    }
}

$loadedOrder = Invoke-JsonRequest -Method "GET" -Path "/api/orders/$($order.id)"
if ($loadedOrder.id -ne $order.id) {
    throw "Created order could not be loaded."
}
if ($loadedOrder.status -ne "completed") {
    throw "Created order did not finish completed."
}

Write-Host "Mutating smoke check passed. Completed order: $($order.id)"
