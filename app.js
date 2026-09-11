(() => {
  'use strict';

  const STORAGE_KEY = 'budget_data_v1';
  const PERIOD_CUTOFF_DAY = 5; // 每期從發薪日 5 號開始，到次月 4 號結束

  const ACCOUNT_TYPES = [
    { id: 'daily', label: '日常', icon: '🛒' },
    { id: 'savings', label: '儲蓄', icon: '💰' },
    { id: 'creditcard', label: '信用卡', icon: '💳' },
    { id: 'fixed', label: '固定支出', icon: '🏠' },
    { id: 'other', label: '其他', icon: '🎯' },
  ];

  const EXPENSE_CATEGORIES = [
    { id: 'food', label: '餐飲', icon: '🍚', color: 'var(--cat-1)' },
    { id: 'transport', label: '交通', icon: '🚗', color: 'var(--cat-2)' },
    { id: 'shopping', label: '購物', icon: '🛍️', color: 'var(--cat-3)' },
    { id: 'fun', label: '娛樂', icon: '🎮', color: 'var(--cat-4)' },
    { id: 'medical', label: '醫療', icon: '💊', color: 'var(--cat-5)' },
    { id: 'home', label: '居家', icon: '🏠', color: 'var(--cat-6)' },
    { id: 'edu', label: '教育', icon: '📚', color: 'var(--cat-7)' },
    { id: 'subscription', label: '訂閱', icon: '📱', color: 'var(--cat-8)' },
    { id: 'other', label: '其他', icon: '🔖', color: 'var(--cat-muted)' },
  ];

  const INCOME_CATEGORIES = [
    { id: 'salary', label: '薪資', icon: '💰' },
    { id: 'bonus', label: '獎金', icon: '🎁' },
    { id: 'other_income', label: '其他收入', icon: '➕' },
  ];

  /* ---------------- Storage layer ---------------- */
  const Store = {
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {
        console.error('讀取記帳資料失敗', e);
      }
      return { accounts: [], allocations: [], transactions: [] };
    },
    save(d) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    },
  };

  let data = Store.load();

  function ensureSeedAccounts() {
    if (data.accounts.length === 0) {
      data.accounts = [
        { id: uid(), name: '日常帳戶', type: 'daily', icon: '🛒' },
        { id: uid(), name: '儲蓄帳戶', type: 'savings', icon: '💰' },
        { id: uid(), name: '信用卡帳戶', type: 'creditcard', icon: '💳' },
        { id: uid(), name: '固定支出帳戶', type: 'fixed', icon: '🏠' },
      ];
      Store.save(data);
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function fmtMoney(n) {
    return '$' + Math.round(n).toLocaleString('zh-Hant-TW');
  }

  function fmtDateInput(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function parseDateInput(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }

  /* ---------------- Period helpers ---------------- */
  function periodKeyOf(ms) {
    const d = new Date(ms);
    let y = d.getFullYear();
    let m = d.getMonth();
    if (d.getDate() < PERIOD_CUTOFF_DAY) {
      m -= 1;
      if (m < 0) { m = 11; y -= 1; }
    }
    return `${y}-${String(m + 1).padStart(2, '0')}`;
  }

  function periodRange(key) {
    const [y, m] = key.split('-').map(Number);
    const start = new Date(y, m - 1, PERIOD_CUTOFF_DAY).getTime();
    const endExclusive = new Date(y, m, PERIOD_CUTOFF_DAY).getTime();
    return { start, endExclusive };
  }

  function periodLabel(key) {
    const { start, endExclusive } = periodRange(key);
    const s = new Date(start);
    const e = new Date(endExclusive - 86400000);
    return `${s.getMonth() + 1}/${s.getDate()} - ${e.getMonth() + 1}/${e.getDate()}`;
  }

  function shiftPeriod(key, delta) {
    const [y, m] = key.split('-').map(Number);
    const total = (y * 12 + (m - 1)) + delta;
    const ny = Math.floor(total / 12);
    const nm = ((total % 12) + 12) % 12;
    return `${ny}-${String(nm + 1).padStart(2, '0')}`;
  }

  function accountTypeLabel(t) {
    const found = ACCOUNT_TYPES.find((x) => x.id === t);
    return found ? found.label : '其他';
  }

  function categoryInfo(kind, catId) {
    const list = kind === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    return list.find((c) => c.id === catId) || list[list.length - 1];
  }

  /* ---------------- Compute ---------------- */
  function accountBalance(accountId) {
    let bal = 0;
    for (const a of data.allocations) {
      for (const s of a.splits) {
        if (s.accountId === accountId) bal += s.amount;
      }
    }
    for (const t of data.transactions) {
      if (t.accountId !== accountId) continue;
      bal += t.kind === 'income' ? t.amount : -t.amount;
    }
    return bal;
  }

  function periodIncomeTotal(key) {
    let total = 0;
    for (const a of data.allocations) {
      if (periodKeyOf(a.date) === key) total += a.salaryAmount;
    }
    for (const t of data.transactions) {
      if (t.kind === 'income' && t.period === key) total += t.amount;
    }
    return total;
  }

  function periodExpenseTotal(key) {
    let total = 0;
    for (const t of data.transactions) {
      if (t.kind === 'expense' && t.period === key) total += t.amount;
    }
    return total;
  }

  function periodExpenseByCategory(key) {
    const map = {};
    for (const t of data.transactions) {
      if (t.kind !== 'expense' || t.period !== key) continue;
      map[t.category] = (map[t.category] || 0) + t.amount;
    }
    return map;
  }

  function periodSaved(key) {
    const { start, endExclusive } = periodRange(key);
    const savingsIds = new Set(data.accounts.filter((a) => a.type === 'savings').map((a) => a.id));
    if (savingsIds.size === 0) return 0;
    let saved = 0;
    for (const a of data.allocations) {
      if (a.date < start || a.date >= endExclusive) continue;
      for (const s of a.splits) {
        if (savingsIds.has(s.accountId)) saved += s.amount;
      }
    }
    for (const t of data.transactions) {
      if (t.date < start || t.date >= endExclusive) continue;
      if (!savingsIds.has(t.accountId)) continue;
      saved += t.kind === 'income' ? t.amount : -t.amount;
    }
    return saved;
  }

  /* ---------------- View switching ---------------- */
  let currentPeriod = periodKeyOf(Date.now());
  let txKind = 'expense';

  const views = {
    overview: document.getElementById('view-overview'),
    add: document.getElementById('view-add'),
    allocate: document.getElementById('view-allocate'),
    accounts: document.getElementById('view-accounts'),
  };
  const tabBtns = document.querySelectorAll('.tab-btn');

  function switchView(name) {
    Object.entries(views).forEach(([key, el]) => { el.hidden = key !== name; });
    tabBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.view === name));
    if (name === 'overview') renderOverview();
    if (name === 'add') initTxForm();
    if (name === 'allocate') initAllocForm();
    if (name === 'accounts') renderAccountsList();
    renderHeaderStat();
  }

  tabBtns.forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));

  function renderHeaderStat() {
    const income = periodIncomeTotal(currentPeriod);
    const expense = periodExpenseTotal(currentPeriod);
    document.getElementById('header-stat').textContent =
      `${periodLabel(currentPeriod)} · 淨額 ${fmtMoney(income - expense)}`;
  }

  function showSuccess(id) {
    const el = document.getElementById(id);
    el.hidden = false;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.hidden = true; }, 2000);
  }

  /* ---------------- Overview ---------------- */
  document.getElementById('period-prev').addEventListener('click', () => {
    currentPeriod = shiftPeriod(currentPeriod, -1);
    renderOverview();
  });
  document.getElementById('period-next').addEventListener('click', () => {
    currentPeriod = shiftPeriod(currentPeriod, 1);
    renderOverview();
  });

  function renderOverview() {
    document.getElementById('period-label').textContent = periodLabel(currentPeriod);
    const income = periodIncomeTotal(currentPeriod);
    const expense = periodExpenseTotal(currentPeriod);
    const saved = periodSaved(currentPeriod);

    document.getElementById('stat-income').textContent = fmtMoney(income);
    document.getElementById('stat-expense').textContent = fmtMoney(expense);
    const savedEl = document.getElementById('stat-saved');
    savedEl.textContent = fmtMoney(saved);
    savedEl.classList.toggle('negative', saved < 0);

    renderCategoryBreakdown(expense);
    renderAccountBalances();
    renderTxList();
    renderHeaderStat();
  }

  function renderCategoryBreakdown(expenseTotal) {
    const byCat = periodExpenseByCategory(currentPeriod);
    const rows = EXPENSE_CATEGORIES
      .map((c) => ({ ...c, amount: byCat[c.id] || 0 }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    const container = document.getElementById('category-breakdown');
    const emptyEl = document.getElementById('category-empty');
    container.innerHTML = '';
    if (rows.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    const maxAmt = rows[0].amount;
    for (const r of rows) {
      const pct = expenseTotal > 0 ? Math.round((r.amount / expenseTotal) * 100) : 0;
      const barPct = maxAmt > 0 ? (r.amount / maxAmt) * 100 : 0;
      const row = document.createElement('div');
      row.className = 'cat-row';
      row.innerHTML = `
        <div class="cat-row-top">
          <span class="cat-row-name"><span class="cat-swatch" style="background:${r.color}"></span>${r.icon} ${r.label}</span>
          <span class="cat-row-amount">${fmtMoney(r.amount)} · ${pct}%</span>
        </div>
        <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${barPct}%; background:${r.color}"></div></div>
      `;
      container.appendChild(row);
    }
  }

  function renderAccountBalances() {
    const container = document.getElementById('account-balances');
    container.innerHTML = '';
    for (const a of data.accounts) {
      const bal = accountBalance(a.id);
      const row = document.createElement('div');
      row.className = 'account-balance-row';
      row.innerHTML = `
        <span class="account-balance-name"><span></span></span>
        <span class="account-balance-value ${bal < 0 ? 'negative' : ''}">${fmtMoney(bal)}</span>
      `;
      row.querySelector('.account-balance-name span').textContent = `${a.icon} ${a.name}`;
      container.appendChild(row);
    }
  }

  function renderTxList() {
    const list = data.transactions
      .filter((t) => t.period === currentPeriod)
      .sort((a, b) => b.date - a.date);

    const ul = document.getElementById('tx-list');
    const emptyEl = document.getElementById('tx-empty');
    ul.innerHTML = '';
    if (list.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    for (const t of list) {
      const acc = data.accounts.find((a) => a.id === t.accountId);
      const cat = categoryInfo(t.kind, t.category);
      const d = new Date(t.date);
      const dateLabel = `${d.getMonth() + 1}/${d.getDate()}`;

      const li = document.createElement('li');
      li.className = 'tx-row';
      li.innerHTML = `
        <span class="tx-icon">${cat.icon}</span>
        <div class="tx-info">
          <div class="tx-info-top"><span class="tx-cat-label"></span><span class="tx-acc-label"></span></div>
          <div class="tx-info-sub"><span class="tx-date-label"></span><span class="tx-note-label"></span></div>
        </div>
        <span class="tx-amount ${t.kind}">${t.kind === 'expense' ? '-' : '+'}${fmtMoney(t.amount)}</span>
        <button type="button" class="tx-delete" aria-label="刪除">🗑</button>
      `;
      li.querySelector('.tx-cat-label').textContent = cat.label;
      li.querySelector('.tx-acc-label').textContent = acc ? `· ${acc.name}` : '· （已刪除帳戶）';
      li.querySelector('.tx-date-label').textContent = dateLabel;
      li.querySelector('.tx-note-label').textContent = t.note ? ` · ${t.note}` : '';
      li.querySelector('.tx-delete').addEventListener('click', () => {
        if (confirm('確定要刪除這筆紀錄嗎？')) {
          data.transactions = data.transactions.filter((x) => x.id !== t.id);
          Store.save(data);
          renderOverview();
        }
      });
      ul.appendChild(li);
    }
  }

  /* ---------------- Add transaction ---------------- */
  function populateTxAccountSelect() {
    const sel = document.getElementById('tx-account');
    sel.innerHTML = data.accounts
      .map((a) => `<option value="${a.id}">${escapeHtml(a.icon)} ${escapeHtml(a.name)}</option>`)
      .join('');
  }

  function categoryOptionsHtml(kind) {
    const list = kind === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    return list.map((c) => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');
  }

  function populateTxCategorySelect() {
    document.getElementById('tx-category').innerHTML = categoryOptionsHtml(txKind);
  }

  function populateTxPeriodSelect(dateMs) {
    const sel = document.getElementById('tx-period');
    const base = periodKeyOf(dateMs);
    const options = [shiftPeriod(base, -1), base, shiftPeriod(base, 1)];
    sel.innerHTML = options
      .map((k) => `<option value="${k}">${periodLabel(k)}${k === base ? '（依日期）' : ''}</option>`)
      .join('');
    sel.value = base;
  }

  function setTxKind(kind) {
    txKind = kind;
    document.querySelectorAll('#tx-kind-toggle .segmented-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.kind === kind);
    });
    populateTxCategorySelect();

    const splitToggleRow = document.getElementById('tx-split-toggle-row');
    if (kind !== 'expense') {
      splitToggleRow.hidden = true;
      document.getElementById('tx-split-toggle').checked = false;
      setTxSplitMode(false);
    } else {
      splitToggleRow.hidden = false;
    }
  }

  document.querySelectorAll('#tx-kind-toggle .segmented-btn').forEach((btn) => {
    btn.addEventListener('click', () => setTxKind(btn.dataset.kind));
  });

  document.getElementById('tx-date').addEventListener('change', (e) => {
    if (e.target.value) populateTxPeriodSelect(parseDateInput(e.target.value));
  });

  /* ---- split mode (one entry, multiple category amounts) ---- */
  function setTxSplitMode(on) {
    document.getElementById('field-category').hidden = on;
    document.getElementById('tx-splits').hidden = !on;
    if (on && document.querySelectorAll('.tx-split-row').length === 0) {
      addTxSplitRow();
      addTxSplitRow();
    }
    updateTxSplitRemaining();
  }

  document.getElementById('tx-split-toggle').addEventListener('change', (e) => {
    setTxSplitMode(e.target.checked);
  });

  function addTxSplitRow() {
    const row = document.createElement('div');
    row.className = 'tx-split-row';
    row.innerHTML = `
      <select class="tx-split-category">${categoryOptionsHtml('expense')}</select>
      <input type="number" class="tx-split-amount" placeholder="0" min="0" step="1" inputmode="numeric">
      <button type="button" class="tx-split-remove" aria-label="移除">✕</button>
    `;
    row.querySelector('.tx-split-amount').addEventListener('input', updateTxSplitRemaining);
    row.querySelector('.tx-split-remove').addEventListener('click', () => {
      row.remove();
      updateTxSplitRemaining();
    });
    document.getElementById('tx-split-rows').appendChild(row);
  }

  document.getElementById('tx-split-add').addEventListener('click', addTxSplitRow);
  document.getElementById('tx-amount').addEventListener('input', updateTxSplitRemaining);

  function updateTxSplitRemaining() {
    const total = Number(document.getElementById('tx-amount').value) || 0;
    let sum = 0;
    document.querySelectorAll('.tx-split-amount').forEach((i) => { sum += Number(i.value) || 0; });
    const remaining = total - sum;
    const el = document.getElementById('tx-split-remaining');
    el.textContent = remaining === 0 && total > 0 ? '✅ 分類金額加總相符' : `尚未分類：${fmtMoney(remaining)}`;
    el.classList.toggle('balanced', remaining === 0 && total > 0);
    el.classList.toggle('unbalanced', remaining !== 0);
  }

  function initTxForm() {
    populateTxAccountSelect();
    document.getElementById('tx-split-toggle').checked = false;
    document.getElementById('tx-split-rows').innerHTML = '';
    setTxKind('expense');
    setTxSplitMode(false);
    const today = new Date();
    document.getElementById('tx-date').value = fmtDateInput(today);
    document.getElementById('tx-amount').value = '';
    document.getElementById('tx-note').value = '';
    populateTxPeriodSelect(today.getTime());
  }

  document.getElementById('tx-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const accountId = document.getElementById('tx-account').value;
    const amount = Number(document.getElementById('tx-amount').value);
    const dateStr = document.getElementById('tx-date').value;
    const period = document.getElementById('tx-period').value;
    const note = document.getElementById('tx-note').value.trim();
    const splitMode = txKind === 'expense' && document.getElementById('tx-split-toggle').checked;

    if (!accountId || !amount || amount <= 0 || !dateStr) return;

    if (splitMode) {
      const rows = [];
      document.querySelectorAll('.tx-split-row').forEach((row) => {
        const category = row.querySelector('.tx-split-category').value;
        const rowAmount = Number(row.querySelector('.tx-split-amount').value) || 0;
        if (rowAmount > 0) rows.push({ category, amount: rowAmount });
      });
      if (rows.length === 0) {
        alert('請至少輸入一筆分類金額');
        return;
      }
      const sum = rows.reduce((s, r) => s + r.amount, 0);
      if (Math.abs(sum - amount) > 0.5) {
        const ok = confirm(`分類金額加總 ${fmtMoney(sum)} 跟輸入的總額 ${fmtMoney(amount)} 不同，確定要這樣送出嗎？`);
        if (!ok) return;
      }
      for (const r of rows) {
        data.transactions.unshift({
          id: uid(), kind: 'expense', date: parseDateInput(dateStr), period, accountId,
          category: r.category, amount: r.amount, note,
        });
      }
    } else {
      const category = document.getElementById('tx-category').value;
      data.transactions.unshift({
        id: uid(), kind: txKind, date: parseDateInput(dateStr), period, accountId, category, amount, note,
      });
    }
    Store.save(data);

    initTxForm();
    showSuccess('tx-success');
    renderHeaderStat();
  });

  /* ---------------- Allocate salary ---------------- */
  let editingAllocId = null;

  function renderAllocSplitsInputs(presetByAccountId) {
    const container = document.getElementById('alloc-splits');
    container.innerHTML = data.accounts.map((a) => `
      <div class="alloc-split-row" data-account-id="${a.id}">
        <span class="alloc-split-label">${escapeHtml(a.icon)} ${escapeHtml(a.name)}</span>
        <input type="number" class="alloc-split-input" min="0" step="1" placeholder="0" inputmode="numeric"
          value="${presetByAccountId && presetByAccountId[a.id] ? presetByAccountId[a.id] : ''}">
      </div>
    `).join('');
    container.querySelectorAll('.alloc-split-input').forEach((inp) => {
      inp.addEventListener('input', updateAllocRemaining);
    });
  }

  function updateAllocRemaining() {
    const salary = Number(document.getElementById('alloc-salary').value) || 0;
    let sum = 0;
    document.querySelectorAll('.alloc-split-input').forEach((i) => { sum += Number(i.value) || 0; });
    const remaining = salary - sum;
    const el = document.getElementById('alloc-remaining');
    el.textContent = remaining === 0 && salary > 0 ? '✅ 已全部分配完成' : `尚未分配：${fmtMoney(remaining)}`;
    el.classList.toggle('balanced', remaining === 0 && salary > 0);
    el.classList.toggle('unbalanced', remaining !== 0);
  }

  document.getElementById('alloc-salary').addEventListener('input', updateAllocRemaining);

  function setAllocEditMode(alloc) {
    editingAllocId = alloc ? alloc.id : null;
    document.getElementById('alloc-submit-btn').textContent = editingAllocId ? '💾 更新這筆分配' : '💾 儲存分配';
    document.getElementById('alloc-cancel-edit').hidden = !editingAllocId;
  }

  document.getElementById('alloc-cancel-edit').addEventListener('click', () => {
    initAllocForm();
  });

  function initAllocForm() {
    setAllocEditMode(null);
    renderAllocSplitsInputs();
    document.getElementById('alloc-date').value = fmtDateInput(new Date());
    document.getElementById('alloc-salary').value = '';
    document.getElementById('alloc-note').value = '';
    updateAllocRemaining();
    renderAllocList();
  }

  function loadAllocIntoForm(alloc, { asCopy } = {}) {
    setAllocEditMode(asCopy ? null : alloc);
    let dateMs = alloc.date;
    if (asCopy) {
      const d = new Date(alloc.date);
      d.setMonth(d.getMonth() + 1);
      dateMs = d.getTime();
    }
    document.getElementById('alloc-date').value = fmtDateInput(new Date(dateMs));
    document.getElementById('alloc-salary').value = alloc.salaryAmount;
    document.getElementById('alloc-note').value = alloc.note || '';
    const presetByAccountId = {};
    alloc.splits.forEach((s) => { presetByAccountId[s.accountId] = s.amount; });
    renderAllocSplitsInputs(presetByAccountId);
    updateAllocRemaining();
    document.getElementById('alloc-date').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  document.getElementById('alloc-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const dateStr = document.getElementById('alloc-date').value;
    const salaryAmount = Number(document.getElementById('alloc-salary').value);
    const note = document.getElementById('alloc-note').value.trim();

    if (!dateStr || !salaryAmount || salaryAmount <= 0) return;

    const splits = [];
    document.querySelectorAll('.alloc-split-row').forEach((row) => {
      const accountId = row.dataset.accountId;
      const amount = Number(row.querySelector('.alloc-split-input').value) || 0;
      if (amount > 0) splits.push({ accountId, amount });
    });
    if (splits.length === 0) {
      alert('請至少分配金額到一個帳戶');
      return;
    }

    if (editingAllocId) {
      const idx = data.allocations.findIndex((x) => x.id === editingAllocId);
      if (idx !== -1) {
        data.allocations[idx] = { id: editingAllocId, date: parseDateInput(dateStr), salaryAmount, splits, note };
      }
    } else {
      data.allocations.unshift({ id: uid(), date: parseDateInput(dateStr), salaryAmount, splits, note });
    }
    Store.save(data);

    initAllocForm();
    showSuccess('alloc-success');
    renderHeaderStat();
  });

  function renderAllocList() {
    const ul = document.getElementById('alloc-list');
    const emptyEl = document.getElementById('alloc-empty');
    ul.innerHTML = '';
    if (data.allocations.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    const sorted = [...data.allocations].sort((a, b) => b.date - a.date);
    for (const a of sorted) {
      const d = new Date(a.date);
      const dateLabel = `${d.getMonth() + 1}/${d.getDate()}`;
      const chips = a.splits.map((s) => {
        const acc = data.accounts.find((x) => x.id === s.accountId);
        const name = acc ? `${escapeHtml(acc.icon)} ${escapeHtml(acc.name)}` : '（已刪除帳戶）';
        return `<span class="alloc-chip">${name} ${fmtMoney(s.amount)}</span>`;
      }).join('');

      const li = document.createElement('li');
      li.className = 'alloc-row';
      li.innerHTML = `
        <div class="alloc-row-top"><span>${dateLabel} 發薪</span><span>${fmtMoney(a.salaryAmount)}</span></div>
        ${a.note ? `<div class="alloc-row-sub">${escapeHtml(a.note)}</div>` : ''}
        <div class="alloc-chips">${chips}</div>
        <div class="alloc-row-actions">
          <button type="button" class="alloc-copy-btn">📋 複製到下個月</button>
          <button type="button" class="alloc-edit-btn">✏️ 編輯</button>
          <button type="button" class="alloc-delete-btn danger">🗑 刪除</button>
        </div>
      `;
      li.querySelector('.alloc-copy-btn').addEventListener('click', () => loadAllocIntoForm(a, { asCopy: true }));
      li.querySelector('.alloc-edit-btn').addEventListener('click', () => loadAllocIntoForm(a, { asCopy: false }));
      li.querySelector('.alloc-delete-btn').addEventListener('click', () => {
        if (confirm('確定要刪除這筆分配紀錄嗎？')) {
          data.allocations = data.allocations.filter((x) => x.id !== a.id);
          if (editingAllocId === a.id) initAllocForm();
          Store.save(data);
          renderAllocList();
          renderHeaderStat();
        }
      });
      ul.appendChild(li);
    }
  }

  /* ---------------- Accounts ---------------- */
  function populateAccountTypeSelect() {
    const sel = document.getElementById('account-type');
    sel.innerHTML = ACCOUNT_TYPES.map((t) => `<option value="${t.id}">${t.icon} ${t.label}</option>`).join('');
  }

  function renderAccountsList() {
    const ul = document.getElementById('accounts-list');
    ul.innerHTML = '';
    for (const a of data.accounts) {
      const bal = accountBalance(a.id);
      const li = document.createElement('li');
      li.className = 'account-row';
      li.innerHTML = `
        <span class="tx-icon">${escapeHtml(a.icon || '🎯')}</span>
        <div class="account-row-info">
          <div class="account-row-name"></div>
          <div class="account-row-type">${escapeHtml(accountTypeLabel(a.type))}</div>
        </div>
        <div class="account-row-balance ${bal < 0 ? 'negative' : ''}">${fmtMoney(bal)}</div>
        <button type="button" class="account-row-delete" aria-label="刪除帳戶">🗑</button>
      `;
      li.querySelector('.account-row-name').textContent = a.name;
      li.querySelector('.account-row-delete').addEventListener('click', () => {
        const used = data.allocations.some((al) => al.splits.some((s) => s.accountId === a.id))
          || data.transactions.some((t) => t.accountId === a.id);
        if (used) {
          alert('這個帳戶已經有分配或交易紀錄，無法刪除。');
          return;
        }
        if (confirm(`確定要刪除帳戶「${a.name}」嗎？`)) {
          data.accounts = data.accounts.filter((x) => x.id !== a.id);
          Store.save(data);
          renderAccountsList();
          populateTxAccountSelect();
          renderAllocSplitsInputs();
        }
      });
      ul.appendChild(li);
    }
  }

  document.getElementById('account-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('account-name').value.trim();
    let icon = document.getElementById('account-icon').value.trim();
    const type = document.getElementById('account-type').value;
    if (!name) return;
    if (!icon) {
      const t = ACCOUNT_TYPES.find((x) => x.id === type);
      icon = t ? t.icon : '🎯';
    }
    data.accounts.push({ id: uid(), name, icon, type });
    Store.save(data);

    e.target.reset();
    renderAccountsList();
    populateTxAccountSelect();
    renderAllocSplitsInputs();
  });

  /* ---------------- Backup: export / import ---------------- */
  document.getElementById('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget-backup-${fmtDateInput(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!imported || !Array.isArray(imported.accounts) || !Array.isArray(imported.allocations)
          || !Array.isArray(imported.transactions)) {
          throw new Error('格式錯誤');
        }
        data = imported;
        Store.save(data);
        alert('匯入完成！');
        renderAll();
      } catch (err) {
        alert('匯入失敗，請確認是本 App 匯出的 JSON 檔案。');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  function renderAll() {
    populateAccountTypeSelect();
    populateTxAccountSelect();
    renderOverview();
    renderAccountsList();
    renderAllocList();
  }

  /* ---------------- PWA: service worker ---------------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }

  /* ---------------- Init ---------------- */
  ensureSeedAccounts();
  populateAccountTypeSelect();
  populateTxAccountSelect();
  switchView('overview');
})();
