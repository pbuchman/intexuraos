# INT-1376: Research — Prevent PWA Reloads on Android HyperOS

> **Research task** — No code changes. Findings and recommendations for implementation.

**Goal:** Identify proven strategies to prevent (or mitigate) full PWA reloads on Android HyperOS after minutes of inactivity.

**Date:** 2026-04-14

---

## Problem

The IntexuraOS PWA on Android HyperOS (Xiaomi) completely reloads after ~2 minutes of inactivity, destroying user experience and losing in-progress state.

## Root Cause Analysis

Three independent kill mechanisms operate at different levels:

### 1. HyperOS `com.miui.powerkeeper` (Primary Culprit)
Xiaomi's Battery and Performance service aggressively kills background processes beyond what stock Android does. As documented by dontkillmyapp.com: *"In default settings, background processing simply does not work right and apps using them will break."*

- **Source**: [Don't Kill My App — Xiaomi](https://dontkillmyapp.com/xiaomi)

### 2. Android Low Memory Killer (lmkd)
The Android low memory killer daemon monitors memory state and kills processes based on `oom_adj_score` priority. Background apps are killed first. When the OS kills Chrome's renderer process via SIGKILL, the PWA page is destroyed without any JavaScript event firing — no `freeze`, no `pagehide`, nothing.

- **Source**: [Android LMK Daemon](https://source.android.com/docs/core/perf/lmkd), [Android Memory Management](https://developer.android.com/topic/performance/memory-management)

### 3. Chrome Tab Discarding
Chrome independently freezes background tabs (suspending JS execution, timers, fetch callbacks) and may discard them (unloading from memory entirely). On Android, Chrome has its own internal logic separate from desktop.

- **Source**: [Chrome Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api), [Tab Discarding in Chrome](https://developer.chrome.com/blog/tab-discarding)

## Key Finding

**No web API can programmatically prevent HyperOS from killing the PWA process.** The only proven strategies are: (a) making the reload seamless via state persistence, (b) user-side device settings, and (c) fast cache-first reloads.

---

## Strategy Analysis

### TIER 1: Actually Works in Production

#### A. Aggressive State Checkpointing + Seamless Restore (PROVEN)

Save app state to IndexedDB on every meaningful change (debounced). Save on `visibilitychange` (hidden) and `freeze` events using `IDBTransaction.commit()`. Restore fully on page load, making the reload invisible to the user.

**What to save**: Current route/URL hash, scroll position, form field values, authentication tokens (already in localStorage), UI state (open modals, selected tabs, sidebar state), any in-progress user work.

**Implementation pattern**:
```javascript
// Save on visibility change (last chance before freeze)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    saveAllUnsavedState(); // Use IDBTransaction.commit() for reliability
  }
});

// Save on freeze event (last chance before discard)
document.addEventListener('freeze', () => {
  saveAllUnsavedState();
});

// Restore on page load
window.addEventListener('load', async () => {
  const savedState = await loadStateFromIndexedDB();
  if (savedState) {
    restoreAppState(savedState);
  }
});
```

**Storage choice**: IndexedDB (not localStorage) because:
- Available in both main thread and service workers
- Asynchronous (doesn't block UI)
- Can store structured data and large datasets
- `IDBTransaction.commit()` ensures writes complete even during `freeze` event

**Persistent storage request** to prevent browser from evicting data:
```javascript
if (navigator.storage && navigator.storage.persist) {
  await navigator.storage.persist();
}
```

- **Source**: [web.dev IndexedDB Best Practices](https://web.dev/articles/indexeddb-best-practices-app-state), [IDBTransaction.commit() Explainer](https://andreas-butler.github.io/idb-transaction-commit/EXPLAINER.html), [web.dev Offline Data](https://web.dev/learn/pwa/offline-data)

#### B. User-Side HyperOS Settings Guide (PROVEN, requires user action)

Detect Xiaomi/HyperOS device via `navigator.userAgent` and show an in-app guide:

1. **Disable Battery Optimization for Chrome**: Settings > Apps > Chrome > Battery Saver > "No restrictions"
2. **Enable Autostart**: Settings > Apps > Permissions > Autostart > Enable for Chrome
3. **Lock Chrome in Recent Apps**: Open recent apps tray, hold Chrome, tap padlock icon
4. **Disable MIUI Optimizations** (Developer Options): Optional advanced step

**Known limitation**: HyperOS may reset these settings after system updates.

- **Source**: [Don't Kill My App — Xiaomi](https://dontkillmyapp.com/xiaomi), [Android Guias — Xiaomi Background Apps](https://en.androidguias.com/prevent-closing-background-apps-on-xiaomi/)

### TIER 2: Partial Mitigation

#### C. Service Worker Cache-First Strategy

Pre-cache the app shell and critical resources. Even if the page reloads, it loads instantly from the service worker cache. Reduces perceived reload time from seconds to near-instant. **Already partially implemented** via vite-plugin-pwa Workbox config.

#### D. BFCache Optimization

Close IndexedDB connections, WebSockets, and other resources in `pagehide`; reopen in `pageshow`. Never use the `unload` event. Helps with browser-initiated navigation but not OS-level kills.

```javascript
window.addEventListener('pagehide', () => {
  if (dbPromise) { dbPromise.then(db => db.close()); dbPromise = null; }
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) { openDB(); refreshStaleData(); }
});
```

- **Source**: [web.dev BFCache](https://web.dev/articles/bfcache)

### TIER 3: Does NOT Work on Android (Disproven)

| Strategy                      | Why It Fails on Android                                                                                                                                                         | Source                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web Locks API**             | Freezing opt-out explicitly not honored on mobile Chrome. Chromium docs: *"Freezing is already enabled on Mobile and doesn't honor the Opt-Out/Opt-In presented on this page."* | [Chromium Freezing Docs](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/performance_manager/docs/freezing_opt_out_opt_in.md) |
| **Wake Lock API**             | Only prevents screen dimming. Auto-released when page becomes hidden. No process protection. Earlier `system` wake lock type was abandoned and never implemented.               | [MDN Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)                                                  |
| **SharedWorkers**             | Not supported on Chrome for Android at all. Known issue since 2016.                                                                                                             | [Chromium Issue #40290702](https://issues.chromium.org/issues/40290702), [Can I Use](https://caniuse.com/sharedworkers)                            |
| **NoSleep.js / silent audio** | Only keeps screen on while foregrounded. Does not prevent background killing.                                                                                                   | [NoSleep.js](https://github.com/richtr/NoSleep.js/)                                                                                                |
| **Periodic Background Sync**  | Runs in service worker context only, cannot keep page alive. Browser controls actual frequency.                                                                                 | [Chrome Periodic Background Sync](https://developer.chrome.com/docs/capabilities/periodic-background-sync)                                         |
| **Push Notifications**        | Service worker context only. Chrome requires showing a visible notification for each push event.                                                                                | [MDN Background Operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)              |

---

## Current PWA Setup Audit

**File**: `apps/web/vite.config.ts`
- **Plugin**: vite-plugin-pwa v1.2.0 with Workbox auto-generation
- **Registration**: `autoUpdate` with `skipWaiting` + `clientsClaim`
- **Caching**: StaleWhileRevalidate (JS/CSS, 7-day/100 entries), CacheFirst (images 30-day/50, fonts 1-year/20)
- **Manifest**: `display: "standalone"`, orientation portrait-primary

**File**: `apps/web/src/context/pwa-context.tsx`
- Handles install prompts, update banners, service worker registration
- **Missing**: No page lifecycle event handling, no state persistence, no visibility monitoring

**File**: `apps/web/src/context/SyncQueueContext.tsx`
- Online/offline detection via `online`/`offline` events
- 5-second sync interval runs continuously regardless of tab visibility

**Missing capabilities**:
- No `visibilitychange` handler for state saving
- No `freeze`/`resume` event handling
- No IndexedDB state persistence for app state
- No Xiaomi device detection or settings guide
- No BFCache optimization (connections not closed in `pagehide`)

---

## Recommended Implementation Priority

1. **IndexedDB state checkpointing** — save route, scroll position, form data, UI state on `visibilitychange`/`freeze`
2. **Xiaomi device detection + settings guide** — in-app prompt with battery optimization instructions
3. **`freeze`/`resume`/`visibilitychange` event handling** — graceful state save/restore lifecycle
4. **BFCache optimization** — close connections in `pagehide`, reopen in `pageshow`
5. **Persistent storage request** — `navigator.storage.persist()` to prevent data eviction

---

## All Sources

- [Chrome Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
- [Chromium Freezing Opt-Out Documentation](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/performance_manager/docs/freezing_opt_out_opt_in.md)
- [Chromium Discussion: Web Lock on Android](https://groups.google.com/a/chromium.org/g/chromium-discuss/c/JqZCzS2B70A)
- [Don't Kill My App — Xiaomi](https://dontkillmyapp.com/xiaomi)
- [Android Guias — Prevent Closing Apps on Xiaomi](https://en.androidguias.com/prevent-closing-background-apps-on-xiaomi/)
- [Android LMK Daemon](https://source.android.com/docs/core/perf/lmkd)
- [Android Memory Management](https://developer.android.com/topic/performance/memory-management)
- [Chrome Wake Lock API](https://developer.chrome.com/docs/capabilities/web-apis/wake-lock)
- [MDN Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- [Chrome Periodic Background Sync](https://developer.chrome.com/docs/capabilities/periodic-background-sync)
- [MDN Offline and Background Operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
- [web.dev BFCache](https://web.dev/articles/bfcache)
- [Chrome BFCache on Android](https://chromestatus.com/feature/5815270035685376)
- [web.dev IndexedDB Best Practices](https://web.dev/articles/indexeddb-best-practices-app-state)
- [IDBTransaction.commit() Explainer](https://andreas-butler.github.io/idb-transaction-commit/EXPLAINER.html)
- [web.dev Offline Data](https://web.dev/learn/pwa/offline-data)
- [Chromium SharedWorker Android Issue](https://issues.chromium.org/issues/40290702)
- [Chrome Extended Lifetime SharedWorkers](https://developer.chrome.com/blog/extended-lifetime-shared-workers-origin-trial)
- [Can I Use SharedWorkers](https://caniuse.com/sharedworkers)
- [Tab Discarding in Chrome](https://developer.chrome.com/blog/tab-discarding)
- [NoSleep.js](https://github.com/richtr/NoSleep.js/)
- [WICG Page Lifecycle Spec](https://github.com/WICG/page-lifecycle)
- [XDA HyperOS Guide](https://xdaforums.com/t/guide-hyperos-debloat-and-battery-optimization.4764485/)
