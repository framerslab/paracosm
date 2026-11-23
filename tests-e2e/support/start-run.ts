/**
 * Starting a run from the page as a visitor does: the Run tab's Start, the
 * one control that starts a new run. Start posts the run and the page opens
 * it on the Sim tab.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** The Run tab's Start key. */
export const startKey = (page: Page): Locator => page.getByTestId('start-key');

/** The Sim tab's empty state: no run on the page. */
export const noRunOnPage = (page: Page): Locator => page.getByText('No simulation running', { exact: true });

/** Opens the Run tab from any tab of the page. */
export async function openRunTab(page: Page): Promise<void> {
  await page.locator('#tab-quickstart').click();
}

/** Opens the Run tab and presses Start once it can be pressed. */
export async function pressStart(page: Page): Promise<void> {
  await openRunTab(page);
  await expect(startKey(page)).toBeEnabled();
  await startKey(page).click();
}
