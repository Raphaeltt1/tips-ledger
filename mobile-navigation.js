(() => {
  const nav = document.getElementById('tabs');
  const mobile = matchMedia('(max-width: 680px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const indicator = document.createElement('i');
  indicator.className = 'mobile-tab-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  let selected;
  let frame;

  function update() {
    const button = nav.querySelector('button.active:not(.hidden)');
    if (!mobile.matches || !button?.offsetWidth) {
      indicator.hidden = true;
      selected = null;
      return;
    }
    const center = button.offsetLeft + button.offsetWidth / 2;
    if (button !== selected) {
      indicator.replaceChildren(button.querySelector('svg').cloneNode(true));
      indicator.style.setProperty('--active-color', getComputedStyle(button).getPropertyValue('--tab-color'));
      selected = button;
    }
    indicator.style.transform = 'translateX(' + (center - 17) + 'px)';
    indicator.hidden = false;
    if (button.offsetLeft < nav.scrollLeft || button.offsetLeft + button.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollTo({left: center - nav.clientWidth / 2, behavior: reducedMotion.matches ? 'instant' : 'smooth'});
    }
  }

  function scheduleUpdate() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  }

  const changes = new MutationObserver(scheduleUpdate);
  const sizes = new ResizeObserver(scheduleUpdate);
  function syncLayout() {
    changes.disconnect();
    sizes.disconnect();
    cancelAnimationFrame(frame);
    selected = null;
    if (mobile.matches) {
      nav.append(indicator);
      changes.observe(nav, {subtree: true, attributes: true, attributeFilter: ['class']});
      sizes.observe(nav);
      nav.querySelectorAll('button').forEach(button => sizes.observe(button));
      update();
    } else {
      indicator.remove();
    }
  }
  mobile.addEventListener('change', syncLayout);
  syncLayout();
})();
