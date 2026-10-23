export function generatedImageDownloadFilename(generatedMediaId: string): string {
  const safeId = generatedMediaId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `cocoa-ai-infographic-${safeId || 'generated'}.png`;
}

export function generatedVideoDownloadFilename(generatedMediaId: string): string {
  const safeId = generatedMediaId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `cocoa-ai-seedance-${safeId || 'generated'}.mp4`;
}

export async function downloadGeneratedImage(
  blobUrl: string,
  generatedMediaId: string,
): Promise<void> {
  return downloadGeneratedMedia(blobUrl, generatedImageDownloadFilename(generatedMediaId));
}

export async function downloadGeneratedVideo(
  blobUrl: string,
  generatedMediaId: string,
): Promise<void> {
  return downloadGeneratedMedia(blobUrl, generatedVideoDownloadFilename(generatedMediaId));
}

async function downloadGeneratedMedia(blobUrl: string, filename: string): Promise<void> {
  try {
    const res = await fetch(blobUrl);
    if (!res.ok) {
      throw new Error(`download request failed with HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  } catch (err) {
    console.warn('[downloadGeneratedMedia] falling back to open full media:', err);
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
  }
}
