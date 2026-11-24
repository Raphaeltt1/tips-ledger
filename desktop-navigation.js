(() => {
  const desktop = matchMedia('(min-width: 681px)');
  const nav = document.getElementById('tabs');
  const sidebar = nav.closest('.noir-sidebar');
  const brand = document.querySelector('.noir-brand');
  const indicator = document.createElement('span');
  indicator.className = 'desktop-nav-light';
  indicator.setAttribute('aria-hidden', 'true');
  const toggle = document.createElement('button');
  toggle.className = 'desktop-nav-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', nav.id);
  toggle.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="m14 3 7 7-3 1-3 4-1 3-8-8 3-1 4-3 1-3ZM9.5 14.5 4 20"/></svg>';
  const buttons = [...nav.querySelectorAll('button[data-tab]')];
  const originalTitles = buttons.map(button => button.getAttribute('title'));
  const key = 'ledger-desktop-sidebar-pinned';
  let pinned = false;
  try { pinned = localStorage.getItem(key) === 'true'; } catch {}
  let hovering = false;
  let keyboardFocus = false;
  let active, animation;

  function setLayout(compact) {
    document.body.dataset.desktopNav = compact ? 'compact' : 'expanded';
    document.body.dataset.sidebarPinned = String(pinned);
    toggle.title = pinned ? 'Unpin sidebar' : 'Pin sidebar';
    toggle.setAttribute('aria-label', 'Pin sidebar');
    toggle.setAttribute('aria-pressed', String(pinned));
    toggle.setAttribute('aria-expanded', String(!compact));
    buttons.forEach((button, index) => {
      const title = compact ? button.getAttribute('aria-label') || button.textContent.trim() : originalTitles[index];
      if (title) button.title = title;
      else button.removeAttribute('title');
    });
  }
  function refreshLayout() {
    if (desktop.matches) setLayout(!(pinned || hovering || keyboardFocus));
  }
  sidebar.addEventListener('pointerenter', event => {
    hovering = event.pointerType === 'mouse' || event.pointerType === 'pen';
    refreshLayout();
  });
  sidebar.addEventListener('pointerleave', () => {
    hovering = false;
    refreshLayout();
  });
  sidebar.addEventListener('pointerdown', () => {
    keyboardFocus = false;
    refreshLayout();
  });
  sidebar.addEventListener('focusin', event => {
    keyboardFocus = event.target.matches(':focus-visible');
    refreshLayout();
  });
  sidebar.addEventListener('focusout', event => {
    if (!sidebar.contains(event.relatedTarget)) {
      keyboardFocus = false;
      refreshLayout();
    }
  });
  toggle.onclick = () => {
    pinned = !pinned;
    try { localStorage.setItem(key, String(pinned)); } catch {}
    refreshLayout();
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
      refreshLayout();
      changes.observe(nav, {subtree: true, attributes: true, attributeFilter: ['class']});
      sizes.observe(nav);
      align();
    } else {
      changes.disconnect();
      sizes.disconnect();
      animation?.cancel();
      active = null;
      if (toggle.isConnected) setLayout(false);
      hovering = keyboardFocus = false;
      delete document.body.dataset.desktopNav;
      delete document.body.dataset.sidebarPinned;
      toggle.remove();
      indicator.remove();
    }
  }
  desktop.addEventListener('change', sync);
  sync();
})();
