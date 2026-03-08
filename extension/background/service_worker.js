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

// Serialize storage mutations to avoid lost updates when multiple messages
// (e.g. captureProgress + serviceAutoCaptured) arrive close together.
let sessionMutationQueue = Promise.resolve();

function mutateSession(mutator) {
  sessionMutationQueue = sessionMutationQueue
    .then(async () => {
      const session = await getSession();
      if (!session) return null;
      const shouldPersist = await mutator(session);
      if (shouldPersist === false) return session;
      await setSession(session);
      return session;
    })
    .catch((err) => {
      console.error('Session mutation failed:', err);
      return null;
    });

  return sessionMutationQueue;
}

async function getActiveCalculatorTab() {
  // Query by URL across ALL windows — currentWindow is unreliable from a service worker context
  const tabs = await chrome.tabs.query({ url: '*://calculator.aws/*' });
  if (tabs.length > 0) return tabs[0];
  // Fallback: scan all tabs manually (handles cases where URL pattern match fails)
  const all = await chrome.tabs.query({});
  return all.find(t => t.url && t.url.includes('calculator.aws')) || null;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
  } catch {
    // Content script not yet loaded — inject it and wait for it to be ready
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js'],
    });
    // Give the script a moment to register its message listener
    await new Promise(resolve => setTimeout(resolve, 250));
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
        captureStatus: { state: 'idle', serviceName: null, updatedAt: 0 },
        captureLog: [],
      };
      await setSession(session);

      const tab = await getActiveCalculatorTab();
      if (!tab) {
        sendResponse({ success: false, error: 'No AWS Calculator tab found. Open https://calculator.aws in a tab first, then start capture.' });
        return;
      }

      try {
        await ensureContentScript(tab.id);
        await chrome.tabs.sendMessage(tab.id, { action: 'startAutoCapture' });
      } catch (err) {
        sendResponse({ success: false, error: 'Could not reach the calculator tab: ' + err.message });
        return;
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

  // ── captureProgress (from content script) ───────────────────────────────────
  if (message.action === 'captureProgress') {
    (async () => {
      await mutateSession((session) => {
        if (!session.isCapturing) return false;
        session.captureStatus = {
          state: message.status,
          serviceName: message.serviceName || null,
          updatedAt: Date.now(),
        };
      });
    })();
    return false;
  }

  // ── serviceAutoCaptured (from content script) ────────────────────────────────
  if (message.action === 'serviceAutoCaptured') {
    (async () => {
      await mutateSession((session) => {
        if (!session.isCapturing) return false;

        const { service_name, region, dimensions } = message.data;
        const dim_count = Object.keys(dimensions || {}).length;
        const now = Date.now();

        // Deduplicate by service_name+region
        const isDuplicate = session.capturedServices.some(
          s => s.service_name === service_name && s.region === region
        );

        if (!isDuplicate) {
          session.capturedServices.push({
            id: `svc_${now}_${Math.random().toString(36).slice(2, 7)}`,
            service_name,
            region,
            dimensions,
            capturedAt: now,
            groupPath: null,
          });
          session.captureLog.push({ timestamp: now, event: 'captured', service_name, dim_count });
          session.captureStatus = { state: 'captured', serviceName: service_name, updatedAt: now };
        } else {
          session.captureLog.push({ timestamp: now, event: 'duplicate', service_name, dim_count });
        }

        // Keep log to last 50 entries
        if (session.captureLog.length > 50) session.captureLog = session.captureLog.slice(-50);
      });
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

  // ── addServiceFromTab (manual "Capture Now" button) ──────────────────────────
  // Force-captures the current calculator tab and adds the result to the session.
  if (message.action === 'addServiceFromTab') {
    (async () => {
      const session = await getSession();
      if (!session || !session.isCapturing) {
        sendResponse({ success: false, error: 'No active capture session.' });
        return;
      }

      const tab = await getActiveCalculatorTab();
      if (!tab) {
        sendResponse({ success: false, error: 'No AWS Calculator tab found. Open calculator.aws first.' });
        return;
      }

      let result;
      try {
        await ensureContentScript(tab.id);
        result = await chrome.tabs.sendMessage(tab.id, { action: 'capture' });
      } catch (err) {
        sendResponse({ success: false, error: 'Could not reach calculator tab: ' + err.message });
        return;
      }

      if (!result || !result.success) {
        sendResponse({ success: false, error: result?.error || 'Capture returned no data.' });
        return;
      }

      const { service_name, region, dimensions } = result.data;
      const dimCount = Object.keys(dimensions || {}).length;

      if (dimCount === 0) {
        sendResponse({ success: false, error: 'No form fields found on this page. Navigate to a specific service config page.' });
        return;
      }

      const now = Date.now();
      const isDuplicate = session.capturedServices.some(
        s => s.service_name === service_name && s.region === region
      );

      if (isDuplicate) {
        // Update the existing entry with fresh dimension data
        const existing = session.capturedServices.find(
          s => s.service_name === service_name && s.region === region
        );
        if (existing) {
          existing.dimensions = dimensions;
          existing.capturedAt = now;
        }
        session.captureLog.push({ timestamp: now, event: 'updated', service_name, dim_count: dimCount });
      } else {
        session.capturedServices.push({
          id: `svc_${now}_${Math.random().toString(36).slice(2, 7)}`,
          service_name,
          region,
          dimensions,
          capturedAt: now,
          groupPath: null,
        });
        session.captureLog.push({ timestamp: now, event: 'captured', service_name, dim_count: dimCount });
      }

      session.captureStatus = { state: 'captured', serviceName: service_name, updatedAt: now };
      if (session.captureLog.length > 50) session.captureLog = session.captureLog.slice(-50);
      await setSession(session);

      sendResponse({ success: true, service_name, dim_count: dimCount });
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
