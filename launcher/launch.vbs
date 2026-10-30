' launch.vbs — يشغّل resolve.ps1 بلا نافذة (يُنسخ إلى %LOCALAPPDATA%\OpenCodeRTL)
' موضعه ثابت لا يتغيّر، فيبقى مجدول المهام صالحاً حتى لو نُقل مجلد الأداة.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & here & "\resolve.ps1""", 0, False
