(() => {
  const nav = document.getElementById('tabs');
  const mobile = matchMedia('(max-width: 680px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const indicator = document.createElement('i');
  indicator.className = 'mobile-tab-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  let preview, drag, frame, dragFrame;

  const center = button => button.offsetLeft + button.offsetWidth / 2;
  const visibleTabs = () => [...nav.querySelectorAll('button[data-tab]')].filter(button => button.offsetWidth && !button.disabled);

  function show(button, x) {
    if (button !== preview) {
      preview?.removeAttribute('data-preview');
      preview = button;
      if (button) {
        button.setAttribute('data-preview', '');
        indicator.replaceChildren(button.querySelector('svg').cloneNode(true));
        indicator.style.setProperty('--active-color', getComputedStyle(button).getPropertyValue('--tab-color'));
      }
    }
    indicator.hidden = !button;
    if (button) indicator.style.setProperty('--center', x + 'px');
  }

  function update() {
    if (!mobile.matches || drag) return;
    const button = nav.querySelector('button.active');
    if (!button?.offsetWidth) return show(null);
    show(button, center(button));
    if (button.offsetLeft < nav.scrollLeft || button.offsetLeft + button.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollTo({left: center(button) - nav.clientWidth / 2, behavior: reducedMotion.matches ? 'instant' : 'smooth'});
    }
  }

  function scheduleUpdate() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  }

  function track(time, scroll = true) {
    const tabs = visibleTabs();
    if (!tabs.length) return show(null);
    const x = drag.clientX - nav.getBoundingClientRect().left;
    const edge = 35;
    const pressure = x < edge ? x - edge : Math.max(0, x - nav.clientWidth + edge);
    if (scroll) nav.scrollLeft += Math.max(-1, Math.min(1, pressure / edge)) * Math.min(32, time - drag.time) * 0.5;
    const position = Math.max(center(tabs[0]), Math.min(center(tabs[tabs.length - 1]), x + nav.scrollLeft));
    const target = tabs.reduce((best, tab) => Math.abs(center(tab) - position) < Math.abs(center(best) - position) ? tab : best);
    const delta = position - drag.position;
    const stretch = Math.min(.26, Math.abs(delta) * .02 + drag.stretch * .72);
    if (delta) indicator.style.setProperty('--origin', delta > 0 ? 'left' : 'right');
    indicator.style.setProperty('--stretch', 1 + stretch);
    indicator.style.setProperty('--squash', 1 - stretch / 2);
    Object.assign(drag, {time, position, stretch});
    show(target, position);
  }

  function tick(time) {
    if (!drag) return;
    track(time);
    dragFrame = requestAnimationFrame(tick);
  }

  indicator.addEventListener('pointerdown', event => {
    if (drag || !event.isPrimary || event.button !== 0 || !preview) return;
    event.preventDefault();
    indicator.setPointerCapture(event.pointerId);
    drag = {id: event.pointerId, clientX: event.clientX, position: center(preview), stretch: 0, time: performance.now()};
    indicator.setAttribute('data-held', '');
    dragFrame = requestAnimationFrame(tick);
  });
  indicator.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) drag.clientX = event.clientX;
  });

  function finish(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const commit = event?.type === 'pointerup';
    if (commit) {
      drag.clientX = event.clientX;
      track(performance.now(), false);
    }
    const target = preview;
    const id = drag.id;
    drag = null;
    cancelAnimationFrame(dragFrame);
    if (indicator.hasPointerCapture(id)) indicator.releasePointerCapture(id);
    indicator.removeAttribute('data-held');
    for (const property of ['--stretch', '--squash', '--origin']) indicator.style.removeProperty(property);
    if (commit && target?.offsetWidth && !target.classList.contains('active')) target.click();
    update();
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) indicator.addEventListener(type, finish);
  indicator.addEventListener('contextmenu', event => event.preventDefault());

  const changes = new MutationObserver(scheduleUpdate);
  const sizes = new ResizeObserver(scheduleUpdate);
  function syncLayout() {
    finish();
    changes.disconnect();
    sizes.disconnect();
    cancelAnimationFrame(frame);
    show(null);
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
