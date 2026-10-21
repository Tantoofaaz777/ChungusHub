(() => {
  'use strict';
  if (window.top !== window || !window.ChungusNative || window.ChungusAndroidClient) return;
  let nextId = 0;
  const pending = new Map(), blobs = new Map();
  const native = window.ChungusNative;
  native.onmessage = event => {
    const message = JSON.parse(event.data), entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    message.ok ? entry.resolve(message) : entry.reject(new Error(message.error || 'Export failed'));
  };
  function request(type, data = {}) {
    return new Promise((resolve, reject) => {
      const id = String(++nextId);
      pending.set(id, { resolve, reject });
      try { native.postMessage(JSON.stringify({ ...data, id, type })); }
      catch (error) { pending.delete(id); reject(error); }
    });
  }
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => { const url = create(blob); if (blob instanceof Blob) blobs.set(url, blob); return url; };
  URL.revokeObjectURL = url => { blobs.delete(url); revoke(url); };

  async function download(url, filename) {
    let transfer, reader;
    try {
      const address = new URL(url, location.href);
      if (!(address.origin === location.origin || address.protocol === 'data:')) throw Error('Export must come from this server');
      // Capture the Blob before the caller immediately revokes its temporary URL.
      const blob = blobs.get(address.href);
      const response = blob ? null : await fetch(address.href, { credentials: 'same-origin' });
      if (response && !response.ok) throw Error(`Download failed (${response.status})`);
      const stream = blob ? blob.stream() : response.body;
      if (!stream) throw Error('This WebView cannot stream the export');
      reader = stream.getReader();
      const mime = blob?.type || response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
      const started = await request('export.begin', { filename: filename || 'chungus-export', mime, size: blob?.size ?? -1 });
      transfer = started.transfer;
      let offset = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (let i = 0; i < value.length; i += 49152) {
          const chunk = value.subarray(i, i + 49152);
          const data = btoa(String.fromCharCode(...chunk));
          await request('export.chunk', { transfer, offset, data });
          offset += chunk.length;
        }
      }
      await request('export.end', { transfer });
    } catch (error) {
      if (transfer) await request('export.abort', { transfer }).catch(() => {});
      if (error.message !== 'cancelled') await request('notice', { message: 'Could not save the file. Please try exporting it again.' }).catch(() => {});
    } finally { if (reader) await reader.cancel().catch(() => {}); }
  }
  function intercept(anchor) {
    if (!(anchor instanceof HTMLAnchorElement) || !anchor.hasAttribute('download') || !anchor.href) return false;
    void download(anchor.href, anchor.download);
    return true;
  }
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (!intercept(this)) return click.call(this); };
  document.addEventListener('click', event => {
    const anchor = event.target instanceof Element ? event.target.closest('a[download]') : null;
    if (intercept(anchor)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.ChungusAndroidClient = Object.freeze({
    version: 1,
    settings: () => request('settings'),
    download,
    back: () => {
      if (typeof window.__chungusAndroidBack === 'function') return window.__chungusAndroidBack();
      // Older server builds still get modal dismissal; leave the native task safely otherwise.
      const modal = document.querySelector('.dialog-portal:not([inert])');
      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
      window.dispatchEvent(event);
      return !!modal || event.defaultPrevented;
    }
  });
  window.dispatchEvent(new Event('chungus-android-ready'));
})();
