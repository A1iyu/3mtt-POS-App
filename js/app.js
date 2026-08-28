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

    // OTP state (verification happens server-side) — used for either a
    // personal registration in progress, or a new organization email
    // waiting on its own OTP proof. Only one is ever active at a time.
    this._pendingRegData = null;
    this._pendingOrgData = null;
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
    this.checkAdminOrg();
    this.checkForInviteLink();
  }

  // If this page was opened via an invite email link (?invite=TOKEN),
  // validate it and show the "join organization" screen instead of login.
  async checkForInviteLink() {
    const token = new URLSearchParams(window.location.search).get('invite');
    if (!token) return;

    this._inviteToken = token;
    this.showView('acceptInvite');

    const nameElem = document.getElementById('invite-org-name');
    const subtitleElem = document.getElementById('invite-subtitle');
    const statusBox = document.getElementById('invite-status-box');
    const formFields = document.getElementById('invite-form-fields');

    try {
      const res = await fetch(`${API_BASE}/api/invites/${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'This invite link is invalid.');

      if (nameElem) nameElem.textContent = data.orgName;
      if (subtitleElem) subtitleElem.textContent = `You're invited as ${data.email}. Create your username and password to get started.`;
    } catch (err) {
      if (statusBox) {
        statusBox.style.display = 'block';
        statusBox.textContent = err.message || 'This invite link is invalid.';
      }
      if (formFields) formFields.style.display = 'none';
      this._inviteToken = null;
    }
  }

  // Fetch this agent's real sales and expenses from Supabase and normalize
  // them into one list every ledger view (Home preview, Business, History) shares.
  async loadLedgerFromBackend() {
    if (!store.currentUserId && !store.memberId) return; // not signed in to any real account yet

    const params = store.memberId
      ? `orgMemberId=${store.memberId}`
      : `userId=${store.currentUserId}${store.adminOrgId ? `&orgId=${store.adminOrgId}` : ''}`;

    try {
      const [salesRes, expensesRes] = await Promise.all([
        fetch(`${API_BASE}/api/sales?${params}`),
        fetch(`${API_BASE}/api/expenses?${params}`)
      ]);
      const salesData = await salesRes.json();
      const expensesData = await expensesRes.json();

      const sales = (salesData.sales || []).map(s => ({
        id: s.id,
        type: 'SALE',
        title: (s.sale_items && s.sale_items[0] && s.sale_items[0].name) || 'Sale',
        category: s.sale_items && s.sale_items.length > 1 ? `${s.sale_items.length} items` : 'Goods Sold',
        amount: Number(s.total),
        subtotal: Number(s.subtotal) || 0,
        tax: Number(s.tax) || 0,
        note: s.note || '',
        timestamp: s.created_at,
        items: (s.sale_items || []).map(it => ({
          name: it.name,
          quantity: Number(it.quantity) || 0,
          unit: it.unit || 'pcs',
          unitPrice: Number(it.unit_price) || 0
        }))
      }));

      const expenses = (expensesData.expenses || []).map(e => ({
        id: e.id,
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
          <div style="margin-bottom:0.75rem; display:flex; justify-content:center;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 3v16a2 2 0 0 0 2 2h16"/>
              <path d="M18 17V9"/>
              <path d="M13 17V5"/>
              <path d="M8 17v-3"/>
            </svg>
          </div>
          <div style="font-weight:700;">${emptyMessage}</div>
          <div style="font-size:0.8rem; margin-top:0.25rem;">Use the buttons above to record your first entry.</div>
        </div>
      `;
    }

    return entries.map(item => `
      <div class="biz-ledger-item" data-entry-type="${item.type}" data-entry-id="${item.id}" role="button" tabindex="0">
        <div style="display:flex; align-items:center; gap:0.85rem;">
          <div class="biz-item-icon ${item.type.toLowerCase()}">
            ${item.type === 'SALE'
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>'}
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

  // ---- Entry detail modal (click a ledger row to see full breakdown) ----
  findLedgerEntry(type, id) {
    return this.ledgerEntries.find(e => e.type === type && String(e.id) === String(id));
  }

  openEntryDetail(type, id) {
    const entry = this.findLedgerEntry(type, id);
    if (!entry) return;

    this._activeDetailEntry = entry;

    const titleElem = document.getElementById('entry-detail-title');
    const bodyElem = document.getElementById('entry-detail-body');
    if (!titleElem || !bodyElem) return;

    titleElem.textContent = entry.type === 'SALE' ? 'Sale Receipt' : 'Expense Details';

    if (entry.type === 'SALE') {
      const rows = (entry.items || []).map(it => `
        <div class="breakdown-row">
          <span>${it.name} <span style="color:var(--text-dim); font-weight:600;">(${it.quantity} ${it.unit})</span></span>
          <span class="val">₦${this.lineTotal(it.quantity, it.unitPrice, it.unit).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>
        </div>
      `).join('');

      bodyElem.innerHTML = `
        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:1rem;">${receiptManager.formatDate(entry.timestamp)}</div>
        <div class="breakdown-table-card" style="margin-bottom:1rem;">
          ${rows || '<div class="breakdown-row"><span>No item detail saved for this sale</span></div>'}
        </div>
        <div class="breakdown-table-card">
          <div class="breakdown-row">
            <span>Subtotal</span>
            <span class="val">₦${entry.subtotal.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>
          </div>
          <div class="breakdown-row">
            <span>Tax</span>
            <span class="val">₦${entry.tax.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>
          </div>
          <div class="breakdown-row total-row">
            <span>Total</span>
            <span class="val">₦${entry.amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
        ${entry.note ? `<div style="margin-top:0.85rem; font-size:0.9rem; color:var(--text-muted);"><strong style="color:var(--text-dark);">Note:</strong> ${entry.note}</div>` : ''}
      `;
    } else {
      bodyElem.innerHTML = `
        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:1rem;">${receiptManager.formatDate(entry.timestamp)}</div>
        <div class="breakdown-table-card">
          <div class="breakdown-row">
            <span>Category</span>
            <span class="val">${entry.category}</span>
          </div>
          <div class="breakdown-row total-row">
            <span>Amount</span>
            <span class="val" style="color:#dc2626;">-₦${entry.amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
        ${entry.note ? `<div style="margin-top:0.85rem; font-size:0.9rem; color:var(--text-muted);"><strong style="color:var(--text-dark);">Note:</strong> ${entry.note}</div>` : ''}
      `;
    }

    this.modals.entryDetail?.classList.add('active');
  }

  // Opens a clean, standalone printable receipt in a new tab/window
  printEntryReceipt(entry) {
    if (!entry) return;
    sound.playTap();

    const merchant = (store.agentBusiness || store.agentName || '3MTT Agent POS').toUpperCase();
    const isSale = entry.type === 'SALE';

    const itemRows = isSale
      ? (entry.items || []).map(it => `
          <div class="receipt-row">
            <span>${it.name} (${it.quantity} ${it.unit})</span>
            <span>₦${this.lineTotal(it.quantity, it.unitPrice, it.unit).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>
          </div>
        `).join('')
      : '';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Receipt</title>
        <style>
          body { font-family: 'Courier New', monospace; padding: 24px; color: #0f172a; max-width: 340px; margin: 0 auto; }
          .center { text-align: center; }
          .brand { font-size: 1.15rem; font-weight: 800; margin-bottom: 2px; }
          .muted { color: #4b5563; font-size: 0.75rem; }
          hr { border: none; border-top: 1px dashed #cbd5e1; margin: 10px 0; }
          .receipt-row { display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 6px; }
          .bold { font-weight: 800; font-size: 1rem; }
          .footer { text-align: center; font-size: 0.7rem; color: #9ca3af; margin-top: 14px; }
        </style>
      </head>
      <body>
        <div class="center">
          <div class="brand">${merchant}</div>
          <div class="muted">${isSale ? 'SALES RECEIPT' : 'EXPENSE RECORD'}</div>
          <div class="muted">${receiptManager.formatDate(entry.timestamp)}</div>
        </div>
        <hr>
        ${isSale ? itemRows + '<hr>' : ''}
        ${isSale ? `
          <div class="receipt-row"><span>Subtotal</span><span>₦${entry.subtotal.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span></div>
          <div class="receipt-row"><span>Tax</span><span>₦${entry.tax.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span></div>
        ` : `
          <div class="receipt-row"><span>Category</span><span>${entry.category}</span></div>
        `}
        <div class="receipt-row bold"><span>${isSale ? 'Total' : 'Amount'}</span><span>${isSale ? '' : '-'}₦${entry.amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span></div>
        ${entry.note ? `<hr><div class="muted">Note: ${entry.note}</div>` : ''}
        <div class="footer">*** Thank you ***</div>
        <script>window.onload = () => { window.print(); };</script>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank', 'width=420,height=640');
    if (!printWindow) {
      this.showToast('Please allow pop-ups to print a receipt');
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
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
    const displayName = store.memberId
      ? `${store.memberOrgName || 'Organization'} (${store.memberUsername})`
      : (store.agentBusiness || 'My Business');

    const titleElem = document.getElementById('dash-business-title');
    if (titleElem) titleElem.textContent = displayName;

    const avatarElem = document.getElementById('dash-avatar-circle');
    if (avatarElem) {
      const initialsSource = store.memberId ? (store.memberOrgName || store.memberUsername || 'M') : (store.agentBusiness || store.agentName || 'AG');
      const initials = initialsSource
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
    const orgBtn = document.getElementById('btn-profile-org-action');
    const orgBtnLabel = document.getElementById('btn-profile-org-action-label');

    if (store.memberId) {
      const initials = (store.memberOrgName || store.memberUsername || 'M')
        .split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();

      if (avatarElem) avatarElem.textContent = initials || 'M';
      if (bizElem) bizElem.textContent = store.memberOrgName || 'Organization';
      if (phoneElem) phoneElem.textContent = '—';
      if (nameElem) nameElem.textContent = store.memberUsername || '';
      if (emailElem) emailElem.textContent = 'Team member';
      if (statusElem) statusElem.textContent = 'Active / Online';
      // Members don't administer organizations — this button is admin-only
      if (orgBtn) orgBtn.style.display = 'none';
      return;
    }

    if (orgBtn) orgBtn.style.display = '';

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

    if (orgBtn && orgBtnLabel) {
      if (store.adminOrgId) {
        orgBtnLabel.textContent = `Manage ${store.adminOrgName || 'Organization'}`;
        orgBtn.onclick = () => {
          sound.playTap();
          this.renderOrgAdminScreen();
          this.showView('orgAdmin');
        };
      } else {
        orgBtnLabel.textContent = 'Create an organization';
        orgBtn.onclick = () => {
          sound.playTap();
          this.openCreateOrgModal();
        };
      }
    }
  }

  // Checks whether the signed-in agent administers an organization, and
  // caches the result so the rest of the app knows to record/read the
  // shared org ledger instead of a personal one.
  async checkAdminOrg() {
    if (!store.currentUserId) return;
    try {
      const res = await fetch(`${API_BASE}/api/organizations?adminUserId=${store.currentUserId}`);
      const data = await res.json();
      if (res.ok && data.organizations && data.organizations.length > 0) {
        store.adminOrgId = data.organizations[0].id;
        store.adminOrgName = data.organizations[0].name;
      } else {
        store.adminOrgId = null;
        store.adminOrgName = null;
      }
      store.persist();
      this.renderProfileScreen();
    } catch (err) {
      console.error('checkAdminOrg error:', err);
    }
  }

  openCreateOrgModal() {
    const nameInput = document.getElementById('org-name-input');
    const ownEmailRadio = document.querySelector('input[name="org-email-choice"][value="own"]');
    const newEmailWrapper = document.getElementById('org-new-email-wrapper');
    const newEmailInput = document.getElementById('org-new-email-input');
    const ownEmailDisplay = document.getElementById('org-own-email-display');
    const migrateCheckbox = document.getElementById('org-migrate-checkbox');

    if (nameInput) nameInput.value = '';
    if (ownEmailRadio) ownEmailRadio.checked = true;
    if (newEmailWrapper) newEmailWrapper.style.display = 'none';
    if (newEmailInput) newEmailInput.value = '';
    if (ownEmailDisplay) ownEmailDisplay.textContent = store.agentEmail || '';
    if (migrateCheckbox) migrateCheckbox.checked = true;

    this.modals.createOrg?.classList.add('active');
  }

  async renderOrgAdminScreen() {
    const titleElem = document.getElementById('org-admin-title');
    if (titleElem) titleElem.textContent = store.adminOrgName || 'Organization';

    const tbody = document.getElementById('org-members-table-body');
    if (!tbody || !store.adminOrgId) return;

    tbody.innerHTML = `<tr><td colspan="3" style="padding:1rem; text-align:center; color:var(--text-muted);">Loading...</td></tr>`;

    try {
      const res = await fetch(`${API_BASE}/api/organizations/${store.adminOrgId}/members?adminUserId=${store.currentUserId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load members');

      const adminRow = `
        <tr>
          <td style="font-weight:700;">${store.agentName || store.agentBusiness} <span style="color:var(--text-dim); font-weight:500;">(you)</span></td>
          <td>Admin</td>
          <td style="text-align:right; color:var(--text-dim); font-size:0.8rem;">—</td>
        </tr>
      `;

      const memberRows = (data.members || []).map(m => `
        <tr>
          <td style="font-weight:700;">${m.username}</td>
          <td style="text-transform:capitalize;">${m.role}</td>
          <td style="text-align:right;">
            <button type="button" class="btn-remove-member" data-member-id="${m.id}">Remove</button>
          </td>
        </tr>
      `).join('');

      tbody.innerHTML = adminRow + (memberRows || `<tr><td colspan="3" style="padding:1rem; text-align:center; color:var(--text-muted);">No members yet</td></tr>`);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="3" style="padding:1rem; text-align:center; color:#dc2626;">Could not load members</td></tr>`;
    }
  }

  // Every sales/expenses request needs to say WHO is acting — either a
  // personal/admin user (optionally with an org), or an org member. Centralizing
  // this avoids the two submit handlers (and any future ones) drifting apart.
  getActorPayload() {
    if (store.memberId) return { orgMemberId: store.memberId };
    return { userId: store.currentUserId, orgId: store.adminOrgId || null };
  }

  isSignedIn() {
    return !!(store.currentUserId || store.memberId);
  }

  // ---- Multi-item Record Sale modal helpers ----

  createSaleItemRowHTML() {
    return `
      <div class="sale-item-row" data-item-row>
        <div class="sale-item-row-fields">
          <input type="text" class="sale-item-name" placeholder="Item name" list="sale-item-suggestions" autocomplete="off" />
          <input type="number" class="sale-item-qty" placeholder="Quantity" min="0.01" step="any" value="1" />
          <input type="text" class="sale-item-unit" placeholder="Unit (bag, kg, pcs)" list="sale-unit-suggestions" autocomplete="off" />
          <input type="number" class="sale-item-price" placeholder="₦ Price" min="0" step="0.01" />
        </div>
        <button type="button" class="btn-remove-item-row" aria-label="Remove item">✕</button>
      </div>
    `;
  }

  // ---- Recently used sale items (device-local, so typing a few letters of
  //      a previously recorded item name auto-suggests it, and picking a
  //      specific unit/size — e.g. "25kg bag" vs "50kg bag" — autofills that
  //      exact variant's last used price, never a different size's price) ----
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
    // Keyed by name+unit together, so "Rice / 25kg bag" and "Rice / 50kg bag"
    // are remembered as separate variants with their own price.
    const existing = this.loadRecentSaleItems();
    items.forEach(({ name, unit, unitPrice }) => {
      if (!name) return;
      const cleanUnit = (unit || 'pcs').trim();
      const key = `${name.trim().toLowerCase()}|${cleanUnit.toLowerCase()}`;
      const idx = existing.findIndex(it => `${it.name.toLowerCase()}|${it.unit.toLowerCase()}` === key);
      const entry = { name: name.trim(), unit: cleanUnit, unitPrice: unitPrice ?? '' };
      if (idx > -1) existing.splice(idx, 1);
      existing.unshift(entry);
    });
    const trimmed = existing.slice(0, 60);
    try {
      localStorage.setItem('3mtt_pos_recent_sale_items_v1', JSON.stringify(trimmed));
    } catch (e) { /* storage unavailable, safe to ignore */ }
    this.populateSaleItemSuggestions(trimmed);
  }

  populateSaleItemSuggestions(items = this.loadRecentSaleItems()) {
    const datalist = document.getElementById('sale-item-suggestions');
    if (!datalist) return;
    // One suggestion per distinct item name (not per variant) for the name field.
    const seen = new Set();
    const uniqueNames = items.filter(it => {
      const key = it.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    datalist.innerHTML = uniqueNames.map(it => `<option value="${it.name.replace(/"/g, '&quot;')}"></option>`).join('');
  }

  // Once an item name is chosen, show that item's previously used sizes/units
  // (e.g. "25kg bag", "50kg bag") alongside the generic unit list, so picking
  // the right variant is a click, not a guess.
  populateUnitSuggestionsForName(name) {
    const datalist = document.getElementById('sale-unit-suggestions');
    if (!datalist) return;

    const genericUnits = ['pcs', 'kg', 'g', 'litre', 'ml', 'dozen', 'pack', 'carton', 'bunch'];
    const typed = name.trim().toLowerCase();
    const knownForItem = typed
      ? this.loadRecentSaleItems()
        .filter(it => it.name.toLowerCase() === typed)
        .map(it => it.unit)
      : [];

    const combined = [...new Set([...knownForItem, ...genericUnits])];
    datalist.innerHTML = combined.map(u => `<option value="${u.replace(/"/g, '&quot;')}"></option>`).join('');
  }

  // Only autofill a price when BOTH the item name AND the specific unit/size
  // match something recorded before — a name match alone is not enough,
  // since the whole point is different sizes have different prices.
  autofillSaleItemRow(row) {
    const nameInput = row.querySelector('.sale-item-name');
    const unitInput = row.querySelector('.sale-item-unit');
    const priceInput = row.querySelector('.sale-item-price');
    if (!nameInput) return;

    const typedName = nameInput.value.trim().toLowerCase();
    if (!typedName) return;

    this.populateUnitSuggestionsForName(nameInput.value);

    const typedUnit = (unitInput?.value || '').trim().toLowerCase();
    if (!typedUnit) return; // wait until a specific size/unit is chosen before touching price

    const match = this.loadRecentSaleItems().find(
      it => it.name.toLowerCase() === typedName && it.unit.toLowerCase() === typedUnit
    );
    if (!match) return;

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

  // Must match the same rule in server.js exactly, or the total shown here
  // won't match what actually gets saved to the database.
  lineTotal(qty, price, unit) {
    const cleanUnit = (unit || 'pcs').trim().toLowerCase();
    return cleanUnit === 'pcs' ? qty * price : price;
  }

  recalcSaleTotals() {
    const rows = document.querySelectorAll('#sale-items-list .sale-item-row');
    let subtotal = 0;
    rows.forEach(row => {
      const qty = parseFloat(row.querySelector('.sale-item-qty')?.value) || 0;
      const price = parseFloat(row.querySelector('.sale-item-price')?.value) || 0;
      const unit = row.querySelector('.sale-item-unit')?.value || 'pcs';
      subtotal += this.lineTotal(qty, price, unit);
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
      acceptInvite: document.getElementById('view-accept-invite'),
      menu: document.getElementById('view-menu'),
      history: document.getElementById('view-history'),
      profile: document.getElementById('view-profile'),
      orgAdmin: document.getElementById('view-org-admin')
    };

    this.modals = {
      recordSale: document.getElementById('modal-record-sale'),
      addExpense: document.getElementById('modal-add-expense'),
      entryDetail: document.getElementById('modal-entry-detail'),
      createOrg: document.getElementById('modal-create-org'),
      forgotPassword: document.getElementById('modal-forgot-password'),
      updatePassword: document.getElementById('modal-update-password')
    };

    this.toastElem = document.getElementById('pos-toast');
  }

  showView(viewName) {
    Object.keys(this.views).forEach(key => {
      if (this.views[key]) this.views[key].classList.remove('active');
    });

    if (this.views[viewName]) this.views[viewName].classList.add('active');

    // The animated background only belongs on Login/Register — it lives
    // outside the .app-view sections (see index.html for why), so its
    // visibility has to be toggled here rather than by .app-view's own CSS.
    const authDecor = document.getElementById('auth-bg-decor');
    if (authDecor) {
      authDecor.classList.toggle('visible', viewName === 'login' || viewName === 'register');
    }

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
    this.toastElem.innerHTML = `<span class="toast-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg></span> <span>${message}</span>`;
    this.toastElem.classList.add('show');
    setTimeout(() => {
      this.toastElem.classList.remove('show');
    }, 2500);
  }

  // OTP digit box auto-advance / backspace / paste logic
  initOtpBoxes() {
    const ids = ['otp-d1', 'otp-d2', 'otp-d3', 'otp-d4', 'otp-d5', 'otp-d6'];
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
        if (e.key === 'Enter') {
          e.preventDefault();
          document.getElementById('btn-submit-otp')?.click();
          return;
        }
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
    // Generic Enter Key binder for accessible form submissions
    const bindEnterKey = (inputs, action) => {
      inputs.forEach(id => {
        const el = typeof id === 'string' ? document.getElementById(id) : id;
        el?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            action();
          }
        });
      });
    };

    // 1. Login (personal/admin OR org member — toggled via link-toggle-member-login)
    this._loginMode = 'personal';

    const performLogin = async () => {
      const identifierInput = document.getElementById('login-identifier-input')?.value.trim();
      const passwordInput = document.getElementById('login-password-input')?.value;

      if (!identifierInput || !passwordInput) {
        sound.playError();
        this.showToast(this._loginMode === 'member' ? 'Enter your username and password' : 'Enter your email/phone and password');
        return;
      }

      const loginBtn = document.getElementById('btn-submit-login');
      const originalLabel = loginBtn ? loginBtn.textContent : '';
      if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = 'Signing in...'; }

      try {
        if (this._loginMode === 'member') {
          const res = await fetch(`${API_BASE}/api/member-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: identifierInput, password: passwordInput })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Incorrect username or password');

          store.setSignedInMember(data.member);
          sound.playSuccess();
          this.showToast(`Welcome, ${data.member.username}!`);
        } else {
          const res = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: identifierInput, password: passwordInput })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Incorrect email/phone or password');

          store.setSignedInUser(data.user);
          sound.playSuccess();
          this.showToast('Welcome back, ' + (store.agentBusiness || store.agentName || 'Agent'));
        }

        this.renderDashboard();
        this.renderProfileScreen();
        this.showView('menu');
        this.loadLedgerFromBackend();
        this.checkAdminOrg();
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Incorrect credentials. Please try again.');
      } finally {
        if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = originalLabel; }
      }
    };

    document.getElementById('btn-submit-login')?.addEventListener('click', performLogin);
    bindEnterKey(['login-identifier-input', 'login-password-input'], performLogin);

    document.getElementById('link-toggle-member-login')?.addEventListener('click', (e) => {
      e.preventDefault();
      sound.playTap();

      const label = document.getElementById('login-identifier-label');
      const identifierInput = document.getElementById('login-identifier-input');
      const toggleLink = document.getElementById('link-toggle-member-login');

      this._loginMode = this._loginMode === 'member' ? 'personal' : 'member';

      if (this._loginMode === 'member') {
        if (label) label.textContent = 'USERNAME';
        if (identifierInput) identifierInput.placeholder = 'e.g. john_cashier';
        if (toggleLink) toggleLink.textContent = 'Not a team member? Sign in with email/phone instead';
      } else {
        if (label) label.textContent = 'EMAIL OR PHONE NUMBER';
        if (identifierInput) identifierInput.placeholder = 'agent@example.com or 0801 234 5678';
        if (toggleLink) toggleLink.textContent = 'Sign in with your username';
      }

      if (identifierInput) identifierInput.value = '';
      const passwordInput = document.getElementById('login-password-input');
      if (passwordInput) passwordInput.value = '';
    });

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
    const performRegister = async () => {
      const name = document.getElementById('reg-name-input')?.value.trim();
      const biz = document.getElementById('reg-business-input')?.value.trim();
      const phone = document.getElementById('reg-phone-input')?.value.trim();
      const email = document.getElementById('reg-email-input')?.value.trim();
      const password = document.getElementById('reg-password-input')?.value;
      const confirmPassword = document.getElementById('reg-password-confirm-input')?.value;

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

      if (!password || password.length < 6) {
        sound.playError();
        this.showToast('Password must be at least 6 characters!');
        return;
      }

      if (password !== confirmPassword) {
        sound.playError();
        this.showToast('Passwords do not match! Please re-check');
        return;
      }

      const accountType = document.querySelector('input[name="reg-account-type"]:checked')?.value || 'personal';
      this._pendingRegData = { name, biz, phone, email, password, accountType };

      const maskedEmail = email.replace(/(.{1}).+(@.+)/, '$1***$2');
      document.getElementById('otp-masked-email').textContent = maskedEmail;

      ['otp-d1', 'otp-d2', 'otp-d3', 'otp-d4', 'otp-d5', 'otp-d6'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.classList.remove('filled', 'error'); }
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
    };

    document.getElementById('btn-submit-register')?.addEventListener('click', performRegister);
    bindEnterKey(['reg-name-input', 'reg-business-input', 'reg-phone-input', 'reg-email-input', 'reg-password-input', 'reg-password-confirm-input'], performRegister);

    this.initOtpBoxes();

    document.getElementById('btn-back-from-otp')?.addEventListener('click', () => {
      sound.playTap();
      clearInterval(this._otpTimerInterval);
      if (this._pendingOrgData) {
        this._pendingOrgData = null;
        this.showView('profile');
      } else {
        this.showView('register');
      }
    });

    // 4. Verify OTP → either finalize a real account (personal registration)
    // or finalize a new organization (org email verification)
    const performSubmitOtp = async () => {
      const entered = ['otp-d1', 'otp-d2', 'otp-d3', 'otp-d4', 'otp-d5', 'otp-d6']
        .map(id => document.getElementById(id)?.value || '')
        .join('');

      if (entered.length < 6) {
        sound.playError();
        this.showToast('Please enter the complete 6-digit OTP');
        return;
      }

      if (!this._pendingRegData && !this._pendingOrgData) {
        sound.playError();
        this.showToast('Session expired. Please try again.');
        this.showView(this._pendingOrgData ? 'profile' : 'register');
        return;
      }

      const verifyBtn = document.getElementById('btn-submit-otp');
      const originalLabel = verifyBtn ? verifyBtn.textContent : '';
      if (verifyBtn) { verifyBtn.disabled = true; verifyBtn.textContent = 'Verifying...'; }

      const showOtpError = (message) => {
        sound.playError();
        ['otp-d1', 'otp-d2', 'otp-d3', 'otp-d4', 'otp-d5', 'otp-d6'].forEach(id => {
          document.getElementById(id)?.classList.add('error');
        });
        setTimeout(() => {
          ['otp-d1', 'otp-d2', 'otp-d3', 'otp-d4', 'otp-d5', 'otp-d6'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = ''; el.classList.remove('error'); }
          });
          document.getElementById('otp-d1')?.focus();
        }, 600);
        this.showToast(message);
      };

      // ---- Path 1: verifying a NEW organization email ----
      if (this._pendingOrgData) {
        try {
          const res = await fetch(`${API_BASE}/api/verify-org-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orgEmail: this._pendingOrgData.email,
              otp: entered,
              orgName: this._pendingOrgData.orgName,
              adminUserId: this._pendingOrgData.adminUserId,
              migrateExisting: this._pendingOrgData.migrateExisting
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Incorrect OTP');

          clearInterval(this._otpTimerInterval);
          store.adminOrgId = data.organization.id;
          store.adminOrgName = data.organization.name;
          store.persist();

          sound.playSuccess();
          this.showToast(`🏢 ${data.organization.name} created!`);
          this._pendingOrgData = null;
          this.renderProfileScreen();
          this.loadLedgerFromBackend();
          this.renderOrgAdminScreen();
          this.showView('orgAdmin');
        } catch (err) {
          showOtpError(err.message || 'Incorrect OTP! Check the code sent to that email.');
        } finally {
          if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.textContent = originalLabel; }
        }
        return;
      }

      // ---- Path 2: verifying a personal registration ----
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
            password: this._pendingRegData.password
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Incorrect OTP');

        clearInterval(this._otpTimerInterval);
        store.setSignedInUser(data.user);

        const loginIdentifier = document.getElementById('login-identifier-input');
        if (loginIdentifier) loginIdentifier.value = data.user.phone;

        const wantsOrg = this._pendingRegData.accountType === 'organization';
        this._pendingRegData = null;
        this.loadLedgerFromBackend();

        sound.playSuccess();
        this.renderDashboard();
        this.renderProfileScreen();
        this.showView('menu');

        if (wantsOrg) {
          this.showToast(`Account created! Let's set up your organization.`);
          this.openCreateOrgModal();
        } else {
          this.showToast(`Account created! Welcome, ${data.user.business_name || data.user.name}`);
        }
      } catch (err) {
        showOtpError(err.message || 'Incorrect OTP! Check the code sent to your email.');
      } finally {
        if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.textContent = originalLabel; }
      }
    };

    document.getElementById('btn-submit-otp')?.addEventListener('click', performSubmitOtp);

    document.getElementById('btn-resend-otp')?.addEventListener('click', async () => {
      const pending = this._pendingOrgData || this._pendingRegData;
      if (!pending) return;
      sound.playTap();
      const resendBtn = document.getElementById('btn-resend-otp');
      resendBtn.disabled = true;

      try {
        const res = await fetch(`${API_BASE}/api/send-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: pending.email, name: pending.name || pending.orgName })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to resend OTP');

        ['otp-d1', 'otp-d2', 'otp-d3', 'otp-d4', 'otp-d5', 'otp-d6'].forEach(id => {
          const el = document.getElementById(id);
          if (el) { el.value = ''; el.classList.remove('filled', 'error'); }
        });
        this.showToast('New OTP sent to your email!');
        this.startOtpTimer();
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Could not resend OTP.');
        resendBtn.disabled = false;
      }
    });

    // 5. Accept Invite (Join Organization)
    const performAcceptInvite = async () => {
      const token = this._inviteToken || new URLSearchParams(window.location.search).get('invite');
      if (!token) {
        sound.playError();
        this.showToast('Invalid or missing invite link');
        return;
      }

      const username = document.getElementById('invite-username-input')?.value.trim();
      const password = document.getElementById('invite-password-input')?.value;
      const confirmPassword = document.getElementById('invite-password-confirm-input')?.value;

      if (!username) {
        sound.playError();
        this.showToast('Please choose a username');
        return;
      }
      if (!password || password.length < 6) {
        sound.playError();
        this.showToast('Password must be at least 6 characters');
        return;
      }
      if (password !== confirmPassword) {
        sound.playError();
        this.showToast('Passwords do not match! Please check again');
        return;
      }

      const btn = document.getElementById('btn-accept-invite');
      const originalLabel = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Joining organization...'; }

      try {
        const res = await fetch(`${API_BASE}/api/invites/${token}/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to join organization');

        store.setSignedInMember(data.member);
        sound.playSuccess();
        this.showToast(`Joined ${data.member.orgName || 'organization'} successfully!`);

        // Clean invite token from browser URL
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
        this._inviteToken = null;

        this.renderDashboard();
        this.renderProfileScreen();
        this.showView('menu');
        this.loadLedgerFromBackend();
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Failed to join organization.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
      }
    };

    document.getElementById('btn-accept-invite')?.addEventListener('click', performAcceptInvite);
    bindEnterKey(['invite-username-input', 'invite-password-input', 'invite-password-confirm-input'], performAcceptInvite);

    // 6. Forgot Password Modal & Flow
    const openForgotPasswordModal = () => {
      sound.playTap();
      const emailInput = document.getElementById('forgot-email-input');
      const otpInput = document.getElementById('forgot-otp-input');
      const newPassInput = document.getElementById('forgot-new-password-input');
      const confirmPassInput = document.getElementById('forgot-new-password-confirm-input');
      const stepEmail = document.getElementById('forgot-step-email');
      const stepReset = document.getElementById('forgot-step-reset');

      if (stepEmail) stepEmail.style.display = 'block';
      if (stepReset) stepReset.style.display = 'none';

      // Pre-fill with login email if present
      const loginId = document.getElementById('login-identifier-input')?.value.trim();
      if (emailInput) {
        emailInput.value = (loginId && loginId.includes('@')) ? loginId : '';
      }
      if (otpInput) otpInput.value = '';
      if (newPassInput) newPassInput.value = '';
      if (confirmPassInput) confirmPassInput.value = '';

      this.modals.forgotPassword?.classList.add('active');
    };

    document.getElementById('link-forgot-pin')?.addEventListener('click', (e) => {
      e.preventDefault();
      openForgotPasswordModal();
    });

    const performForgotSendOtp = async () => {
      const email = document.getElementById('forgot-email-input')?.value.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sound.playError();
        this.showToast('Please enter a valid email address');
        return;
      }

      const btn = document.getElementById('btn-forgot-send-otp');
      const originalLabel = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending code...'; }

      try {
        let res = await fetch(`${API_BASE}/api/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        // Fallback to /api/send-otp if /api/forgot-password route is not available on remote
        if (res.status === 404) {
          res = await fetch(`${API_BASE}/api/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, name: 'Agent' })
          });
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send reset code');

        this._forgotEmail = email;
        const masked = data.maskedEmail || email.replace(/(.{1}).+(@.+)/, '$1***$2');
        const displayEl = document.getElementById('forgot-masked-email-display');
        if (displayEl) displayEl.textContent = masked;

        document.getElementById('forgot-step-email').style.display = 'none';
        document.getElementById('forgot-step-reset').style.display = 'block';
        document.getElementById('forgot-otp-input')?.focus();

        sound.playSuccess();
        this.showToast(`Reset code sent to ${masked}`);
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Failed to send reset code');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
      }
    };

    document.getElementById('btn-forgot-send-otp')?.addEventListener('click', performForgotSendOtp);
    bindEnterKey(['forgot-email-input'], performForgotSendOtp);

    const performForgotSubmitReset = async () => {
      const email = this._forgotEmail || document.getElementById('forgot-email-input')?.value.trim();
      const otp = document.getElementById('forgot-otp-input')?.value.trim();
      const newPassword = document.getElementById('forgot-new-password-input')?.value;
      const confirmPassword = document.getElementById('forgot-new-password-confirm-input')?.value;

      if (!email || !otp || otp.length < 6) {
        sound.playError();
        this.showToast('Please enter the 6-digit verification code');
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        sound.playError();
        this.showToast('New password must be at least 6 characters');
        return;
      }
      if (newPassword !== confirmPassword) {
        sound.playError();
        this.showToast('Passwords do not match! Please check again');
        return;
      }

      const btn = document.getElementById('btn-forgot-submit-reset');
      const originalLabel = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Resetting password...'; }

      try {
        const res = await fetch(`${API_BASE}/api/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, otp, newPassword })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to reset password');

        sound.playSuccess();
        this.showToast('Password reset successfully! You can now sign in.');
        this.modals.forgotPassword?.classList.remove('active');

        // Pre-fill login with updated credentials
        const loginInput = document.getElementById('login-identifier-input');
        if (loginInput) loginInput.value = email;
        const passInput = document.getElementById('login-password-input');
        if (passInput) {
          passInput.value = '';
          passInput.focus();
        }
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Failed to reset password');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
      }
    };

    document.getElementById('btn-forgot-submit-reset')?.addEventListener('click', performForgotSubmitReset);
    bindEnterKey(['forgot-otp-input', 'forgot-new-password-input', 'forgot-new-password-confirm-input'], performForgotSubmitReset);

    // 7. Update Password Modal (Profile Screen)
    document.getElementById('btn-open-update-password')?.addEventListener('click', () => {
      sound.playTap();
      const curr = document.getElementById('update-current-password-input');
      const np = document.getElementById('update-new-password-input');
      const cnp = document.getElementById('update-new-password-confirm-input');
      if (curr) curr.value = '';
      if (np) np.value = '';
      if (cnp) cnp.value = '';
      this.modals.updatePassword?.classList.add('active');
    });

    const performUpdatePassword = async () => {
      if (!store.currentUserId && !store.memberId) {
        this.showToast('You must be signed in to update password');
        return;
      }

      const currentPassword = document.getElementById('update-current-password-input')?.value;
      const newPassword = document.getElementById('update-new-password-input')?.value;
      const confirmPassword = document.getElementById('update-new-password-confirm-input')?.value;

      if (!currentPassword) {
        sound.playError();
        this.showToast('Please enter your current password');
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        sound.playError();
        this.showToast('New password must be at least 6 characters');
        return;
      }
      if (newPassword !== confirmPassword) {
        sound.playError();
        this.showToast('New passwords do not match! Please check again');
        return;
      }

      const btn = document.getElementById('btn-submit-update-password');
      const originalLabel = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Updating password...'; }

      try {
        const res = await fetch(`${API_BASE}/api/update-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: store.currentUserId,
            memberId: store.memberId,
            currentPassword,
            newPassword
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update password');

        sound.playSuccess();
        this.showToast('Password updated successfully!');
        this.modals.updatePassword?.classList.remove('active');
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Failed to update password');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
      }
    };

    document.getElementById('btn-submit-update-password')?.addEventListener('click', performUpdatePassword);
    bindEnterKey(['update-current-password-input', 'update-new-password-input', 'update-new-password-confirm-input'], performUpdatePassword);

    // Dashboard Header → Profile
    document.querySelector('.agent-profile-exact')?.addEventListener('click', () => {
      sound.playTap();
      this.renderProfileScreen();
      this.showView('profile');
    });

    // Password Peek Toggle (login form)
    document.getElementById('btn-toggle-pin-peek')?.addEventListener('click', () => {
      sound.playTap();
      const passwordInput = document.getElementById('login-password-input');
      if (passwordInput) {
        this.isPinMasked = !this.isPinMasked;
        passwordInput.type = this.isPinMasked ? 'password' : 'text';
      }
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

    // When an item name/unit combo matches something recorded before (typed or
    // picked from suggestions), auto-fill that exact variant's last used price.
    document.getElementById('sale-items-list')?.addEventListener('change', (e) => {
      if (e.target.classList.contains('sale-item-name') || e.target.classList.contains('sale-item-unit')) {
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

      if (!this.isSignedIn()) {
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
            ...this.getActorPayload(),
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

    const performSaveExpense = async () => {
      const title = document.getElementById('expense-title-input')?.value.trim();
      const category = document.getElementById('expense-category-select')?.value;
      const amount = parseFloat(document.getElementById('expense-amount-input')?.value);
      const note = document.getElementById('expense-note-input')?.value.trim();

      if (!title || !amount || amount <= 0) {
        sound.playError();
        this.showToast('Please enter a valid expense title and amount!');
        return;
      }

      if (!this.isSignedIn()) {
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
            ...this.getActorPayload(),
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
    };

    document.getElementById('btn-submit-add-expense')?.addEventListener('click', performSaveExpense);
    bindEnterKey(['expense-title-input', 'expense-amount-input', 'expense-note-input'], performSaveExpense);

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

    // Click a ledger row (Home preview or full History) to see full details
    const openEntryDetailFromEvent = (e) => {
      const row = e.target.closest('.biz-ledger-item');
      if (!row) return;
      sound.playTap();
      this.openEntryDetail(row.getAttribute('data-entry-type'), row.getAttribute('data-entry-id'));
    };
    document.getElementById('home-recent-entries-container')?.addEventListener('click', openEntryDetailFromEvent);
    document.getElementById('history-items-container')?.addEventListener('click', openEntryDetailFromEvent);

    // Print Receipt button inside the entry detail modal
    document.getElementById('btn-print-entry-receipt')?.addEventListener('click', () => {
      sound.playTap();
      const currentEntry = this._activeDetailEntry;
      if (!currentEntry) return;
      receiptManager.generateReceipt({
        ...currentEntry,
        agentName: store.agentName || store.agentBusiness || 'Agent'
      });
    });

    // Toggle the "use a new email" field on the Create Organization modal
    document.getElementById('modal-create-org')?.addEventListener('change', (e) => {
      if (e.target.name === 'org-email-choice') {
        const wrapper = document.getElementById('org-new-email-wrapper');
        if (wrapper) wrapper.style.display = e.target.value === 'new' ? 'block' : 'none';
      }
    });

    // Create Organization submit — either instant (own already-verified
    // email) or via a fresh OTP proof (a new email)
    const performCreateOrg = async () => {
      const orgName = document.getElementById('org-name-input')?.value.trim();
      const useNewEmail = document.querySelector('input[name="org-email-choice"]:checked')?.value === 'new';
      const newEmail = document.getElementById('org-new-email-input')?.value.trim();
      const migrateExisting = document.getElementById('org-migrate-checkbox')?.checked;

      if (!orgName) {
        sound.playError();
        this.showToast('Please enter an organization name');
        return;
      }
      if (useNewEmail && (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail))) {
        sound.playError();
        this.showToast('Please enter a valid organization email');
        return;
      }

      const btn = document.getElementById('btn-submit-create-org');
      const originalLabel = btn ? btn.textContent : '';
      if (btn) btn.disabled = true;

      if (!useNewEmail) {
        if (btn) btn.textContent = 'Creating...';
        try {
          const res = await fetch(`${API_BASE}/api/organizations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orgName, adminUserId: store.currentUserId, migrateExisting })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to create organization');

          store.adminOrgId = data.organization.id;
          store.adminOrgName = data.organization.name;
          store.persist();

          sound.playSuccess();
          this.showToast(`🏢 ${data.organization.name} created!`);
          this.modals.createOrg.classList.remove('active');
          this.renderProfileScreen();
          this.loadLedgerFromBackend();
          this.renderOrgAdminScreen();
          this.showView('orgAdmin');
        } catch (err) {
          sound.playError();
          this.showToast(err.message || 'Could not create organization.');
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
        }
        return;
      }

      // New email path: send OTP, then reuse the existing OTP screen to verify it
      if (btn) btn.textContent = 'Sending code...';
      try {
        const res = await fetch(`${API_BASE}/api/send-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: newEmail, name: orgName })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send OTP');

        this._pendingOrgData = { orgName, email: newEmail, adminUserId: store.currentUserId, migrateExisting };
        const maskedEmail = newEmail.replace(/(.{1}).+(@.+)/, '$1***$2');
        document.getElementById('otp-masked-email').textContent = maskedEmail;
        ['otp-d1', 'otp-d2', 'otp-d3', 'otp-d4', 'otp-d5', 'otp-d6'].forEach(id => {
          const el = document.getElementById(id);
          if (el) { el.value = ''; el.classList.remove('filled', 'error'); }
        });

        this.modals.createOrg.classList.remove('active');
        this.showToast(`OTP sent to ${maskedEmail}`);
        this.startOtpTimer();
        this.showView('otp');
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Could not send OTP.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
      }
    };

    document.getElementById('btn-submit-create-org')?.addEventListener('click', performCreateOrg);
    bindEnterKey(['org-name-input', 'org-new-email-input'], performCreateOrg);

    document.getElementById('btn-back-from-org-admin')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('profile');
    });

    // Add a member — admin only, sets username/password directly
    const performAddMember = async () => {
      const email = document.getElementById('new-member-email-input')?.value.trim();

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sound.playError();
        this.showToast('Please enter a valid email address');
        return;
      }
      if (!store.adminOrgId) return;

      const btn = document.getElementById('btn-add-member');
      const originalLabel = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending invite...'; }

      try {
        const res = await fetch(`${API_BASE}/api/organizations/${store.adminOrgId}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminUserId: store.currentUserId, email })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send invite');

        sound.playSuccess();
        this.showToast(`Invite sent to ${email}!`);
        document.getElementById('new-member-email-input').value = '';
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Could not send invite.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
      }
    };

    document.getElementById('btn-add-member')?.addEventListener('click', performAddMember);
    bindEnterKey(['new-member-email-input'], performAddMember);

    // Remove a member (event delegation on the table body)
    document.getElementById('org-members-table-body')?.addEventListener('click', async (e) => {
      const removeBtn = e.target.closest('.btn-remove-member');
      if (!removeBtn || !store.adminOrgId) return;
      const memberId = removeBtn.getAttribute('data-member-id');
      if (!window.confirm('Remove this member? They will no longer be able to sign in.')) return;

      sound.playTap();
      try {
        const res = await fetch(`${API_BASE}/api/organizations/${store.adminOrgId}/members/${memberId}?adminUserId=${store.currentUserId}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to remove member');
        this.showToast('Member removed');
        this.renderOrgAdminScreen();
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Could not remove member.');
      }
    });

    // Delete organization — admin only, irreversible
    document.getElementById('btn-delete-org')?.addEventListener('click', async () => {
      if (!store.adminOrgId) return;
      if (!window.confirm('This will permanently delete the organization and remove all members. Sales/expenses already recorded are kept but stop being shared. Continue?')) return;

      sound.playTap();
      const btn = document.getElementById('btn-delete-org');
      const originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Deleting...';

      try {
        const res = await fetch(`${API_BASE}/api/organizations/${store.adminOrgId}?adminUserId=${store.currentUserId}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete organization');

        store.adminOrgId = null;
        store.adminOrgName = null;
        store.persist();

        sound.playSuccess();
        this.showToast('Organization deleted');
        this.renderProfileScreen();
        this.loadLedgerFromBackend();
        this.showView('profile');
      } catch (err) {
        sound.playError();
        this.showToast(err.message || 'Could not delete organization.');
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });

    // Modal Close
    document.querySelectorAll('.modal-close-btn, .modal-backdrop-dismiss').forEach(btn => {
      btn.addEventListener('click', () => {
        sound.playTap();
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
      });
    });

    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          sound.playTap();
          modal.classList.remove('active');
        }
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.posApp = new POSApp();
});
