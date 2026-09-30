/*
 * Stand-in for `7zip-bin` inside the lab protocol driver bundle.
 *
 * `7zip-bin` resolves its packaged 7-Zip binary from `__dirname` at module load, which does not exist
 * once the driver is bundled into a single ES module, so importing it fails before any command runs.
 * The driver only needs it because `ipv6` imports `LabService` for one static base-URL check, and
 * `LabService` imports the backup store, which imports `7zip-bin`.
 *
 * The driver never performs a backup or a restore, and the packaged binary is deliberately not part of
 * the guest bundle. If one of these paths is ever exercised from the driver, the path below makes it
 * fail loudly instead of silently using something else — the fix at that point is to move the check
 * the driver needs out of `LabService`, not to copy a 7-Zip binary into the VM.
 */
export const path7za = '/nonexistent/7zip-bin-not-bundled-in-the-lab-driver/7za'
export const path7x = '/nonexistent/7zip-bin-not-bundled-in-the-lab-driver/7x.sh'
