use framework "AppKit"
set screenFrame to current application's NSScreen's mainScreen()'s frame()
set screenW to (item 1 of item 2 of screenFrame) as integer
set screenH to (item 2 of item 2 of screenFrame) as integer
set simW to 400
set vsW to screenW - simW
if vsW < (screenW * 0.5) then set vsW to (screenW * 0.6) as integer
set simX to vsW

set possibleNames to {"Code", "Electron", "Cursor", "VSCodium", "Visual Studio Code"}
set ideProcess to missing value

tell application "System Events"
    repeat with pName in possibleNames
        try
            set p to first process whose name is (pName as string)
            set ideProcess to p
            exit repeat
        end try
    end repeat
end tell

if ideProcess is not missing value then
    try
        tell application "System Events"
            tell ideProcess
                set position of window 1 to {0, 25}
                set size of window 1 to {vsW, screenH - 25}
            end tell
        end tell
    on error errMsg
        log "Error setting window: " & errMsg
    end try
else
    log "Could not find IDE process."
end if
