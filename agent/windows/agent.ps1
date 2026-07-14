#same backend willl work

param(
    [string]$BackendUrl = "http://localhost:4000/api/ingest",
    [int]$PollIntervalSeconds = 5
)

$Hostname = $env:COMPUTERNAME
$LastCheckTime = Get-Date

Write-Host "[*] log-watch-live Windows agent starting"
Write-Host "[*] Hostname: $Hostname"
Write-Host "[*] Reporting to: $BackendUrl"
Write-Host "[*] Poll interval: $PollIntervalSeconds seconds"

# Event IDs we care about, mapped to a human-readable line format
# that mirrors the Linux auth.log style your backend already parses
function Format-EventLine {
    param($Event)

    switch ($Event.Id) {
        4625 {
            $user = $Event.Properties[5].Value
            $ip = $Event.Properties[19].Value
            return "Failed password for $user from $ip"
        }
        4624 {
            $user = $Event.Properties[5].Value
            $ip = $Event.Properties[18].Value
            if ($ip -and $ip -ne "-") {
                return "Accepted password for $user from $ip"
            }
            return $null # local/service logins - skip, too noisy
        }
        4720 {
            $user = $Event.Properties[0].Value
            return "new user: name=$user"
        }
        4726 {
            $user = $Event.Properties[0].Value
            return "delete user '$user'"
        }
        default {
            return $null
        }
    }
}

while ($true) {
    try {
        $events = Get-WinEvent -FilterHashtable @{
            LogName   = 'Security'
            Id        = 4625, 4624, 4720, 4726
            StartTime = $LastCheckTime
        } -ErrorAction SilentlyContinue

        $LastCheckTime = Get-Date

        if ($events) {
            $lines = @()
            foreach ($event in $events) {
                $line = Format-EventLine -Event $event
                if ($line) { $lines += $line }
            }

            if ($lines.Count -gt 0) {
                $payload = @{
                    hostname = $Hostname
                    os       = "windows"
                    logs     = $lines
                } | ConvertTo-Json

                try {
                    $response = Invoke-RestMethod -Uri $BackendUrl -Method Post -Body $payload -ContentType "application/json"
                    Write-Host "[*] Sent $($lines.Count) log line(s) - backend responded ok"
                } catch {
                    Write-Host "[!] Failed to send logs: $_"
                }
            }
        }
    } catch {
        Write-Host "[!] Error reading event log: $_"
    }

    Start-Sleep -Seconds $PollIntervalSeconds
}