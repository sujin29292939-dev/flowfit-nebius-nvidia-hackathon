Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
cmdPath = fso.BuildPath(scriptDir, "start-flowfit-app.cmd")

shell.CurrentDirectory = scriptDir
shell.Run """" & cmdPath & """ 3007 /workspace", 0, False
