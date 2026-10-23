(() => {
  'use strict';
  if (window.top !== window || !window.ChungusNative || window.ChungusAndroidClient) return;
  let nextId = 0;
  let foreground = document.visibilityState !== 'hidden';
  let copying = false;
  let sharing = false;
  const pending = new Map(), blobs = new Map();
  const native = window.ChungusNative;
  native.onmessage = event => {
    const message = JSON.parse(event.data), entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    message.ok ? entry.resolve(message) : entry.reject(new Error(message.error || 'Native operation failed'));
  };
  function request(type, data = {}, timeout = 0) {
    return new Promise((resolve, reject) => {
      const id = String(++nextId);
      const timer = timeout ? setTimeout(() => {
        pending.delete(id);
        reject(new Error(type.startsWith('clipboard.') ? 'Android did not confirm the copy. Please try again.' : 'Android did not respond. Please try again.'));
      }, timeout) : undefined;
      pending.set(id, { resolve, reject, timer });
      try { native.postMessage(JSON.stringify({ ...data, id, type })); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }

  async function transferText(text, operation) {
    if (typeof text !== 'string' || !text.length || text.length > 1000000) throw Error('The text is empty or too large.');
    let transfer;
    try {
      transfer = (await request(operation + '.begin', { size: text.length }, 5000)).transfer;
      // Even JSON's worst-case escaping stays below the native 100,000-character limit.
      for (let offset = 0; offset < text.length; offset += 8192) {
        await request(operation + '.chunk', { transfer, offset, text: text.slice(offset, offset + 8192) }, 5000);
      }
      await request(operation + '.end', { transfer }, 10000);
    } catch (error) {
      if (transfer) await request(operation + '.abort', { transfer }, 1000).catch(() => {});
      throw error;
    }
  }
  async function copyText(text) {
    if (copying) throw Error('Another copy is in progress.');
    copying = true;
    try { await transferText(text, 'clipboard'); } finally { copying = false; }
  }
  async function shareText(text) {
    if (sharing) throw Error('Another share is in progress.');
    sharing = true;
    try { await transferText(text, 'share.text'); } finally { sharing = false; }
  }
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => { const url = create(blob); if (blob instanceof Blob) blobs.set(url, blob); return url; };
  URL.revokeObjectURL = url => { blobs.delete(url); revoke(url); };

  async function writeStream(transfer, reader, operation = 'export') {
    let offset = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let i = 0; i < value.length; i += 49152) {
        const chunk = value.subarray(i, i + 49152);
        const data = btoa(String.fromCharCode(...chunk));
        await request(operation + '.chunk', { transfer, offset, data });
        offset += chunk.length;
      }
    }
    await request(operation + '.end', { transfer });
  }

  async function shareFile(filename, mime, build) {
    if (sharing) throw Error('Another share is in progress.');
    sharing = true;
    let transfer, reader;
    try {
      transfer = (await request('share.begin', { filename, mime, size: -1 }, 10000)).transfer;
      const blob = await build();
      if (!(blob instanceof Blob)) throw Error('The export did not produce a file');
      if (blob.size > 128 * 1024 * 1024) throw Error('Shared file is too large (maximum 128 MiB).');
      reader = blob.stream().getReader();
      await writeStream(transfer, reader, 'share');
    } catch (error) {
      await request('share.abort', { transfer: transfer || '' }, 1000).catch(() => {});
      throw error;
    } finally {
      if (reader) await reader.cancel().catch(() => {});
      sharing = false;
    }
  }

  async function readIncomingFile(file) {
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 128 * 1024 * 1024) throw Error('Invalid shared file size.');
    const chunks = [];
    let offset = 0;
    while (offset < file.size) {
      const { data } = await request('incoming.read', { file: file.id, offset }, 15000);
      const chunk = Uint8Array.from(atob(data), char => char.charCodeAt(0));
      if (!chunk.length || chunk.length > 49152 || offset + chunk.length > file.size) throw Error('The shared file is incomplete.');
      chunks.push(chunk);
      offset += chunk.length;
    }
    return new File(chunks, file.name, { type: file.mime });
  }

  // The destination must be chosen before portrait fetches, PNG encoding or ZIP work.
  // Old server builds keep using download(); new ones can defer their file producer here.
  async function save(filename, mime, build) {
    let transfer, reader;
    try {
      const started = await request('export.begin', { filename, mime, size: -1 });
      transfer = started.transfer;
      const blob = await build();
      if (!(blob instanceof Blob)) throw Error('The export did not produce a file');
      reader = blob.stream().getReader();
      await writeStream(transfer, reader);
    } catch (error) {
      if (transfer) await request('export.abort', { transfer }).catch(() => {});
      if (error.message !== 'cancelled') throw error;
    } finally { if (reader) await reader.cancel().catch(() => {}); }
  }

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
      await writeStream(transfer, reader);
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
    get foreground() { return foreground; },
    setForeground: active => {
      active = Boolean(active);
      if (foreground === active) return;
      foreground = active;
      window.dispatchEvent(new Event('chungus-android-lifecycle'));
    },
    settings: () => request('settings'),
    pinChatShortcut: async (chatId, title) => { await request('shortcut.pin', { chatId, title }, 10000); },
    pendingChatShortcut: async () => (await request('shortcut.pending', {}, 10000)).target,
    acknowledgeChatShortcut: async id => { await request('shortcut.acknowledge', { request: id }, 10000); },
    notifyChatShortcut: () => window.dispatchEvent(new Event('chungus-android-chat-shortcut')),
    copyText,
    shareText,
    shareFile,
    incomingFiles: async () => (await request('incoming.list', {}, 15000)).files,
    readIncomingFile,
    removeIncomingFile: id => request('incoming.remove', { file: id }, 15000),
    notifyIncoming: () => window.dispatchEvent(new Event('chungus-android-incoming')),
    download,
    save,
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
