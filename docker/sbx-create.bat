sbx create ^
  -t docker/sandbox-templates:shell-docker ^
  --name cyez-ls101-dev ^
  shell ^
  "%~dp0../" ^
  "%~dp0../.yarn/:ro" ^
  "%~dp0../node_modules/:ro" ^
  "%~dp0../assets/:ro" ^
  "%~dp0../dist/:ro" ^
  "%~dp0../out/:ro" ^
  "%~dp0../.git/:ro" ^
  "%~dp0../docker/:ro" ^