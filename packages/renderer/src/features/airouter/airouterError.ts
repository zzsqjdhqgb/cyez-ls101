export function formatAIRouterError(reason: unknown, fallback: string): string {
  const raw =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : reason && typeof reason === 'object' && 'message' in reason
          ? typeof reason.message === 'string'
            ? reason.message
            : ''
          : ''
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
    .replace(/^Error:\s*/, '')
    .trim()
  return message || fallback
}
