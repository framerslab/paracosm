/** Downloads JSON through an attached link and gives the browser time to read the blob URL. */
export function downloadJson(text: string, fileName: string): void {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  try {
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
