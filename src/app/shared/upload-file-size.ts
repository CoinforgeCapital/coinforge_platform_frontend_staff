export const MAX_UPLOAD_FILE_SIZE_BYTES = 400 * 1024 * 1024;
export const MAX_UPLOAD_FILE_SIZE_LABEL = '400 MB';

export function oversizedUploadFiles(files: readonly File[]): File[] {
  return files.filter((file) => file.size > MAX_UPLOAD_FILE_SIZE_BYTES);
}

export function uploadFileSizeError(files: readonly File[]): string | null {
  const oversized = oversizedUploadFiles(files);
  if (!oversized.length) return null;

  if (oversized.length === 1) {
    return `"${oversized[0].name}" exceeds the ${MAX_UPLOAD_FILE_SIZE_LABEL} file size limit.`;
  }

  const sampleNames = oversized
    .slice(0, 3)
    .map((file) => file.name)
    .join(', ');
  const suffix = oversized.length > 3 ? ', ...' : '';
  return `${oversized.length} files exceed the ${MAX_UPLOAD_FILE_SIZE_LABEL} file size limit: ${sampleNames}${suffix}`;
}

export function assertUploadFilesWithinLimit(files: readonly File[]): void {
  const error = uploadFileSizeError(files);
  if (error) throw new Error(error);
}
