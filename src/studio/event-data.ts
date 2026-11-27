const credentialField =
  /^(?:authorization|(?:proxy[-_])?authorization|(?:[a-z]+[-_])?api[-_]?key|access[-_]?token|refresh[-_]?token|password|client[-_]?secret)$/iu;

/** Mask explicit credential fields and the configured provider key in exported events. */
export function eventData(data: Record<string, unknown>): Record<string, unknown> {
  const key = process.env.OPENAI_API_KEY;
  function clean(value: unknown): unknown {
    if (typeof value === 'string' && key && key !== 'ollama')
      return value.replaceAll(key, '[redacted]');
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, credentialField.test(k) ? '[redacted]' : clean(v)]),
    );
  }
  return clean(data) as Record<string, unknown>;
}
