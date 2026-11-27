import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';

/** The bundled launcher identifies the weights its router loaded; older servers can use an explicit local path. */
export async function checkpointDigest(endpoint: URL): Promise<string | null> {
  try {
    const response = await fetch(new URL('/harness/checkpoint', endpoint), {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      const info = (await response.json()) as { model?: string; sha256?: string };
      if (
        info.model === 'multilingual' &&
        typeof info.sha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(info.sha256)
      )
        return info.sha256;
    }
  } catch {
    /* Older Laya distributions only expose /health. */
  }
  const directory =
    process.env.LAYA_MULTILINGUAL_MODEL_PATH ??
    (process.env.LAYA_CHECKOUT ? join(process.env.LAYA_CHECKOUT, 'models', 'multilingual') : null);
  if (!directory) return null;
  try {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(join(directory, 'model.safetensors')))
      hash.update(chunk);
    return hash.digest('hex');
  } catch {
    return null;
  }
}
