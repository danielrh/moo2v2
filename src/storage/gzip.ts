// Gzip helpers over the Web Streams compression API (available in browsers and
// Node 18+), used for snapshots and battle replays.

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const src = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  const buf = await new Response(src).arrayBuffer();
  return new Uint8Array(buf);
}

export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream('gzip'));
}

export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream('gzip'));
}

const TE = new TextEncoder();
const TD = new TextDecoder();

export function gzipText(text: string): Promise<Uint8Array> {
  return gzip(TE.encode(text));
}

export async function gunzipText(bytes: Uint8Array): Promise<string> {
  return TD.decode(await gunzip(bytes));
}
