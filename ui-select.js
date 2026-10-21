/* Vocab Lock – dropdown & combobox kiểu Atlassian, thay cho <select> / <datalist> mặc định của trình duyệt.
   <select> gốc vẫn giữ (ẩn đi) làm nơi lưu giá trị, nên code cũ vẫn dùng .value và sự kiện "change" như bình thường. */
var UISelect = (() => {
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  let openCtl = null;
  let uid = 0;

  // Bấm ra ngoài / đổi kích thước cửa sổ thì đóng menu đang mở (cuộn trang thì menu đi theo ô nhập)
  document.addEventListener('mousedown', (e) => {
    if (openCtl && !openCtl.root.contains(e.target)) openCtl.close();
  }, true);
  window.addEventListener('resize', () => openCtl && openCtl.close());

  /** Cuộn trong menu tới mục, không làm cuộn cả trang */
  function scrollIntoMenu(menu, o) {
    const top = o.offsetTop, bottom = top + o.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
  }

  function makeMenu() {
    const m = document.createElement('div');
    m.className = 'dd-menu';
    m.setAttribute('role', 'listbox');
    m.id = `dd-menu-${++uid}`;
    m.hidden = true;
    return m;
  }

  /** Vẽ các lựa chọn; trả về mảng phần tử theo thứ tự */
  function renderItems(menu, items, selected, onPick, emptyText) {
    menu.textContent = '';
    if (!items.length) {
      const e = document.createElement('div');
      e.className = 'dd-empty';
      e.textContent = emptyText || 'Không có lựa chọn nào';
      menu.append(e);
      return [];
    }
    return items.map((it, i) => {
      const o = document.createElement('div');
      const isSel = it.value === selected;
      o.className = 'dd-opt' + (isSel ? ' selected' : '');
      o.id = `${menu.id}-o${i}`;
      o.dataset.value = it.value;
      o.setAttribute('role', 'option');
      o.setAttribute('aria-selected', String(isSel));
      const body = document.createElement('div');
      body.className = 'dd-body';
      const t = document.createElement('div');
      t.className = 'dd-t';
      t.textContent = it.label || it.value;
      body.append(t);
      if (it.desc) {
        const d = document.createElement('div');
        d.className = 'dd-d';
        d.textContent = it.desc;
        body.append(d);
      }
      o.append(body);
      if (isSel) {
        const ic = VL.icon('check', 16);
        ic.classList.add('dd-check');
        o.append(ic);
      }
      o.addEventListener('mousedown', (e) => e.preventDefault()); // giữ focus ở ô đang dùng
      o.addEventListener('click', () => onPick(it));
      menu.append(o);
      return o;
    });
  }

  /** Mở xuống dưới, hết chỗ thì mở lên trên */
  function place(root, menu) {
    menu.classList.remove('up');
    const r = root.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const need = Math.min(menu.scrollHeight, 300) + 12;
    if (below < need && r.top > below) menu.classList.add('up');
  }

  /** Bộ điều khiển chung cho menu: mở/đóng, phím mũi tên, chọn */
  function controller(root, menu, focusEl) {
    const ctl = {
      root, menu, opts: [], items: [], active: -1,
      isOpen: () => !menu.hidden,
      show(items, selected, onPick, emptyText) {
        if (openCtl && openCtl !== ctl) openCtl.close();
        ctl.items = items;
        ctl.opts = renderItems(menu, items, selected, (it) => { ctl.close(); onPick(it); }, emptyText);
        menu.hidden = false;
        root.classList.add('open');
        focusEl.setAttribute('aria-expanded', 'true');
        place(root, menu);
        openCtl = ctl;
        ctl.setActive(Math.max(0, items.findIndex((x) => x.value === selected)), items.some((x) => x.value === selected));
      },
      close() {
        menu.hidden = true;
        root.classList.remove('open');
        focusEl.setAttribute('aria-expanded', 'false');
        focusEl.removeAttribute('aria-activedescendant');
        if (openCtl === ctl) openCtl = null;
      },
      setActive(i, scroll = true) {
        ctl.active = i;
        ctl.opts.forEach((o, j) => o.classList.toggle('active', j === i));
        const o = ctl.opts[i];
        if (o) {
          focusEl.setAttribute('aria-activedescendant', o.id);
          if (scroll) scrollIntoMenu(menu, o);
        }
      },
      move(d) {
        if (!ctl.opts.length) return;
        ctl.setActive((ctl.active + d + ctl.opts.length) % ctl.opts.length);
      }
    };
    menu.addEventListener('mousemove', (e) => {
      const o = e.target.closest('.dd-opt');
      if (o) {
        const i = ctl.opts.indexOf(o);
        if (i !== ctl.active) ctl.setActive(i, false);
      }
    });
    return ctl;
  }

  /** Biến <select class> nằm trong .tf thành dropdown */
  function enhance(select) {
    const root = select.closest('.tf');
    root.classList.add('dd', 'dd-select');
    select.classList.add('dd-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dd-trigger';
    btn.id = `${select.id}-dd`;
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    label.className = 'dd-value';
    const chev = VL.icon('chevron', 16);
    chev.classList.add('dd-chev');
    btn.append(label, chev);
    root.append(btn);
    const lab = document.querySelector(`label[for="${select.id}"]`);
    if (lab) lab.htmlFor = btn.id;

    const menu = makeMenu();
    btn.setAttribute('aria-controls', menu.id);
    root.append(menu);
    const ctl = controller(root, menu, btn);

    const items = () => [...select.options].map((o) => ({ value: o.value, label: o.textContent, desc: o.dataset.desc || '' }));
    const refresh = () => {
      const o = select.options[select.selectedIndex];
      label.textContent = o ? o.textContent : '';
      label.classList.toggle('placeholder', !o);
    };
    // Gán .value bằng code cũng cập nhật nhãn hiển thị
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() { return valueDesc.get.call(this); },
      set(v) { valueDesc.set.call(this, v); refresh(); }
    });
    new MutationObserver(refresh).observe(select, { childList: true, subtree: true, characterData: true });
    select.addEventListener('change', refresh);

    const pick = (it) => {
      btn.focus();
      if (it.value !== select.value) {
        select.value = it.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    const open = () => ctl.show(items(), select.value, pick);

    btn.addEventListener('click', () => (ctl.isOpen() ? ctl.close() : open()));
    btn.addEventListener('keydown', (e) => {
      if (!ctl.isOpen()) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); ctl.move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); ctl.move(-1); }
      else if (e.key === 'Home') { e.preventDefault(); ctl.setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); ctl.setActive(ctl.opts.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const it = ctl.items[ctl.active];
        ctl.close();
        if (it) pick(it);
      } else if (e.key === 'Escape') { e.preventDefault(); ctl.close(); }
      else if (e.key === 'Tab') ctl.close();
    });
    refresh();
    return ctl;
  }

  /** Ô nhập tự do + danh sách gợi ý lọc theo chữ đang gõ (thay <datalist>) */
  function combobox(input, { getItems, emptyText }) {
    const root = input.closest('.tf');
    root.classList.add('dd', 'dd-combo');
    input.removeAttribute('list');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    const tog = document.createElement('button');
    tog.type = 'button';
    tog.className = 'ibtn dd-toggle';
    tog.tabIndex = -1;
    tog.title = 'Hiện danh sách';
    tog.setAttribute('aria-label', 'Hiện danh sách');
    const chev = VL.icon('chevron', 16);
    chev.classList.add('dd-chev');
    tog.append(chev);
    root.append(tog);

    const menu = makeMenu();
    input.setAttribute('aria-controls', menu.id);
    root.append(menu);
    const ctl = controller(root, menu, input);

    let picking = false; // pick() bắn sự kiện input — không để menu mở lại ngay sau khi chọn
    const pick = (it) => {
      picking = true;
      input.value = it.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
      picking = false;
    };
    const open = (all) => {
      const list = getItems();
      const q = all ? '' : input.value.trim().toLowerCase();
      const shown = q ? list.filter((it) => it.value.toLowerCase().includes(q) || (it.label || '').toLowerCase().includes(q)) : list;
      if (!all && (!list.length || !shown.length)) return ctl.close();
      ctl.show(shown, input.value.trim(), pick, list.length ? 'Không có model nào khớp' : emptyText);
    };

    input.addEventListener('input', () => { if (!picking && document.activeElement === input) open(false); });
    tog.addEventListener('mousedown', (e) => e.preventDefault());
    tog.addEventListener('click', () => {
      if (ctl.isOpen()) ctl.close();
      else { input.focus(); open(true); }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!ctl.isOpen()) open(true);
        else ctl.move(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter' && ctl.isOpen() && ctl.items[ctl.active]) {
        e.preventDefault();
        e.stopImmediatePropagation(); // Enter để chọn, không kích hoạt nút lưu
        const it = ctl.items[ctl.active];
        ctl.close();
        pick(it);
      } else if (e.key === 'Escape' && ctl.isOpen()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        ctl.close();
      } else if (e.key === 'Tab') ctl.close();
    });
    ctl.open = open;
    return ctl;
  }

  return { enhance, combobox };
})();
