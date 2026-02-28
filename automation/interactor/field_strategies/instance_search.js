/**
 * EC2 Instance search option selection strategy.
 */

/**
 * Click, type, and click the correct radio button in the instance table.
 * @param {import('playwright').Page} page
 * @param {import('playwright').ElementHandle} element
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function fillInstanceSearch(page, element, value) {
  const text = String(value ?? '');
  
  await element.click();
  await element.fill(text);
  
  // Wait for the table to filter down
  await page.waitForTimeout(2000);
  
  // Try to find the row containing the text and click its radio button
  const row = page.locator(`tr:has-text('${text}')`).first();
  const radio = row.locator("input[type='radio']").first();
  
  await radio.waitFor({ state: 'visible', timeout: 3000 });
  await radio.click();
}
