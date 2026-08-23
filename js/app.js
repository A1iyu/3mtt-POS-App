/* ==========================================================================
   3MTT POS TERMINAL - APP CONTROLLER (Business Bookkeeper & POS State Engine)
   ========================================================================== */

import { sound } from './audio.js';
import { store } from './transactions.js';
import { KeypadController } from './keypad.js';
import { receiptManager } from './receipt.js';

// URL of the deployed OTP backend (see /pos-otp-server). Update after deploying to Render.
const API_BASE = 'https://threemtt-pos-app.onrender.com';

class POSApp {
  constructor() {
    this.currentTxContext = {
      type: 'CASHOUT',
      amount: 0,
      beneficiary: ''
    };

    this.activeTxResult = null;
    this.isPinMasked = true;

    // OTP state (verification itself now happens server-side)
    this._pendingRegData = null;
    this._otpTimerInterval = null;

    this.initKeypads();
    this.initDOM();
    this.initEventListeners();
    this.renderDashboard();
    this.renderProfileScreen();
    this.renderBusinessScreen('ALL');
  }

  initKeypads() {
    // Amount Keypad
    this.amountKeypad = new KeypadController({
      mode: 'amount',
      onAmountChange: (data) => {
        const displayElem = document.getElementById('amount-digits-display');
        const wordsElem = document.getElementById('amount-words-text');
        const nextBtn = document.getElementById('btn-amount-continue');

        if (displayElem) {
          displayElem.textContent = data.formatted;
        }

        if (wordsElem) {
          wordsElem.textContent = data.words;
        }

        if (nextBtn) {
          nextBtn.disabled = data.value <= 0;
          nextBtn.style.opacity = data.value > 0 ? '1' : '0.5';
        }
      }
    });

    // Auth PIN Keypad
    this.authPinKeypad = new KeypadController({
      mode: 'pin',
      maxDigits: 4,
      onPinChange: (pin) => {
        this.updatePinBubbles('auth-pin-bubble', pin);
      },
      onPinComplete: (pin) => {
        this.verifyAuthPin(pin);
      }
    });
  }

  initDOM() {
    this.views = {
      login: document.getElementById('view-login'),
      register: document.getElementById('view-register'),
      otp: document.getElementById('view-otp'),
      menu: document.getElementById('view-menu'),
      business: document.getElementById('view-business'),
      amount: document.getElementById('view-amount'),
      confirm: document.getElementById('view-confirm'),
      pin: document.getElementById('view-pin'),
      success: document.getElementById('view-success'),
      history: document.getElementById('view-history'),
      profile: document.getElementById('view-profile')
    };

    this.modals = {
      details: document.getElementById('modal-details'),
      recordSale: document.getElementById('modal-record-sale'),
      addExpense: document.getElementById('modal-add-expense')
    };

    this.toastElem = document.getElementById('pos-toast');
  }

  showView(viewName) {
    Object.keys(this.views).forEach(key => {
      if (this.views[key]) {
        this.views[key].classList.remove('active');
      }
    });

    if (this.views[viewName]) {
      this.views[viewName].classList.add('active');
    }

    if (viewName === 'profile') {
      this.renderProfileScreen();
    } else if (viewName === 'menu') {
      this.renderDashboard();
    }

    // Update bottom nav state
    const homeBtn = document.getElementById('nav-btn-home');
    const bizBtn = document.getElementById('nav-btn-business');
    const histBtn = document.getElementById('nav-btn-history');
    const profBtn = document.getElementById('nav-btn-profile');

    if (homeBtn && histBtn && profBtn) {
      homeBtn.classList.toggle('active', viewName === 'menu');
      if (bizBtn) bizBtn.classList.toggle('active', viewName === 'business');
      histBtn.classList.toggle('active', viewName === 'history');
      profBtn.classList.toggle('active', viewName === 'profile');
    }
  }

  showToast(message) {
    if (!this.toastElem) return;
    this.toastElem.innerHTML = `<span>⚡</span> <span>${message}</span>`;
    this.toastElem.classList.add('show');
    setTimeout(() => {
      this.toastElem.classList.remove('show');
    }, 2500);
  }

  updatePinBubbles(className, pin) {
    const bubbles = document.querySelectorAll(`.${className}`);
    bubbles.forEach((b, idx) => {
      if (idx < pin.length) {
        b.classList.add('filled');
      } else {
        b.classList.remove('filled');
      }
    });
  }

  verifyAuthPin(pin) {
    if (pin === store.agentPin) {
      this.activeTxResult = store.processTransaction({
        type: this.currentTxContext.type,
        amount: this.currentTxContext.amount,
        beneficiary: this.currentTxContext.beneficiary || 'Customer Walk-in'
      });

      sound.playSuccess();
      const speakMsg = `${this.currentTxContext.type === 'CASHOUT' ? 'Cash withdrawal' : 'Transaction'} of ₦${this.currentTxContext.amount.toLocaleString()} successful`;
      sound.speak(speakMsg);

      this.authPinKeypad.reset();
      this.renderSuccessScreen();
      this.renderBusinessScreen('ALL');
      this.showView('success');
    } else {
      sound.playError();
      this.showToast('Wrong PIN! Please try again.');
      const bubbles = document.querySelectorAll('.auth-pin-bubble');
      bubbles.forEach(b => b.classList.add('error-shake'));
      setTimeout(() => {
        bubbles.forEach(b => b.classList.remove('error-shake'));
        this.authPinKeypad.reset();
      }, 500);
    }
  }


  // OTP digit box auto-advance / backspace / paste logic
  initOtpBoxes() {
    const ids = ['otp-d1', 'otp-d2', 'otp-d3', 'otp-d4', 'otp-d5', 'otp-d6'];
    const boxes = ids.map(id => document.getElementById(id)).filter(Boolean);

    boxes.forEach((box, idx) => {
      box.addEventListener('input', () => {
        const val = box.value.replace(/\D/g, '');
        box.value = val.slice(-1); // keep only last digit
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

  renderDashboard() {
    const balanceElem = document.getElementById('dashboard-balance-val');
    if (balanceElem) {
      balanceElem.textContent = `₦${store.walletBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
    }

    const tillElem = document.getElementById('till-number-val');
    if (tillElem) tillElem.textContent = store.tillNumber;

    const merchantElem = document.getElementById('till-merchant-val');
    if (merchantElem) merchantElem.textContent = store.tillName || `${store.agentBusiness} Concept`;

    const titleElem = document.getElementById('dash-business-title');
    if (titleElem) titleElem.textContent = store.agentBusiness;

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
  }

  renderProfileScreen() {
    const avatarElem = document.getElementById('profile-avatar-circle');
    const bizElem = document.getElementById('profile-business-name');
    const tillElem = document.getElementById('profile-terminal-id');
    const phoneElem = document.getElementById('profile-agent-phone');
    const nameElem = document.getElementById('profile-agent-name');
    const emailElem = document.getElementById('profile-agent-email');
    const statusElem = document.getElementById('profile-agent-status');
    const merchantElem = document.getElementById('profile-merchant-name');
    const tierElem = document.getElementById('profile-commission-tier');

    const initials = (store.agentBusiness || store.agentName || 'AG')
      .split(' ')
      .filter(Boolean)
      .map(w => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    if (avatarElem) avatarElem.textContent = initials || 'AG';
    if (bizElem) bizElem.textContent = store.agentBusiness || 'Agent Business';
    if (tillElem) tillElem.textContent = `Terminal ID: ${store.tillNumber}`;
    if (phoneElem) phoneElem.textContent = store.agentPhone || '0800 000 0000';
    if (nameElem) nameElem.textContent = store.agentName || store.agentBusiness;
    if (emailElem) emailElem.textContent = store.agentEmail || 'agent@3mtt.pos';
    if (statusElem) statusElem.textContent = store.status || 'Active / Online';
    if (merchantElem) merchantElem.textContent = store.tillName || `${store.agentBusiness} Concept`;
    if (tierElem) tierElem.textContent = store.commissionTier || 'Super Agent (75%)';
  }

  // Render Business Bookkeeper & Expense Ledger
  renderBusinessScreen(filter = 'ALL') {
    const stats = store.getBusinessStats();

    const salesElem = document.getElementById('biz-total-sales');
    const expensesElem = document.getElementById('biz-total-expenses');
    const profitElem = document.getElementById('biz-net-profit');

    if (salesElem) salesElem.textContent = `₦${stats.totalSales.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
    if (expensesElem) expensesElem.textContent = `₦${stats.totalExpenses.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
    if (profitElem) {
      const prefix = stats.netProfit >= 0 ? '+' : '';
      profitElem.textContent = `${prefix}₦${stats.netProfit.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
      profitElem.style.color = stats.netProfit >= 0 ? 'var(--ng-green-main)' : '#dc2626';
    }

    const listElem = document.getElementById('biz-ledger-items-container');
    if (!listElem) return;

    let entries = store.businessEntries;
    if (filter !== 'ALL') {
      entries = entries.filter(e => e.type === filter);
    }

    if (entries.length === 0) {
      listElem.innerHTML = `
        <div style="text-align:center; padding:2.5rem 1rem; color:var(--text-muted); background:var(--surface-white); border-radius:var(--radius-lg);">
          <div style="font-size:2.5rem; margin-bottom:0.5rem;">📊</div>
          <div style="font-weight:700;">No sales or expense entries yet</div>
          <div style="font-size:0.8rem; margin-top:0.25rem;">Use the buttons above to record your first entry.</div>
        </div>
      `;
      return;
    }

    listElem.innerHTML = entries.map(item => `
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

  startTransactionFlow(type) {
    sound.playTap();
    this.currentTxContext = {
      type,
      amount: 0,
      beneficiary: ''
    };

    const titleElem = document.getElementById('amount-view-title');
    if (titleElem) titleElem.textContent = store.getTypeTitle(type);

    const extraForm = document.getElementById('amount-extra-inputs');
    if (extraForm) {
      if (type === 'TRANSFER') {
        extraForm.innerHTML = `
          <div class="field-group-exact">
            <label class="field-label-exact">SELECT DESTINATION BANK</label>
            <div class="field-input-box-exact">
              <select class="form-select" id="input-transfer-bank" style="width:100%; background:none; border:none; color:var(--text-dark); font-family:var(--font-main); font-weight:700; outline:none;">
                <option value="GTBank">GTBank (Guaranty Trust)</option>
                <option value="Access Bank">Access Bank</option>
                <option value="Zenith Bank">Zenith Bank</option>
                <option value="First Bank">First Bank of Nigeria</option>
                <option value="UBA">UBA (United Bank for Africa)</option>
                <option value="OPay">OPay Wallet / Merchant</option>
                <option value="Moniepoint">Moniepoint MFB</option>
              </select>
            </div>
          </div>
          <div class="field-group-exact">
            <label class="field-label-exact">ACCOUNT NUMBER</label>
            <div class="field-input-box-exact">
              <input type="tel" id="input-transfer-acct" placeholder="Enter 10-digit NUBAN" maxlength="10" value="0129384812" />
            </div>
          </div>
        `;
        extraForm.style.display = 'block';
      } else if (type === 'AIRTIME') {
        extraForm.innerHTML = `
          <div class="field-group-exact">
            <label class="field-label-exact">NETWORK PROVIDER</label>
            <div class="field-input-box-exact">
              <select class="form-select" id="input-bill-provider" style="width:100%; background:none; border:none; color:var(--text-dark); font-family:var(--font-main); font-weight:700; outline:none;">
                <option value="MTN">MTN Nigeria</option>
                <option value="Airtel">Airtel Nigeria</option>
                <option value="Glo">Globacom (Glo)</option>
                <option value="9mobile">9mobile</option>
              </select>
            </div>
          </div>
          <div class="field-group-exact">
            <label class="field-label-exact">PHONE NUMBER</label>
            <div class="field-input-box-exact">
              <input type="tel" id="input-bill-target" placeholder="Recipient Phone Number" value="08031234567" />
            </div>
          </div>
        `;
        extraForm.style.display = 'block';
      } else {
        extraForm.style.display = 'none';
        extraForm.innerHTML = '';
      }
    }

    this.amountKeypad.reset();
    this.showView('amount');
  }

  proceedToConfirmation() {
    const amount = this.amountKeypad.getNumericValue();
    if (amount <= 0) {
      sound.playError();
      this.showToast('Please enter an amount!');
      return;
    }

    sound.playTap();
    this.currentTxContext.amount = amount;

    const bankSelect = document.getElementById('input-transfer-bank');
    const acctInput = document.getElementById('input-transfer-acct');
    const billProvider = document.getElementById('input-bill-provider');
    const billTarget = document.getElementById('input-bill-target');

    if (bankSelect && acctInput) {
      this.currentTxContext.beneficiary = `${acctInput.value} (${bankSelect.value})`;
    } else if (billProvider && billTarget) {
      this.currentTxContext.beneficiary = `${billProvider.value} - ${billTarget.value}`;
    } else {
      this.currentTxContext.beneficiary = 'Customer Walk-in (Terminal POS)';
    }

    this.renderConfirmationScreen();
    this.showView('confirm');
  }

  renderConfirmationScreen() {
    const { type, amount, beneficiary } = this.currentTxContext;
    const feeInfo = store.calculateFees(type, amount);

    const instructionElem = document.getElementById('confirm-plain-instruction');
    let plainMsg = '';
    if (type === 'CASHOUT' || type === 'CARD') {
      plainMsg = `Hand ₦${amount.toLocaleString()} Cash to Customer`;
    } else if (type === 'TRANSFER') {
      plainMsg = `Transfer ₦${amount.toLocaleString()} to ${beneficiary}`;
    } else {
      plainMsg = `Top up ₦${amount.toLocaleString()} for ${beneficiary}`;
    }

    if (instructionElem) instructionElem.textContent = plainMsg;

    const tableElem = document.getElementById('confirm-breakdown-table');
    if (tableElem) {
      tableElem.innerHTML = `
        <div class="breakdown-row">
          <span>Transaction Type:</span>
          <span class="val">${store.getTypeTitle(type)}</span>
        </div>
        <div class="breakdown-row">
          <span>Target / Recipient:</span>
          <span class="val">${beneficiary}</span>
        </div>
        <div class="breakdown-row">
          <span>Principal Amount:</span>
          <span class="val" style="color:var(--ng-green-main); font-size:1.15rem;">₦${amount.toLocaleString()}</span>
        </div>
        <div class="breakdown-row">
          <span>Agent Convenience Fee:</span>
          <span class="val">₦${feeInfo.fee.toLocaleString()}</span>
        </div>
        <div class="breakdown-row">
          <span>Agent Profit/Commission:</span>
          <span class="val" style="color:var(--ng-green-main);">+₦${feeInfo.commission.toLocaleString()}</span>
        </div>
        <div class="breakdown-row total-row">
          <span>Total Customer Charge:</span>
          <span class="val" style="color:var(--ng-green-main);">₦${feeInfo.totalCustomerPay.toLocaleString()}</span>
        </div>
      `;
    }

    const thumb = document.getElementById('confirm-slide-thumb');
    if (thumb) thumb.style.transform = 'translateX(0px)';
  }

  proceedToPinAuth() {
    sound.playTap();
    this.authPinKeypad.reset();
    this.showView('pin');
  }

  renderSuccessScreen() {
    if (!this.activeTxResult) return;
    const container = document.getElementById('thermal-receipt-container');
    receiptManager.renderThermalReceipt(this.activeTxResult, container);
  }

  renderHistoryScreen(filter = 'ALL') {
    const listElem = document.getElementById('history-items-container');
    if (!listElem) return;

    let items = store.transactions;
    if (filter !== 'ALL') {
      items = items.filter(t => t.status === filter || t.type === filter);
    }

    if (items.length === 0) {
      listElem.innerHTML = `
        <div style="text-align:center; padding:3rem 1rem; color:var(--text-muted); background:var(--surface-white); border-radius:var(--radius-lg);">
          <div style="font-size:2.5rem; margin-bottom:0.5rem;">📭</div>
          <div style="font-weight:700;">No transactions found</div>
        </div>
      `;
      return;
    }

    listElem.innerHTML = items.map(tx => `
      <div class="history-item" data-id="${tx.id}">
        <div class="history-left">
          <div class="history-icon-circle">
            ${tx.type === 'CASHOUT' ? '💼' : tx.type === 'TRANSFER' ? '🔄' : tx.type === 'CARD' ? '💳' : '📱'}
          </div>
          <div>
            <div class="history-title">${tx.title}</div>
            <div class="history-time">${receiptManager.formatDate(tx.timestamp)}</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div class="history-amount">₦${tx.amount.toLocaleString()}</div>
          <span class="status-badge ${tx.status.toLowerCase()}">${tx.status}</span>
        </div>
      </div>
    `).join('');

    listElem.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        const tx = store.transactions.find(t => t.id === id);
        if (tx) {
          this.openTxDetailsModal(tx);
        }
      });
    });
  }

  openTxDetailsModal(tx) {
    sound.playTap();
    const container = document.getElementById('modal-details-receipt-box');
    if (container) {
      receiptManager.renderThermalReceipt(tx, container);
    }
    const modal = this.modals.details;
    if (modal) modal.classList.add('active');

    const printBtn = document.getElementById('btn-modal-reprint');
    const waBtn = document.getElementById('btn-modal-whatsapp');
    const copyBtn = document.getElementById('btn-modal-copy');

    if (printBtn) printBtn.onclick = () => receiptManager.printReceipt();
    if (waBtn) waBtn.onclick = () => receiptManager.shareWhatsApp(tx);
    if (copyBtn) copyBtn.onclick = () => receiptManager.copyReceiptText(tx, (m) => this.showToast(m));
  }

  initEventListeners() {
    // 1. Login Actions
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

        const user = data.user;

        // If this device already has local demo/wallet data for this account, restore it.
        // Otherwise (new device, or cleared storage) bootstrap a fresh local profile —
        // real sales/expenses still live safely in Supabase either way.
        const localMatch = store.accounts.find(a =>
          (a.phone || '').replace(/\s+/g, '') === (user.phone || '').replace(/\s+/g, '')
        );

        if (localMatch) {
          store.setActiveAccount(localMatch);
        } else {
          const tillP1 = Math.floor(1000 + Math.random() * 9000);
          const tillP2 = Math.floor(1000 + Math.random() * 9000);
          const tillP3 = Math.floor(10 + Math.random() * 90);
          store.createAccount({
            name: user.name,
            biz: user.business_name || user.name,
            phone: user.phone,
            email: user.email,
            pin: pinInput,
            tillNumber: `${tillP1} ${tillP2} ${tillP3}`,
            tillName: `${user.business_name || user.name} Concept`
          });
        }

        store.currentUserId = user.id;
        store.persist();

        sound.playSuccess();
        this.showToast('Welcome back, ' + (store.agentBusiness || store.agentName || 'Agent'));
        this.renderDashboard();
        this.renderProfileScreen();
        this.renderBusinessScreen('ALL');
        this.showView('menu');
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

      // Save pending data
      this._pendingRegData = { name, biz, phone, email, pin };

      // Update OTP screen masked contact info
      const maskedEmail = email.replace(/(.{1}).+(@.+)/, '$1***$2');
      document.getElementById('otp-masked-email').textContent = maskedEmail;

      // Clear any previous digit inputs
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
    });

    // OTP digit auto-advance logic
    this.initOtpBoxes();

    // Back from OTP → back to register
    document.getElementById('btn-back-from-otp')?.addEventListener('click', () => {
      sound.playTap();
      clearInterval(this._otpTimerInterval);
      this.showView('register');
    });

    // Verify OTP → finalize account creation
    document.getElementById('btn-submit-otp')?.addEventListener('click', async () => {
      const entered = ['otp-d1', 'otp-d2', 'otp-d3', 'otp-d4', 'otp-d5', 'otp-d6']
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

        // OTP correct and real account created in Supabase — set up local device state too
        clearInterval(this._otpTimerInterval);
        const { name, biz, phone, email, pin } = this._pendingRegData;
        const tillP1 = Math.floor(1000 + Math.random() * 9000);
        const tillP2 = Math.floor(1000 + Math.random() * 9000);
        const tillP3 = Math.floor(10 + Math.random() * 90);
        const generatedTill = `${tillP1} ${tillP2} ${tillP3}`;

        store.createAccount({
          name,
          biz,
          phone,
          email,
          pin,
          tillNumber: generatedTill,
          tillName: `${biz} Concept`
        });

        // Tie this device to the real backend account
        store.currentUserId = data.user.id;
        store.persist();

        // Update login phone input so user can quickly re-login
        const loginPhone = document.getElementById('login-phone-input');
        if (loginPhone) loginPhone.value = phone;

        sound.playSuccess();
        this.showToast(`🎉 Account created! Welcome, ${biz}`);
        this.renderDashboard();
        this.renderProfileScreen();
        this.renderBusinessScreen('ALL');
        this.showView('menu');
        this._pendingRegData = null;
      } catch (err) {
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
        this.showToast(err.message || 'Incorrect OTP! Check the code sent to your email.');
      } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = originalLabel;
      }
    });

    // Resend OTP button
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

    // Dashboard Header Agent Profile Click
    document.querySelector('.agent-profile-exact')?.addEventListener('click', () => {
      sound.playTap();
      this.renderProfileScreen();
      this.showView('profile');
    });

    // PIN Peek Toggle
    document.getElementById('btn-toggle-pin-peek')?.addEventListener('click', () => {
      sound.playTap();
      const pinInput = document.getElementById('login-pin-input');
      if (pinInput) {
        this.isPinMasked = !this.isPinMasked;
        pinInput.type = this.isPinMasked ? 'password' : 'text';
      }
    });

    // Forgot PIN link
    document.getElementById('link-forgot-pin')?.addEventListener('click', () => {
      sound.playTap();
      this.showToast('Enter your registered phone number and PIN to sign in.');
    });

    // 4. Dashboard Copy Till Number
    document.getElementById('btn-copy-till')?.addEventListener('click', async () => {
      sound.playTap();
      const till = store.tillNumber;
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(till.replace(/\s+/g, ''));
      }
      this.showToast(`Till copied: ${till}`);
      sound.speak('Till number ' + till.split('').join(' '));
    });

    // 5. 2x2 Action Tiles
    document.getElementById('tile-withdrawal')?.addEventListener('click', () => this.startTransactionFlow('CASHOUT'));
    document.getElementById('tile-transfer')?.addEventListener('click', () => this.startTransactionFlow('TRANSFER'));
    document.getElementById('tile-card')?.addEventListener('click', () => this.startTransactionFlow('CARD'));
    document.getElementById('tile-airtime')?.addEventListener('click', () => this.startTransactionFlow('AIRTIME'));

    // 6. Bottom Navigation Items
    document.getElementById('nav-btn-home')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('menu');
    });
    document.getElementById('nav-btn-home-from-biz')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('menu');
    });

    document.getElementById('nav-btn-business')?.addEventListener('click', () => {
      sound.playTap();
      this.renderBusinessScreen('ALL');
      this.showView('business');
    });

    document.getElementById('nav-btn-history')?.addEventListener('click', () => {
      sound.playTap();
      this.renderHistoryScreen('ALL');
      this.showView('history');
    });
    document.getElementById('nav-btn-history-from-biz')?.addEventListener('click', () => {
      sound.playTap();
      this.renderHistoryScreen('ALL');
      this.showView('history');
    });

    document.getElementById('nav-btn-profile')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('profile');
    });
    document.getElementById('nav-btn-profile-from-biz')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('profile');
    });

    // 7. Back Navigation Buttons
    document.getElementById('btn-back-from-business')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('menu');
    });
    document.getElementById('btn-back-from-amount')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('menu');
    });
    document.getElementById('btn-back-from-confirm')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('amount');
    });
    document.getElementById('btn-back-from-pin')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('confirm');
    });
    document.getElementById('btn-back-from-history')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('menu');
    });
    document.getElementById('btn-back-from-profile')?.addEventListener('click', () => {
      sound.playTap();
      this.showView('menu');
    });

    // 8. Business Bookkeeping Modal Openers & Submissions
    document.getElementById('btn-open-record-sale')?.addEventListener('click', () => {
      sound.playTap();
      this.modals.recordSale.classList.add('active');
    });

    document.getElementById('btn-open-add-expense')?.addEventListener('click', () => {
      sound.playTap();
      this.modals.addExpense.classList.add('active');
    });

    document.getElementById('btn-submit-record-sale')?.addEventListener('click', () => {
      const title = document.getElementById('sale-title-input')?.value.trim();
      const category = document.getElementById('sale-category-select')?.value;
      const amount = parseFloat(document.getElementById('sale-amount-input')?.value);
      const note = document.getElementById('sale-note-input')?.value.trim();

      if (!title || !amount || amount <= 0) {
        sound.playError();
        this.showToast('Please enter a valid title and amount!');
        return;
      }

      store.recordBusinessEntry({
        type: 'SALE',
        title,
        category,
        amount,
        note
      });

      sound.playSuccess();
      this.showToast(`+₦${amount.toLocaleString()} Sale Recorded!`);
      this.modals.recordSale.classList.remove('active');
      document.getElementById('sale-title-input').value = '';
      document.getElementById('sale-amount-input').value = '';
      document.getElementById('sale-note-input').value = '';

      this.renderBusinessScreen('ALL');
      this.renderDashboard();
    });

    document.getElementById('btn-submit-add-expense')?.addEventListener('click', () => {
      const title = document.getElementById('expense-title-input')?.value.trim();
      const category = document.getElementById('expense-category-select')?.value;
      const amount = parseFloat(document.getElementById('expense-amount-input')?.value);
      const note = document.getElementById('expense-note-input')?.value.trim();

      if (!title || !amount || amount <= 0) {
        sound.playError();
        this.showToast('Please enter a valid expense title and amount!');
        return;
      }

      store.recordBusinessEntry({
        type: 'EXPENSE',
        title,
        category,
        amount,
        note
      });

      sound.playSuccess();
      this.showToast(`-₦${amount.toLocaleString()} Expense Tracked!`);
      this.modals.addExpense.classList.remove('active');
      document.getElementById('expense-title-input').value = '';
      document.getElementById('expense-amount-input').value = '';
      document.getElementById('expense-note-input').value = '';

      this.renderBusinessScreen('ALL');
      this.renderDashboard();
    });

    // Business Filter Pills
    document.querySelectorAll('.biz-filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        sound.playTap();
        document.querySelectorAll('.biz-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const filter = pill.getAttribute('data-filter');
        this.renderBusinessScreen(filter);
      });
    });

    // 9. Keypad Handlers
    document.querySelectorAll('.key-btn-ey[data-digit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const digit = btn.getAttribute('data-digit');
        const keypadType = btn.closest('[data-keypad-context]')?.getAttribute('data-keypad-context');
        if (keypadType === 'auth-pin') {
          this.authPinKeypad.handleDigit(digit);
        } else {
          this.amountKeypad.handleDigit(digit);
        }
      });
    });

    document.querySelectorAll('.key-btn-ey[data-action="backspace"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const keypadType = btn.closest('[data-keypad-context]')?.getAttribute('data-keypad-context');
        if (keypadType === 'auth-pin') this.authPinKeypad.handleBackspace();
        else this.amountKeypad.handleBackspace();
      });
    });

    document.querySelectorAll('.key-btn-ey[data-action="clear"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const keypadType = btn.closest('[data-keypad-context]')?.getAttribute('data-keypad-context');
        if (keypadType === 'auth-pin') this.authPinKeypad.handleClear();
        else this.amountKeypad.handleClear();
      });
    });

    // 10. Amount Presets
    document.querySelectorAll('.preset-chip-ey[data-preset]').forEach(chip => {
      chip.addEventListener('click', () => {
        const preset = parseInt(chip.getAttribute('data-preset'), 10);
        this.amountKeypad.setAmount(preset);
      });
    });

    document.getElementById('btn-amount-continue')?.addEventListener('click', () => this.proceedToConfirmation());

    // 11. Slide to Confirm
    this.initSlideConfirm();

    // 12. Receipt buttons
    document.getElementById('btn-receipt-print')?.addEventListener('click', () => receiptManager.printReceipt());
    document.getElementById('btn-receipt-whatsapp')?.addEventListener('click', () => {
      if (this.activeTxResult) receiptManager.shareWhatsApp(this.activeTxResult);
    });
    document.getElementById('btn-receipt-copy')?.addEventListener('click', () => {
      if (this.activeTxResult) receiptManager.copyReceiptText(this.activeTxResult, (m) => this.showToast(m));
    });
    document.getElementById('btn-new-sale-done')?.addEventListener('click', () => {
      sound.playTap();
      this.renderDashboard();
      this.showView('menu');
    });

    // 13. History Filter
    document.querySelectorAll('.history-filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        sound.playTap();
        document.querySelectorAll('.history-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const filter = pill.getAttribute('data-filter');
        this.renderHistoryScreen(filter);
      });
    });

    // 14. Profile Logout
    document.getElementById('btn-profile-logout')?.addEventListener('click', () => {
      sound.playTap();
      this.showToast('Terminal Locked');
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

  initSlideConfirm() {
    const slider = document.getElementById('confirm-slide-wrapper');
    const thumb = document.getElementById('confirm-slide-thumb');
    if (!slider || !thumb) return;

    let isDragging = false;
    let startX = 0;
    let maxDistance = 0;

    const onStart = (clientX) => {
      isDragging = true;
      startX = clientX;
      maxDistance = slider.offsetWidth - thumb.offsetWidth - 8;
    };

    const onMove = (clientX) => {
      if (!isDragging) return;
      const delta = clientX - startX;
      const clamped = Math.max(0, Math.min(delta, maxDistance));
      thumb.style.transform = `translateX(${clamped}px)`;

      if (clamped >= maxDistance * 0.9) {
        isDragging = false;
        thumb.style.transform = `translateX(${maxDistance}px)`;
        sound.playTap();
        setTimeout(() => {
          this.proceedToPinAuth();
        }, 150);
      }
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      thumb.style.transform = 'translateX(0px)';
    };

    thumb.addEventListener('touchstart', (e) => onStart(e.touches[0].clientX));
    window.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX));
    window.addEventListener('touchend', onEnd);

    thumb.addEventListener('mousedown', (e) => onStart(e.clientX));
    window.addEventListener('mousemove', (e) => onMove(e.clientX));
    window.addEventListener('mouseup', onEnd);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.posApp = new POSApp();
});
