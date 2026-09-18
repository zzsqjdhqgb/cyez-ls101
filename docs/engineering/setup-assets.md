# Setup asset integrity

`yarn setup` manages downloaded AI assets under `externals/ai/` and generated file icons under
`assets/file-icons/`. Downloaded assets have repository-pinned sizes and SHA-256 digests. A download
is written to a `.part` file, hashed, and renamed into place only after it is complete.

The first successful setup, or a setup after the pinned manifest changes, reads every managed file
and records its verified filesystem fingerprint under `externals/ai/.setup-verification/`. Later
setups compare the following without reading multi-gigabyte contents:

- every required path is a regular file rather than a directory or symbolic link;
- its size, permissions when relevant, device, inode, mtime, and ctime still match the verified
  state;
- fully managed directories contain no undeclared files or directories.

A missing or malformed state file is never accepted as proof. Setup falls back to SHA-256. Ordinary
file replacement, in-place writes, truncation, permission changes, directory replacement, and extra
files all invalidate the fast path. Once the remaining files have been hashed, only damaged or
missing direct-download assets are fetched again.

Recovery depends on the asset kind:

- Pocket TTS, pronunciation assets, Qwen TTS release files, VAD, and the ASR archive are downloaded
  again and atomically published.
- A damaged Qwen3 ASR extraction is rebuilt from the verified archive, then atomically replaces the
  previous model directory.
- A damaged Qwen TTS staged helper is copied from the verified release cache and its executable mode
  is restored.
- Generated icon output is recreated from the Git-managed PNG sources and undeclared output files
  are removed.

Use `yarn setup --verify` for an unconditional local SHA-256 audit, including corruption that did not
change observable filesystem metadata. Use `yarn setup --verify-upstream` to compare the pinned
metadata with the relevant GitHub and Hugging Face APIs. Normal setup intentionally performs neither
expensive operation when all fingerprints are unchanged.
