/**
 * Copies text to the clipboard, and answers every failure as a rejection.
 *
 * A page that is not a secure context (plain http at a network address)
 * has no `navigator.clipboard`, so a bare `navigator.clipboard.writeText()`
 * throws before any promise exists and the caller's failure branch never
 * runs. This returns a rejected promise in that case, and when `writeText`
 * throws, so a copy key's failure branch runs whatever the browser does.
 *
 * @module paracosm/cli/dashboard/hooks/writeClipboardText
 */

/**
 * Writes `text` to the clipboard.
 *
 * @param text - What to copy.
 * @returns A promise that settles when the browser answers the write, and
 *   rejects when the page has no clipboard or the browser refuses the write.
 */
export function writeClipboardText(text: string): Promise<void> {
  try {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      return Promise.reject(new Error('This page has no clipboard.'));
    }
    return clipboard.writeText(text);
  } catch (error) {
    return Promise.reject(error);
  }
}
