/**
 * AWS Cost Builder — Background Service Worker (MV3)
 * Handles message routing between popup and content script.
 */

'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'captureTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab) {
        sendResponse({ success: false, error: 'No active tab found.' });
        return;
      }

      if (!tab.url || !tab.url.includes('calculator.aws')) {
        sendResponse({
          success: false,
          error: 'Active tab is not the AWS Pricing Calculator. Navigate to https://calculator.aws/#/estimate first.',
        });
        return;
      }

      try {
        const results = await chrome.tabs.sendMessage(tab.id, { action: 'capture' });
        sendResponse(results);
      } catch (err) {
        // Content script may not be injected yet — try scripting API
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/content.js'],
          });
          const results = await chrome.tabs.sendMessage(tab.id, { action: 'capture' });
          sendResponse(results);
        } catch (injectErr) {
          sendResponse({ success: false, error: `Could not inject content script: ${injectErr.message}` });
        }
      }
    });
    return true;
  }
});
