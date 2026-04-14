export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} B`;
}

export function fileIdentity(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function mergeUniqueFiles(current: File[], next: File[]): File[] {
  const seen = new Set(current.map(fileIdentity));
  const merged = [...current];

  next.forEach((file) => {
    const key = fileIdentity(file);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.push(file);
  });

  return merged;
}

export function splitFilesBySize(
  files: File[],
  maxBytes: number
): { acceptedFiles: File[]; oversizedFiles: File[] } {
  return {
    acceptedFiles: files.filter((file) => file.size <= maxBytes),
    oversizedFiles: files.filter((file) => file.size > maxBytes),
  };
}
