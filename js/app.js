/* ==========================================================================
   3MTT POS APP - APP CONTROLLER (Real Sales & Expense Ledger)
   ========================================================================== */

import { sound } from './audio.js';
import { store } from './transactions.js';
import { receiptManager } from './receipt.js';

// URL of the deployed backend (see /pos-otp-server). Update after deploying to Render.
const API_BASE = 'https://threemtt-pos-app.onrender.com';

class POSApp {
  constructor() {
    this.isPinMasked = true;

    // OTP state (verification itself happens server-side)
    this._pendingRegData = null;
    this._otpTimerInterval = null;

    // Real sales/expenses fetched from Supabase (via the backend)
    this.ledgerEntries = [];

    this.initDOM();
    this.initEventListeners();
    this.populateSaleItemSuggestions();
    this.renderDashboard();
    this.renderProfileScreen();
    this.renderHistoryScreen('ALL');
    this.loadLedgerFromBackend();
  }

  // Fetch this agent's real sales and expenses from Supabase and normalize
  // them into one list every ledger view (Home preview, Business, History) shares.
  async loadLedgerFromBackend() {
    if (!store.currentUserId) return; // not signed in to a real account yet

    try {
      const [salesRes, expensesRes] = await Promise.all([
        fetch(`${API_BASE}/api/sales?userId=${store.currentUserId}`),
        fetch(`${API_BASE}/api/expenses?userId=${store.currentUserId}`)
      ]);
      const salesData = await salesRes.json();
      const expensesData = await expensesRes.json();

      const sales = (salesData.sales || []).map(s => ({
        type: 'SALE',
        title: (s.sale_items && s.sale_items[0] && s.sale_items[0].name) || 'Sale',
        category: s.sale_items && s.sale_items.length > 1 ? `${s.sale_items.length} items` : 'Goods Sold',
        amount: Number(s.total),
        note: s.note || '',
        timestamp: s.created_at
      }));

      const expenses = (expensesData.expenses || []).map(e => ({
        type: 'EXPENSE',
        title: e.category || 'Expense',
        category: e.category || 'General Expense',
        amount: Number(e.amount),
        note: e.note || '',
        timestamp: e.created_at
      }));

      this.ledgerEntries = [...sales, ...expenses].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      this.renderDashboard();
      this.renderHistoryScreen('ALL');
    } catch (err) {
      console.error('loadLedgerFromBackend error:', err);
      this.showToast('Could not load your sales/expenses right now');
    }
  }

  // ---- Shared ledger item rendering (used by Home preview, Business tab, History tab) ----
  renderLedgerItemsHTML(entries, emptyMessage = 'No sales or expense entries yet') {
    if (entries.length === 0) {
      return `
        <div style="text-align:center; padding:2.5rem 1rem; color:var(--text-muted); background:var(--surface-white); border-radius:var(--radius-lg);">
          <div style="font-size:2.5rem; margin-bottom:0.5rem;">📊</div>
          <div style="font-weight:700;">${emptyMessage}</div>
          <div style="font-size:0.8rem; margin-top:0.25rem;">Use the buttons above to record your first entry.</div>
        </div>
      `;
    }

    return entries.map(item => `
      <div class="biz-ledger-item">
        <div style="display:flex; align-items:center; gap:0.85rem;">
          <div class="biz-item-icon ${item.type.toLowerCase()}">
            ${item.type === 'SALE' ? '📈' : '⛽'}
          </div>
          <div>
            <div style="font-size:1.05rem; font-weight:800; color:var(--text-dark);">${item.title}</div>
            <div style="font-size:0.8rem; color:var(--text-muted); display:flex; gap:0.5rem; align-items:center;">
              <span style="font-weight:700; color:var(--ng-green-dark);">${item.category}</span>
              <span>•</span>
              <span>${receiptManager.formatDate(item.timestamp)}</span>
            </div>
            ${item.note ? `<div style="font-size:0.75rem; color:var(--text-dim); margin-top:2px;">${item.note}</div>` : ''}
          </div>
        </div>
        <div style="text-align:right;">
          <div class="biz-item-amount ${item.type.toLowerCase()}">
            ${item.type === 'SALE' ? '+₦' : '-₦'}${item.amount.toLocaleString()}
          </div>
          <span style="font-size:0.68rem; font-weight:800; padding:0.2rem 0.55rem; border-radius:var(--radius-full); text-transform:uppercase; background:${item.type === 'SALE' ? 'var(--ng-green-pill-bg)' : '#fee2e2'}; color:${item.type === 'SALE' ? 'var(--ng-green-main)' : '#dc2626'};">
            ${item.type}
          </span>
        </div>
      </div>
    `).join('');
  }

  getLedgerStats(entries) {
    const totalSales = entries.filter(e => e.type === 'SALE').reduce((sum, e) => sum + e.amount, 0);
    const totalExpenses = entries.filter(e => e.type === 'EXPENSE').reduce((sum, e) => sum + e.amount, 0);
    return { totalSales, totalExpenses, netProfit: totalSales - totalExpenses };
  }

  setStatDisplay(prefixId, stats) {
    const salesElem = document.getElementById(`${prefixId}-total-sales`);
    const expensesElem = document.getElementById(`${prefixId}-total-expenses`);
    const profitElem = document.getElementById(`${prefixId}-net-profit`);

    if (salesElem) salesElem.textContent = `₦${stats.totalSales.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
    if (expensesElem) expensesElem.textContent = `₦${stats.totalExpenses.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
    if (profitElem) {
      const prefix = stats.netProfit >= 0 ? '+' : '';
      profitElem.textContent = `${prefix}₦${stats.netProfit.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
      profitElem.style.color = stats.netProfit >= 0 ? 'var(--ng-green-main)' : '#dc2626';
    }
  }

  // ---- Home dashboard ----
  renderDashboard() {
    const titleElem = document.getElementById('dash-business-title');
    if (titleElem) titleElem.textContent = store.agentBusiness || 'My Business';

    const avatarElem = document.getElementById('dash-avatar-circle');
    if (avatarElem) {
      const initials = (store.agentBusiness || store.agentName || 'AG')
        .split(' ')
        .filter(Boolean)
        .map(w => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();
      avatarElem.textContent = initials || 'AG';
    }

    this.setStatDisplay('home', this.getLedgerStats(this.ledgerEntries));

    const recentContainer = document.getElementById('home-recent-entries-container');
    if (recentContainer) {
      recentContainer.innerHTML = this.renderLedgerItemsHTML(this.ledgerEntries.slice(0, 5));
    }
  }

  // ---- History tab (full ledger, same data, its own filter) ----
  renderHistoryScreen(filter = 'ALL') {
    const listElem = document.getElementById('history-items-container');
    if (!listElem) return;

    let entries = this.ledgerEntries;
    if (filter !== 'ALL') entries = entries.filter(e => e.type === filter);
    listElem.innerHTML = this.renderLedgerItemsHTML(entries, 'No entries found');
  }

  renderProfileScreen() {
    const avatarElem = document.getElementById('profile-avatar-circle');
    const bizElem = document.getElementById('profile-business-name');
    const phoneElem = document.getElementById('profile-agent-phone');
    const nameElem = document.getElementById('profile-agent-name');
    const emailElem = document.getElementById('profile-agent-email');
    const statusElem = document.getElementById('profile-agent-status');

    const initials = (store.agentBusiness || store.agentName || 'AG')
      .split(' ')
      .filter(Boolean)
      .map(w => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    if (avatarElem) avatarElem.textContent = initials || 'AG';
    if (bizElem) bizElem.textContent = store.agentBusiness || 'Agent Business';
    if (phoneElem) phoneElem.textContent = store.agentPhone || '';
    if (nameElem) nameElem.textContent = store.agentName || store.agentBusiness;
    if (emailElem) emailElem.textContent = store.agentEmail || '';
    if (statusElem) statusElem.textContent = 'Active / Online';
  }

  // ---- Multi-item Record Sale modal helpers ----

  createSaleItemRowHTML() {
    return `
      <div class="sale-item-row" data-item-row>
        <div class="sale-item-row-fields">
          <input type="text" class="sale-item-name" placeholder="Item name" list="sale-item-suggestions" autocomplete="off" />
          <input type="number" class="sale-item-qty" placeholder="Qty" min="0.01" step="any" value="1" />
          <input type="text" class="sale-item-unit" placeholder="Unit" list="sale-unit-suggestions" value="pcs" autocomplete="off" />
          <input type="number" class="sale-item-price" placeholder="₦ Price / unit" min="0" step="0.01" />
        </div>
        <button type="button" class="btn-remove-item-row" aria-label="Remove item">✕</button>
      </div>
    `;
  }

  // ---- Recently used sale items (device-local, so typing a few letters of
  //      a previously recorded item name auto-suggests it and autofills its
  //      last used unit + price) ----
  loadRecentSaleItems() {
    try {
      const raw = localStorage.getItem('3mtt_pos_recent_sale_items_v1');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  saveRecentSaleItems(items) {
    // items: array of {name, quantity, unit, unitPrice}
    const existing = this.loadRecentSaleItems();
    items.forEach(({ name, unit, unitPrice }) => {
      if (!name) return;
      const key = name.trim().toLowerCase();
      const idx = existing.findIndex(it => it.name.toLowerCase() === key);
      const entry = { name: name.trim(), unit: unit || 'pcs', unitPrice: unitPrice ?? '' };
      if (idx > -1) existing.splice(idx, 1);
      existing.unshift(entry);
    });
    const trimmed = existing.slice(0, 40);
    try {
      localStorage.setItem('3mtt_pos_recent_sale_items_v1', JSON.stringify(trimmed));
    } catch (e) { /* storage unavailable, safe to ignore */ }
    this.populateSaleItemSuggestions(trimmed);
  }

  populateSaleItemSuggestions(items = this.loadRecentSaleItems()) {
    const datalist = document.getElementById('sale-item-suggestions');
    if (!datalist) return;
    datalist.innerHTML = items.map(it => `<option value="${it.name.replace(/"/g, '&quot;')}"></option>`).join('');
  }

  // If the typed/selected item name matches a previously recorded item,
  // fill in its last used unit and price (only when those fields are empty).
  autofillSaleItemRow(row) {
    const nameInput = row.querySelector('.sale-item-name');
    const unitInput = row.querySelector('.sale-item-unit');
    const priceInput = row.querySelector('.sale-item-price');
    if (!nameInput) return;

    const typed = nameInput.value.trim().toLowerCase();
    if (!typed) return;

    const match = this.loadRecentSaleItems().find(it => it.name.toLowerCase() === typed);
    if (!match) return;

    if (unitInput && !unitInput.value.trim()) unitInput.value = match.unit || 'pcs';
    if (priceInput && !priceInput.value) priceInput.value = match.unitPrice || '';
    this.recalcSaleTotals();
  }

  resetSaleModal() {
    const list = document.getElementById('sale-items-list');
    if (list) list.innerHTML = this.createSaleItemRowHTML();
    const taxInput = document.getElementById('sale-tax-rate-input');
    const noteInput = document.getElementById('sale-note-input');
    if (taxInput) taxInput.value = '';
    if (noteInput) noteInput.value = '';
    this.recalcSaleTotals();
  }

  recalcSaleTotals() {
    const rows = document.querySelectorAll('#sale-items-list .sale-item-row');
    let subtotal = 0;
    rows.forEach(row => {
      const qty = parseFloat(row.querySelector('.sale-item-qty')?.value) || 0;
      const price = parseFloat(row.querySelector('.sale-item-price')?.value) || 0;
      subtotal += qty * price;
    });

    const taxRatePercent = parseFloat(document.getElementById('sale-tax-rate-input')?.value) || 0;
    const tax = subtotal * (taxRatePercent / 100);
    const total = subtotal + tax;

    const subEl = document.getElementById('sale-subtotal-display');
    const taxEl = document.getElementById('sale-tax-display');
    const totEl = document.getElementById('sale-total-display');
    if (subEl) subEl.textContent = `₦${subtotal.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
    if (taxEl) taxEl.textContent = `₦${tax.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
    if (totEl) totEl.textContent = `₦${total.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

    return { subtotal, tax, total, taxRatePercent };
  }

  collectSaleItems() {
    const rows = document.querySelectorAll('#sale-items-list .sale-item-row');
    const items = [];
    rows.forEach(row => {
      const name = row.querySelector('.sale-item-name')?.value.trim();
      const quantity = parseFloat(row.querySelector('.sale-item-qty')?.value) || 0;
      const unit = row.querySelector('.sale-item-unit')?.value.trim() || 'pcs';
      const unitPrice = parseFloat(row.querySelector('.sale-item-price')?.value) || 0;
      if (name && quantity > 0 && unitPrice >= 0) {
        items.push({ name, quantity, unit, unitPrice });
      }
    });
    return items;
  }

  initDOM() {
    this.views = {
      login: document.getElementById('view-login'),
      register: document.getElementById('view-register'),
      otp: document.getElementById('view-otp'),
      menu: document.getElementById('view-menu'),
      history: document.getElementById('view-history'),
      profile: document.getElementById('view-profile')
    };

    this.modals = {
      recordSale: document.getElementById('modal-record-sale'),
      addExpense: document.getElementById('modal-add-expense')
    };

    this.toastElem = document.getElementById('pos-toast');
  }

  showView(viewName) {
    Object.keys(this.views).forEach(key => {
      if (this.views[key]) this.views[key].classList.remove('active');
    });

    if (this.views[viewName]) this.views[viewName].classList.add('active');

    if (viewName === 'profile') this.renderProfileScreen();
    else if (viewName === 'menu') this.renderDashboard();

    const homeBtn = document.getElementById('nav-btn-home');
    const histBtn = document.getElementById('nav-btn-history');
    const profBtn = document.getElementById('nav-btn-profile');

    if (homeBtn) homeBtn.classList.toggle('active', viewName === 'menu');
    if (histBtn) histBtn.classList.toggle('active', viewName === 'history');
    if (profBtn) profBtn.classList.toggle('active', viewName === 'profile');
  }

  showToast(message) {
    if (!this.toastElem) return;
    this.toastElem.innerHTML = `<span>⚡</span> <span>${message}</span>`;
    this.toastElem.classList.add('show');
    setTimeout(() => {
      this.toastElem.classList.remove('show');
    }, 2500);
  }

  // OTP digit box auto-advance / backspace / paste logic
  initOtpBoxes() {
    const ids = ['otp-d1','otp-d2','otp-d3','otp-d4','otp-d5','otp-d6'];
    const boxes = ids.map(id => document.getElementById(id)).filter(Boolean);

    boxes.forEach((box, idx) => {
      box.addEventListener('input', () => {
        const val = box.value.replace(/\D/g, '');
        box.value = val.slice(-1);
        if (val) {
          box.classList.add('filled');
          if (idx < boxes.length - 1) boxes[idx + 1].focus();
        } else {
          box.classList.remove('filled');
        }
      });

      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && idx > 0) {
          boxes[idx - 1].value = '';
          boxes[idx - 1].classList.remove('filled');
          boxes[idx - 1].focus();
        }
      });

      box.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        pasted.split('').slice(0, 6).forEach((ch, i) => {
          if (boxes[i]) {
            boxes[i].value = ch;
            boxes[i].classList.add('filled');
          }
        });
        boxes[Math.min(pasted.length, 5)].focus();
      });
    });
  }

  // 60-second countdown for OTP resend button
  startOtpTimer() {
    clearInterval(this._otpTimerInterval);
    const btn = document.getElementById('btn-resend-otp');
    const countEl = document.getElementById('otp-timer-count');
    if (!btn || !countEl) return;

    let seconds = 60;
    btn.disabled = true;
    countEl.textContent = seconds;
    btn.textContent = `Resend in ${seconds}s`;

    this._otpTimerInterval = setInterval(() => {
      seconds--;
      if (seconds <= 0) {
        clearInterval(this._otpTimerInterval);
        btn.disabled = false;
        btn.textContent = 'Resend OTP';
      } else {
        btn.textContent = `Resend in ${seconds}s`;
      }
    }, 1000);
  }

  initEventListeners() {
    // 1. Login
    const performLogin = async () => {
      const phoneInput = document.getElementById('login-phone-input')?.value.trim();
      const pinInput = document.getElementById('login-pin-input')?.value.trim();

      if (!phoneInput || !pinInput) {
        sound.playError();
        this.showToast('Enter your phone number and PIN');
        return;
      }

      const loginBtn = document.getElementById('btn-submit-login');
      const originalLabel = loginBtn ? loginBtn.textContent : '';
      if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = 'Signing in...'; }

      try {
        const res = await fetch(`${API_BASE}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phoneInput, pin: pinInput })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Incorrect phone or PIN');

        store.setSignedInUser(data.user);

        sound.playSuccess();
        this.showToast('Welcome back, ' + (store.agentBusiness || store.agentName || 'Agent'));
        this.renderDashboard();
        this.renderProfileScreen();
        this.showView('menu');
        this.loadLedgerFromBackend();
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Incorrect phone or PIN. Please try again.');
      } finally {
        if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = originalLabel; }
      }
    };

    document.getElementById('btn-submit-login')?.addEventListener('click', performLogin);

    // 2. Navigation to "Create an Account" & Back
    document.getElementById('link-go-to-register')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playTap();
      this.showView('register');
    });

    document.getElementById('link-go-to-login')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playTap();
      this.showView('login');
    });

    document.getElementById('btn-back-from-register')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('login');
    });

    // 3. Register Submission → request a real email OTP, then go to OTP screen
    document.getElementById('btn-submit-register')?.addEventListener('click', async () => {
      const name = document.getElementById('reg-name-input')?.value.trim();
      const biz = document.getElementById('reg-business-input')?.value.trim();
      const phone = document.getElementById('reg-phone-input')?.value.trim();
      const email = document.getElementById('reg-email-input')?.value.trim();
      const pin = document.getElementById('reg-pin-input')?.value.trim();
      const confirmPin = document.getElementById('reg-pin-confirm-input')?.value.trim();

      if (!name || !biz || !phone || !email) {
        sound.playError();
        this.showToast('Please fill in all fields including email!');
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sound.playError();
        this.showToast('Please enter a valid email address!');
        return;
      }

      if (!pin || pin.length < 4) {
        sound.playError();
        this.showToast('PIN must be 4 digits!');
        return;
      }

      if (pin !== confirmPin) {
        sound.playError();
        this.showToast('PINs do not match! Please re-check');
        return;
      }

      this._pendingRegData = { name, biz, phone, email, pin };

      const maskedEmail = email.replace(/(.{1}).+(@.+)/, '$1***$2');
      document.getElementById('otp-masked-email').textContent = maskedEmail;

      ['otp-d1','otp-d2','otp-d3','otp-d4','otp-d5','otp-d6'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.classList.remove('filled','error'); }
      });

      sound.playTap();
      const submitBtn = document.getElementById('btn-submit-register');
      const originalLabel = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending code...';

      try {
        const res = await fetch(`${API_BASE}/api/send-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, name })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send OTP');

        this.showToast(`OTP sent to ${maskedEmail}`);
        this.startOtpTimer();
        this.showView('otp');
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Could not send OTP. Check your connection.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    });

    this.initOtpBoxes();

    document.getElementById('btn-back-from-otp')?.addEventListener('click', () => {
      sound.playTap();
      clearInterval(this._otpTimerInterval);
      this.showView('register');
    });

    // Verify OTP → finalize real account creation
    document.getElementById('btn-submit-otp')?.addEventListener('click', async () => {
      const entered = ['otp-d1','otp-d2','otp-d3','otp-d4','otp-d5','otp-d6']
        .map(id => document.getElementById(id)?.value || '')
        .join('');

      if (entered.length < 6) {
        sound.playError();
        this.showToast('Please enter the complete 6-digit OTP');
        return;
      }

      if (!this._pendingRegData) {
        sound.playError();
        this.showToast('Session expired. Please register again.');
        this.showView('register');
        return;
      }

      const verifyBtn = document.getElementById('btn-submit-otp');
      const originalLabel = verifyBtn.textContent;
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Verifying...';

      try {
        const res = await fetch(`${API_BASE}/api/verify-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: this._pendingRegData.email,
            otp: entered,
            name: this._pendingRegData.name,
            businessName: this._pendingRegData.biz,
            phone: this._pendingRegData.phone,
            pin: this._pendingRegData.pin
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Incorrect OTP');

        clearInterval(this._otpTimerInterval);
        store.setSignedInUser(data.user);

        const loginPhone = document.getElementById('login-phone-input');
        if (loginPhone) loginPhone.value = data.user.phone;

        sound.playSuccess();
        this.showToast(`🎉 Account created! Welcome, ${data.user.business_name || data.user.name}`);
        this.renderDashboard();
        this.renderProfileScreen();
        this.showView('menu');
        this._pendingRegData = null;
        this.loadLedgerFromBackend();
      } catch (err) {
        sound.playError();
        ['otp-d1','otp-d2','otp-d3','otp-d4','otp-d5','otp-d6'].forEach(id => {
          document.getElementById(id)?.classList.add('error');
        });
        setTimeout(() => {
          ['otp-d1','otp-d2','otp-d3','otp-d4','otp-d5','otp-d6'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; el.classList.remove('error'); }
          });
          document.getElementById('otp-d1')?.focus();
        }, 600);
        this.showToast(err.message || 'Incorrect OTP! Check the code sent to your email.');
      } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = originalLabel;
      }
    });

    document.getElementById('btn-resend-otp')?.addEventListener('click', async () => {
      if (!this._pendingRegData) return;
      sound.playTap();
      const resendBtn = document.getElementById('btn-resend-otp');
      resendBtn.disabled = true;

      try {
        const res = await fetch(`${API_BASE}/api/send-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: this._pendingRegData.email, name: this._pendingRegData.name })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to resend OTP');

        ['otp-d1','otp-d2','otp-d3','otp-d4','otp-d5','otp-d6'].forEach(id => {
          const el = document.getElementById(id);
          if (el) { el.value = ''; el.classList.remove('filled','error'); }
        });
        this.showToast('New OTP sent to your email!');
        this.startOtpTimer();
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Could not resend OTP.');
        resendBtn.disabled = false;
      }
    });

    // Dashboard Header → Profile
    document.querySelector('.agent-profile-exact')?.addEventListener('click', () => {
      sound.playTap();
      this.renderProfileScreen();
      this.showView('profile');
    });

    // PIN Peek Toggle (login form)
    document.getElementById('btn-toggle-pin-peek')?.addEventListener('click', () => {
      sound.playTap();
      const pinInput = document.getElementById('login-pin-input');
      if (pinInput) {
        this.isPinMasked = !this.isPinMasked;
        pinInput.type = this.isPinMasked ? 'password' : 'text';
      }
    });

    document.getElementById('link-forgot-pin')?.addEventListener('click', () => {
      sound.playTap();
      this.showToast('Enter your registered phone number and PIN to sign in.');
    });

    // Bottom Navigation
    document.getElementById('nav-btn-home')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('menu');
    });

    document.getElementById('nav-btn-history')?.addEventListener('click', () => {
      sound.playTap();
      this.renderHistoryScreen('ALL');
      this.showView('history');
    });

    document.getElementById('nav-btn-profile')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('profile');
    });

    document.getElementById('btn-home-view-all')?.addEventListener('click', () => {
      sound.playTap();
      this.renderHistoryScreen('ALL');
      this.showView('history');
    });

    // Back buttons
    document.getElementById('btn-back-from-history')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('menu');
    });
    document.getElementById('btn-back-from-profile')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('menu');
    });

    // Record Sale / Add Expense modal openers (shared by Home + Business tab buttons)
    document.querySelectorAll('.btn-trigger-record-sale').forEach(btn => {
      btn.addEventListener('click', () => {
        sound.playTap();
        this.populateSaleItemSuggestions();
        this.resetSaleModal();
        this.modals.recordSale.classList.add('active');
      });
    });

    document.querySelectorAll('.btn-trigger-add-expense').forEach(btn => {
      btn.addEventListener('click', () => {
        sound.playTap();
        this.modals.addExpense.classList.add('active');
      });
    });

    // Add a new blank item row
    document.getElementById('btn-add-sale-item')?.addEventListener('click', () => {
      sound.playTap();
      const list = document.getElementById('sale-items-list');
      if (!list) return;
      list.insertAdjacentHTML('beforeend', this.createSaleItemRowHTML());
      const rows = list.querySelectorAll('.sale-item-row');
      rows[rows.length - 1]?.querySelector('.sale-item-name')?.focus();
      this.recalcSaleTotals();
    });

    document.getElementById('sale-items-list')?.addEventListener('click', (e) => {
      if (e.target.closest('.btn-remove-item-row')) {
        const list = document.getElementById('sale-items-list');
        const rows = list.querySelectorAll('.sale-item-row');
        if (rows.length <= 1) {
          const row = e.target.closest('.sale-item-row');
          row.querySelector('.sale-item-name').value = '';
          row.querySelector('.sale-item-qty').value = '1';
          row.querySelector('.sale-item-price').value = '';
        } else {
          e.target.closest('.sale-item-row')?.remove();
        }
        this.recalcSaleTotals();
      }
    });

    document.getElementById('sale-items-list')?.addEventListener('input', () => this.recalcSaleTotals());
    document.getElementById('sale-tax-rate-input')?.addEventListener('input', () => this.recalcSaleTotals());

    // When an item name matches something recorded before (typed or picked from
    // suggestions), auto-fill its last used unit + price so re-entry is fast.
    document.getElementById('sale-items-list')?.addEventListener('change', (e) => {
      if (e.target.classList.contains('sale-item-name')) {
        this.autofillSaleItemRow(e.target.closest('.sale-item-row'));
      }
    });

    document.getElementById('btn-submit-record-sale')?.addEventListener('click', async () => {
      const items = this.collectSaleItems();
      const note = document.getElementById('sale-note-input')?.value.trim();
      const { total, taxRatePercent } = this.recalcSaleTotals();

      if (items.length === 0) {
        sound.playError();
        this.showToast('Add at least one item with a name and price!');
        return;
      }

      if (!store.currentUserId) {
        sound.playError();
        this.showToast('Please sign in again to record a sale.');
        return;
      }

      const saveBtn = document.getElementById('btn-submit-record-sale');
      const originalLabel = saveBtn ? saveBtn.textContent : '';
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

      try {
        const res = await fetch(`${API_BASE}/api/sales`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: store.currentUserId,
            items,
            taxRate: taxRatePercent / 100,
            note
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to record sale');

        sound.playSuccess();
        this.showToast(`+₦${total.toLocaleString('en-NG', { minimumFractionDigits: 2 })} Sale Recorded!`);
        this.saveRecentSaleItems(items);
        this.modals.recordSale.classList.remove('active');
        this.resetSaleModal();

        await this.loadLedgerFromBackend();
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Could not save sale. Check your connection.');
      } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = originalLabel; }
      }
    });

    document.getElementById('btn-submit-add-expense')?.addEventListener('click', async () => {
      const title = document.getElementById('expense-title-input')?.value.trim();
      const category = document.getElementById('expense-category-select')?.value;
      const amount = parseFloat(document.getElementById('expense-amount-input')?.value);
      const note = document.getElementById('expense-note-input')?.value.trim();

      if (!title || !amount || amount <= 0) {
        sound.playError();
        this.showToast('Please enter a valid expense title and amount!');
        return;
      }

      if (!store.currentUserId) {
        sound.playError();
        this.showToast('Please sign in again to record an expense.');
        return;
      }

      const saveBtn = document.getElementById('btn-submit-add-expense');
      const originalLabel = saveBtn ? saveBtn.textContent : '';
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

      try {
        const res = await fetch(`${API_BASE}/api/expenses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: store.currentUserId,
            category: category || title,
            amount,
            note: title !== category ? `${title}${note ? ' — ' + note : ''}` : note
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to record expense');

        sound.playSuccess();
        this.showToast(`-₦${amount.toLocaleString()} Expense Tracked!`);
        this.modals.addExpense.classList.remove('active');
        document.getElementById('expense-title-input').value = '';
        document.getElementById('expense-amount-input').value = '';
        document.getElementById('expense-note-input').value = '';

        await this.loadLedgerFromBackend();
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Could not save expense. Check your connection.');
      } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = originalLabel; }
      }
    });

    // History tab filter pills
    document.querySelectorAll('.history-filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        sound.playTap();
        document.querySelectorAll('.history-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.renderHistoryScreen(pill.getAttribute('data-filter'));
      });
    });

    // Profile Logout — clears the real session, not just the screen
    document.getElementById('btn-profile-logout')?.addEventListener('click', () => {
      sound.playTap();
      store.signOut();
      this.ledgerEntries = [];
      this.showToast('Signed out');
      this.showView('login');
    });

    // Modal Close
    document.querySelectorAll('.modal-close-btn, .modal-backdrop-dismiss').forEach(btn => {
      btn.addEventListener('click', () => {
        sound.playTap();
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.posApp = new POSApp();
});
