// The real value stays in the layout and accessibility tree while its visual copy counts up.
document.addEventListener('animationstart', event => {
  if (event.animationName !== 'ledger-count-entry') return;
  const host = event.target;
  if (host.children.length) return;
  const label = host.textContent;
  if (!/^(?:LBP |\$)?[\d,]+(?:\.\d+)?(?:%| \/ [\d,]+)?$/.test(label)) return;
  const token = label.match(/[\d,]+(?:\.\d+)?/)[0];
  const value = Number(token.replaceAll(',', ''));
  if (!value || !Number.isFinite(value)) return;
  const digits = token.split('.')[1]?.length || 0;
  const format = new Intl.NumberFormat('en-US', {minimumFractionDigits: digits, maximumFractionDigits: digits});
  const source = document.createElement('span');
  source.className = 'ledger-count-source';
  source.textContent = label;
  const frame = document.createElement('span');
  frame.className = 'ledger-count-frame';
  frame.setAttribute('aria-hidden', 'true');
  host.classList.add('ledger-count-host');
  host.replaceChildren(source, frame);
  const start = performance.now();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  function update(now) {
    if (source.parentNode !== host) return;
    const progress = Math.min(1, Math.max(0, (now - start) / 800));
    if (progress === 1 || reduce.matches || !host.isConnected || !host.getClientRects().length) {
      host.replaceChildren(source.firstChild);
      host.classList.remove('ledger-count-host');
      return;
    }
    frame.textContent = label.replace(token, format.format(value * (1 - (1 - progress) ** 3)));
    requestAnimationFrame(update);
  }
  update(start);
});
