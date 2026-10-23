/** A self-contained password screen: app assets remain behind the password gate. */
export function renderUnlockPage(markBase64: string | null = null): string {
	// The caller supplies a bundled PNG, never a workspace image or an external URL.
	const mark = markBase64 && /^[A-Za-z0-9+/]+={0,2}$/.test(markBase64)
		? `<img class="brand-mark" src="data:image/png;base64,${markBase64}" alt="" width="56" height="56" />`
		: `<svg class="brand-mark fallback-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></svg>`;
	return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="dark" />
<meta name="theme-color" content="#101715" />
<link rel="icon" href="data:," />
<title>Unlock · ChungusHub</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  :root{color-scheme:dark;--bg:#101715;--panel:#19211e;--field:#111914;--border:#33413a;
    --text:#eef3ef;--muted:#9caaa1;--accent:#80d2b9;--error:#efa69a}
  html{min-height:100%;background:var(--bg)}
  body{min-height:100vh;min-height:100dvh;margin:0;display:flex;align-items:center;justify-content:center;
    padding:max(28px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(28px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));
    background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;line-height:1.5}
  button,input{font:inherit}
  button{cursor:pointer;-webkit-tap-highlight-color:transparent}
  button:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
  [hidden]{display:none!important}
  .unlock{width:100%;max-width:400px;min-width:0}
  .brand{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:28px}
  .brand-mark{display:block;flex:none;width:56px;height:56px;object-fit:contain}
  .fallback-mark{padding:8px;color:var(--accent)}
  .brand-name{margin:0;font-size:20px;font-weight:700;letter-spacing:-.5px}
  .brand-tagline{margin:2px 0 0;color:var(--muted);font-size:12px}
  .card{width:100%;padding:32px;border:1px solid var(--border);border-radius:20px;
    background:var(--panel);box-shadow:0 16px 48px #0003}
  .eyebrow{display:flex;align-items:center;gap:7px;margin:0 0 14px;color:var(--accent);
    font-size:10px;font-weight:650;letter-spacing:1.3px;text-transform:uppercase}
  .eyebrow svg{width:14px;height:14px;flex:none}
  h1{margin:0;font-size:28px;font-weight:650;line-height:1.2;letter-spacing:-.7px}
  .intro{margin:12px 0 26px;color:var(--muted);font-size:14px;line-height:1.65}
  label{display:block;margin-bottom:8px;font-size:12px;font-weight:600;color:var(--text)}
  .password{position:relative}
  input{display:block;width:100%;min-width:0;height:52px;padding:12px 52px 12px 14px;
    border:1px solid var(--border);border-radius:11px;background:var(--field);color:var(--text);
    font-size:16px;outline:none;transition:border-color 120ms,box-shadow 120ms}
  input::placeholder{color:#718178;opacity:1}
  input:focus{border-color:var(--accent);box-shadow:0 0 0 3px #80d2b915}
  input[aria-invalid="true"]{border-color:var(--error)}
  .visibility{position:absolute;top:4px;right:4px;display:grid;place-items:center;width:44px;height:44px;
    padding:0;border:0;border-radius:8px;background:transparent;color:var(--muted)}
  .visibility:hover{background:#ffffff08;color:var(--text)}
  .visibility svg{width:19px;height:19px}
  .eye-off,.visibility[aria-pressed="true"] .eye-on{display:none}
  .visibility[aria-pressed="true"] .eye-off{display:block}
  .feedback{min-height:20px;margin:8px 0 12px;color:var(--error);font-size:12px;line-height:1.6;overflow-wrap:anywhere}
  .submit{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;min-height:48px;padding:12px 16px;
    border:1px solid transparent;border-radius:11px;background:var(--accent);color:#13241d;
    font-size:14px;font-weight:650;transition:background 120ms,opacity 120ms}
  .submit svg{width:17px;height:17px;flex:none}
  .submit:hover:not(:disabled){background:#9bdfc8}
  .submit:disabled{opacity:.65;cursor:wait}
  @media(max-width:380px){.card{padding:24px}h1{font-size:25px}}
  @media(max-height:600px){body{align-items:flex-start;padding-block:20px}.brand{margin-bottom:20px}.brand-mark{width:44px;height:44px}.card{padding:24px}}
  @media(prefers-reduced-motion:reduce){input,.submit{transition:none}}
  @media(forced-colors:active){.card,input,.submit{border:1px solid CanvasText}.submit{background:ButtonFace;color:ButtonText}}
</style>
</head>
<body>
<main class="unlock">
  <header class="brand">
    ${mark}
    <div><p class="brand-name">ChungusHub</p><p class="brand-tagline">Your stories, your way.</p></div>
  </header>
  <section class="card" aria-labelledby="heading">
    <p class="eyebrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Private workspace</p>
    <h1 id="heading">Welcome back</h1>
    <p class="intro">Enter your password to continue your story.</p>
    <form id="f" method="post" novalidate>
      <label for="pw">Password</label>
      <div class="password">
        <input id="pw" name="password" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="Enter your password" aria-describedby="err" required />
        <button id="visibility" class="visibility" type="button" aria-label="Show password" aria-pressed="false" title="Show password" hidden>
          <svg class="eye-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
          <svg class="eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m3 3 18 18M10.6 5.1A12.7 12.7 0 0 1 12 5c6.4 0 10 7 10 7a19 19 0 0 1-3.4 4.2M6.2 6.2A21 21 0 0 0 2 12s3.6 7 10 7a11.5 11.5 0 0 0 5.8-1.7M10 10a3 3 0 0 0 4 4"/></svg>
        </button>
      </div>
      <p class="feedback" id="err" role="status" aria-live="polite" aria-atomic="true"></p>
      <button class="submit" id="submit" type="submit"><span id="submit-label">Unlock</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button>
    </form>
    <noscript><p class="feedback">Enable JavaScript to unlock ChungusHub.</p></noscript>
  </section>
</main>
<script>
  const form = document.getElementById('f');
  const password = document.getElementById('pw');
  const visibility = document.getElementById('visibility');
  const submit = document.getElementById('submit');
  const submitLabel = document.getElementById('submit-label');
  const feedback = document.getElementById('err');
  let pending = false;
  visibility.hidden = false;
  visibility.addEventListener('pointerdown', (event) => event.preventDefault());
  visibility.addEventListener('click', () => {
    const start = password.selectionStart;
    const end = password.selectionEnd;
    const focused = document.activeElement === password;
    const revealed = password.type === 'password';
    password.type = revealed ? 'text' : 'password';
    visibility.setAttribute('aria-pressed', String(revealed));
    visibility.setAttribute('aria-label', revealed ? 'Hide password' : 'Show password');
    visibility.title = revealed ? 'Hide password' : 'Show password';
    if (focused) password.focus({ preventScroll: true });
    password.setSelectionRange(start, end);
  });
  password.addEventListener('input', () => {
    feedback.textContent = '';
    password.removeAttribute('aria-invalid');
  });
  // Desktop users can type immediately; opening the page on touch should not summon a keyboard.
  if (window.matchMedia('(any-hover: hover)').matches) password.focus({ preventScroll: true });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending) return;
    feedback.textContent = '';
    password.removeAttribute('aria-invalid');
    if (!password.value) {
      feedback.textContent = 'Enter your password.';
      password.focus({ preventScroll: true });
      return;
    }
    pending = true;
    submit.disabled = true;
    submitLabel.textContent = 'Unlocking…';
    form.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: password.value })
      });
      if (response.ok) { location.replace('/'); return; }
      if (response.status === 429) feedback.textContent = 'Too many attempts. Wait 30 seconds.';
      else if (response.status === 401) {
        feedback.textContent = 'Wrong password. Please try again.';
        password.setAttribute('aria-invalid', 'true');
      } else feedback.textContent = "Couldn't unlock this device. Please try again.";
    } catch {
      feedback.textContent = "Couldn't reach ChungusHub. Check your connection and try again.";
    } finally {
      pending = false;
      submit.disabled = false;
      submitLabel.textContent = 'Unlock';
      form.removeAttribute('aria-busy');
    }
  });
</script>
</body>
</html>`;
}
