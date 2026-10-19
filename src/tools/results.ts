import type { ToolResult } from '../types.js';

export function fitResult(
  result: ToolResult,
  limit: number,
): { result: ToolResult; text: string; bytes: number } {
  const serializedResult = JSON.stringify(result);

  if (Buffer.byteLength(serializedResult) <= limit) {
    return { result, text: serializedResult, bytes: Buffer.byteLength(serializedResult) };
  }

  const truncatedResult: ToolResult = { ok: result.ok, truncated: true };
  let text = JSON.stringify(truncatedResult);

  if (Buffer.byteLength(text) > limit) {
    throw new Error('Result budget too small for truncation marker');
  }

  let lowerBound = 0;
  let upperBound = serializedResult.length;

  while (lowerBound < upperBound) {
    const middle = Math.ceil((lowerBound + upperBound) / 2);

    if (
      Buffer.byteLength(
        JSON.stringify({ ...truncatedResult, content: serializedResult.slice(0, middle) }),
      ) <= limit
    ) {
      lowerBound = middle;
    } else {
      upperBound = middle - 1;
    }
  }

  const boundedResult = {
    ...truncatedResult,
    ...(lowerBound ? { content: serializedResult.slice(0, lowerBound) } : {}),
  };

  text = JSON.stringify(boundedResult);

  return { result: boundedResult, text, bytes: Buffer.byteLength(text) };
}
