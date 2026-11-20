/* Shared crypto helpers (browser + Node tests). No secrets live here. */
(function (root) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const subtle = root.crypto && root.crypto.subtle;

  const normAnswer = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
  const normPin = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

  async function open(secret, box, iters) {
    // box = {salt, blob}; returns parsed JSON or null if the secret is wrong
    try {
      const raw = b64d(box.blob);
      const km = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
      const key = await subtle.deriveKey(
        { name: 'PBKDF2', salt: b64d(box.salt), iterations: iters, hash: 'SHA-256' },
        km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
      return JSON.parse(dec.decode(pt));
    } catch (e) { return null; }
  }
  async function stageId(token) {
    return hex(await subtle.digest('SHA-256', enc.encode('id:' + token))).slice(0, 16);
  }
  root.HuntCore = { open, stageId, normAnswer, normPin };
})(typeof window !== 'undefined' ? window : globalThis);
