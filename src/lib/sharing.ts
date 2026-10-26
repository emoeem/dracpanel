function filePart(data: Uint8Array | string | Blob): BlobPart {
  if (typeof data === "string" || data instanceof Blob) {
    return data;
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function canUseWebShareFiles(): boolean {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
    return false;
  }
  try {
    return navigator.canShare({ files: [new File([], "share.txt", { type: "text/plain" })] });
  } catch {
    return false;
  }
}

export function canShare(): boolean {
  return typeof navigator.share === "function";
}

export function canShareFiles(): boolean {
  return canUseWebShareFiles();
}

export async function shareFile(
  name: string,
  data: Uint8Array | string | Blob,
  type: string,
): Promise<void> {
  const file = new File([filePart(data)], name, { type });
  if (typeof navigator.share === "function") {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
    if (typeof data === "string") {
      await navigator.share({ text: data });
      return;
    }
  }
  throw new Error("File sharing is not supported");
}

export function shareError(error: unknown): unknown | null {
  if (error instanceof DOMException && error.name === "AbortError") {
    return null;
  }
  return error;
}
