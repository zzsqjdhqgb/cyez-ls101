!macro customInstall
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "LS101LabStudent" '"$INSTDIR\ls101-lab-student.exe"'
!macroend

!macro customUnInstall
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "LS101LabStudent"
!macroend
