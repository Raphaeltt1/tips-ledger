(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const allowedRoles = ['waiter_waitress', 'counter', 'expo', 'admin', 'superuser'];
  const floorPositions = ['floor_team_leader', 'floor_supervisor', 'floor_manager_on_duty'];
  function allowed(profile) {
    if (!profile?.active) return false;
    if (profile.role === 'manager') {
      return profile.management_position == null || floorPositions.includes(profile.management_position);
    }
    return allowedRoles.includes(profile.role);
  }

  let generation = 0;
  let catalog = [];
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const sauceKey = value => normalize(value).replace(/(?:dip|dressing|sauce)$/, '');
  function button(text, onClick) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = text;
    node.onclick = onClick;
    return node;
  }
  function heading(text, level) {
    const node = document.createElement(level);
    node.textContent = text;
    return node;
  }
  function showDetail(item, previous = []) {
    const detail = el('menuDetail');
    el('menuResults').hidden = true;
    detail.replaceChildren(button(previous.length ? 'Back to item' : 'Back to results', () => {
      if (previous.length) showDetail(previous.at(-1), previous.slice(0, -1));
      else { render(); el('menuQuery').focus(); }
    }), heading(item.name, 'h2'), heading('Ingredients', 'h3'));
    const list = document.createElement('ul');
    const sauces = catalog.filter(row => row.category === 'Dips and sauces');
    for (const ingredient of item.ingredients) {
      const li = document.createElement('li');
      for (const part of ingredient.split(/(\s+or\s+)/i)) {
        const key = sauceKey(part.replace(/^choice of /i, '').replace(/\s*\(garnish\)$/i, ''));
        const eligible = sauces.filter(row => row !== item && !previous.includes(row));
        const sauce = eligible.find(row => normalize(row.name) === normalize(part)) ||
          eligible.find(row => sauceKey(row.name) === ({barbecue:'bbq'}[key] || key));
        li.append(sauce ? button(part, () => showDetail(sauce, [...previous, item])) : document.createTextNode(part));
      }
      list.append(li);
    }
    detail.append(item.ingredients.length ? list : heading('Ingredient information unavailable. Check with the manager.', 'p'));
    detail.append(heading('Allergens', 'h3'));
    if (item.allergens.length) detail.append(heading(item.allergens.join(', '), 'p'));
    if (item.check_manager || !item.allergens.length) {
      detail.append(heading(item.allergens.length ? 'Check with the manager for complete allergen information.' :
        'Allergen information unavailable. Check with the manager.', 'p'));
    }
    detail.hidden = false;
    detail.querySelector('h2').tabIndex = -1;
    detail.querySelector('h2').focus();
  }
  function render() {
    const results = el('menuResults');
    const query = normalize(el('menuQuery').value);
    el('menuDetail').replaceChildren();
    el('menuDetail').hidden = true;
    results.replaceChildren();
    results.hidden = !query;
    if (!query) {
      el('menuStatus').textContent = '';
      return;
    }
    const matched = catalog.filter(item => normalize(item.name).includes(query));
    matched.sort((a,b) => Number(normalize(b.name) === query) - Number(normalize(a.name) === query));
    el('menuStatus').textContent = matched.length ? matched.length + ' results' : 'No matching items.';
    for (const item of matched) {
      const entry = button(item.name, () => showDetail(item));
      const category = document.createElement('small');
      category.textContent = item.category;
      entry.append(category);
      results.append(entry);
    }
  }
  function reset() {
    generation++;
    catalog = [];
    el('menuQuery').value = '';
    el('menuQuery').disabled = true;
    el('menuResults').replaceChildren();
    el('menuDetail').replaceChildren();
    el('menuStatus').textContent = '';
  }
  async function open(db, profile) {
    reset();
    if (!allowed(profile)) return;
    const current = generation;
    el('menuStatus').textContent = 'Loading menu…';
    try {
      const {data, error} = await db.from('menu_search_items')
        .select('name,category,ingredients,allergens,check_manager').order('name').order('category');
      if (current !== generation) return;
      if (error) throw error;
      catalog = data;
      el('menuQuery').disabled = false;
      el('menuQuery').oninput = render;
      render();
    } catch {
      if (current === generation) el('menuStatus').replaceChildren(document.createTextNode('Could not load the menu. '), button('Retry', () => open(db, profile)));
    }
  }
  window.MenuSearch = {allowed, open, reset};
})();
