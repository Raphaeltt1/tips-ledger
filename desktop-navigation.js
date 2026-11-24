(() => {
  const desktop = matchMedia('(min-width: 681px)');
  const nav = document.getElementById('tabs');
  const brand = document.querySelector('.noir-brand');
  const indicator = document.createElement('span');
  indicator.className = 'desktop-nav-light';
  indicator.setAttribute('aria-hidden', 'true');
  const toggle = document.createElement('button');
  toggle.className = 'desktop-nav-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', nav.id);
  toggle.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M9 4v16m8-11-3 3 3 3"/></svg>';
  const buttons = [...nav.querySelectorAll('button[data-tab]')];
  const originalTitles = buttons.map(button => button.getAttribute('title'));
  const key = 'ledger-desktop-sidebar';
  let preference;
  try { preference = localStorage.getItem(key); } catch {}
  let active, animation;

  function setLayout(compact) {
    document.body.dataset.desktopNav = compact ? 'compact' : 'expanded';
    toggle.title = compact ? 'Expand sidebar' : 'Collapse sidebar';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-expanded', String(!compact));
    buttons.forEach((button, index) => {
      const title = compact ? button.getAttribute('aria-label') || button.textContent.trim() : originalTitles[index];
      if (title) button.title = title;
      else button.removeAttribute('title');
    });
  }
  toggle.onclick = () => {
    const compact = document.body.dataset.desktopNav !== 'compact';
    preference = compact ? 'compact' : 'expanded';
    try { localStorage.setItem(key, preference); } catch {}
    setLayout(compact);
  };

  function align() {
    if (!desktop.matches) return;
    const next = nav.querySelector('button.active:not(.hidden)');
    if (!next?.offsetHeight) {
      active = null;
      indicator.hidden = true;
      return;
    }
    const top = next.offsetTop;
    const height = next.offsetHeight;
    const from = indicator.getBoundingClientRect().top - nav.getBoundingClientRect().top;
    indicator.hidden = false;
    indicator.style.top = top + 'px';
    indicator.style.height = height + 'px';
    if (active && next !== active && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animation?.cancel();
      const distance = top - from;
      const stretch = Math.min(38, Math.abs(distance) * .5);
      animation = indicator.animate([
        {top: from + 'px', height: height + 'px'},
        {top: ((from + top - stretch) / 2) + 'px', height: (height + stretch) + 'px', offset: .45},
        {top: top + 'px', height: height + 'px'}
      ], {duration: 330, easing: 'cubic-bezier(.23,.72,.22,1)'});
    }
    active = next;
  }
  const changes = new MutationObserver(align);
  const sizes = new ResizeObserver(align);
  function sync() {
    if (desktop.matches) {
      brand.prepend(toggle);
      nav.prepend(indicator);
      setLayout(preference ? preference === 'compact' : matchMedia('(max-width: 980px)').matches);
      changes.observe(nav, {subtree: true, attributes: true, attributeFilter: ['class']});
      sizes.observe(nav);
      align();
    } else {
      changes.disconnect();
      sizes.disconnect();
      animation?.cancel();
      active = null;
      if (toggle.isConnected) setLayout(false);
      delete document.body.dataset.desktopNav;
      toggle.remove();
      indicator.remove();
    }
  }
  desktop.addEventListener('change', sync);
  sync();
})();
