/**
 * AWS Cost Builder — Background Service Worker (MV3)
 *
 * Manages capture session state in chrome.storage.local and routes
 * messages between popup and content script.
 *
 * Session shape stored in chrome.storage.local under 'captureSession':
 * {
 *   isCapturing: boolean,
 *   profile: { project_name, description, schema_version },
 *   capturedServices: [{ id, service_name, region, dimensions, capturedAt, groupPath }],
 *   estimateTree: { groups: [...] } | null
 * }
 */

'use strict';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSession() {
  const result = await chrome.storage.local.get('captureSession');
  return result.captureSession || null;
}

async function setSession(session) {
  await chrome.storage.local.set({ captureSession: session });
}

async function getActiveCalculatorTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tab = tabs.find(t => t.url && t.url.includes('calculator.aws'));
  return tab || null;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js'],
    });
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── startCapture ────────────────────────────────────────────────────────────
  if (message.action === 'startCapture') {
    (async () => {
      const { projectName, description } = message;

      const session = {
        isCapturing: true,
        profile: {
          project_name: projectName || 'unnamed',
          description: description || null,
          schema_version: '3.0',
        },
        capturedServices: [],
        estimateTree: null,
      };
      await setSession(session);

      const tab = await getActiveCalculatorTab();
      if (tab) {
        try {
          await ensureContentScript(tab.id);
          await chrome.tabs.sendMessage(tab.id, { action: 'startAutoCapture' });
        } catch (_) {}
      }

      sendResponse({ success: true });
    })();
    return true;
  }

  // ── stopCapture ─────────────────────────────────────────────────────────────
  if (message.action === 'stopCapture') {
    (async () => {
      const session = await getSession();
      if (session) {
        session.isCapturing = false;
        await setSession(session);
      }

      const tab = await getActiveCalculatorTab();
      if (tab) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'stopAutoCapture' });
        } catch (_) {}
      }

      sendResponse({ success: true });
    })();
    return true;
  }

  // ── serviceAutoCaptured (from content script) ────────────────────────────────
  if (message.action === 'serviceAutoCaptured') {
    (async () => {
      const session = await getSession();
      if (!session || !session.isCapturing) return;

      const { service_name, region, dimensions } = message.data;

      // Deduplicate by service_name+region
      const isDuplicate = session.capturedServices.some(
        s => s.service_name === service_name && s.region === region
      );
      if (!isDuplicate) {
        session.capturedServices.push({
          id: `svc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          service_name,
          region,
          dimensions,
          capturedAt: Date.now(),
          groupPath: null,
        });
        await setSession(session);
      }
    })();
    return false;
  }

  // ── captureEstimateTree ──────────────────────────────────────────────────────
  if (message.action === 'captureEstimateTree') {
    (async () => {
      const tab = await getActiveCalculatorTab();
      if (!tab) {
        sendResponse({ success: false, error: 'No AWS Calculator tab found. Open calculator.aws first.' });
        return;
      }

      try {
        await ensureContentScript(tab.id);
        const result = await chrome.tabs.sendMessage(tab.id, { action: 'getEstimateTree' });
        if (result && result.success) {
          const session = await getSession();
          if (session) {
            session.estimateTree = result.tree;
            await setSession(session);
          }
          sendResponse({ success: true, tree: result.tree });
        } else {
          sendResponse({ success: false, error: result?.error || 'Could not read estimate tree.' });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ── getSession ───────────────────────────────────────────────────────────────
  if (message.action === 'getSession') {
    getSession().then(session => sendResponse({ session }));
    return true;
  }

  // ── clearSession ─────────────────────────────────────────────────────────────
  if (message.action === 'clearSession') {
    (async () => {
      const tab = await getActiveCalculatorTab();
      if (tab) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'stopAutoCapture' });
        } catch (_) {}
      }
      await chrome.storage.local.remove('captureSession');
      sendResponse({ success: true });
    })();
    return true;
  }

  // ── removeService ────────────────────────────────────────────────────────────
  if (message.action === 'removeService') {
    (async () => {
      const session = await getSession();
      if (session) {
        session.capturedServices = session.capturedServices.filter(s => s.id !== message.id);
        await setSession(session);
      }
      sendResponse({ success: true });
    })();
    return true;
  }

  // ── updateServiceGroup ───────────────────────────────────────────────────────
  if (message.action === 'updateServiceGroup') {
    (async () => {
      const session = await getSession();
      if (session) {
        const svc = session.capturedServices.find(s => s.id === message.id);
        if (svc) svc.groupPath = message.groupPath;
        await setSession(session);
      }
      sendResponse({ success: true });
    })();
    return true;
  }

  // ── captureTab (legacy single-page capture) ──────────────────────────────────
  if (message.action === 'captureTab') {
    (async () => {
      const tab = await getActiveCalculatorTab();
      if (!tab) {
        sendResponse({ success: false, error: 'No AWS Calculator tab found.' });
        return;
      }
      try {
        await ensureContentScript(tab.id);
        const result = await chrome.tabs.sendMessage(tab.id, { action: 'capture' });
        sendResponse(result);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});
