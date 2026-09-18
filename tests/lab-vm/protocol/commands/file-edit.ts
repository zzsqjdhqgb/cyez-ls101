/*
 * Byte-level file operations the negative cases need: N5 proves that an enrollment file is a
 * credential *as a whole file*, so it needs a copy of a valid file with exactly one byte changed.
 *
 * The commands report what they did, including the offset and the two byte values, so the phase script
 * can state in its log exactly which byte was altered when a rejection is attributed to byte equality
 * rather than to a structural failure.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { required, report, sha256Hex, type CommandHandler } from '../context'

export const fileEdit: CommandHandler = async (args) => {
  const kind = args[0]
  const source = required(args, '--in')
  const destination = required(args, '--out')
  const bytes = await readFile(source)
  if (kind === 'copy') {
    await writeFile(destination, bytes)
    return { kind, out: destination, bytes: bytes.length, sha256: sha256Hex(bytes) }
  }
  if (kind === 'mutate') {
    if (bytes.length < 8) throw new Error('the file is too small to mutate')
    // The middle of the file: past any fixed header, before any trailer that a reader may rely on.
    const offset = Math.floor(bytes.length / 2)
    const before = bytes[offset]
    const after = before ^ 0x01
    const mutated = Buffer.from(bytes)
    mutated[offset] = after
    await writeFile(destination, mutated)
    return {
      kind,
      out: destination,
      bytes: mutated.length,
      sha256: sha256Hex(mutated),
      originalSha256: sha256Hex(bytes),
      offset,
      before,
      after
    }
  }
  throw new Error('file-edit requires a kind: copy|mutate')
}

export { report }
