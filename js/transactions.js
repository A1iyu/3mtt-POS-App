/* ==========================================================================
   3MTT POS TERMINAL - TRANSACTIONS & BUSINESS BOOKKEEPING MANAGER
   ========================================================================== */

const STORAGE_KEYS = {
  BALANCE: '3mtt_pos_wallet_balance_v3',
  DRAWER_CASH: '3mtt_pos_drawer_cash_v3',
  TRANSACTIONS: '3mtt_pos_transactions_list_v3',
  BUSINESS_ENTRIES: '3mtt_pos_business_entries_v3',
  TILL_NUMBER: '3mtt_pos_till_number_v3',
  TILL_NAME: '3mtt_pos_till_name_v3',
  AGENT_BUSINESS: '3mtt_pos_agent_business_v3',
  AGENT_NAME: '3mtt_pos_agent_name_v3',
  AGENT_EMAIL: '3mtt_pos_agent_email_v3',
  AGENT_PIN: '3mtt_pos_agent_pin_v3',
  AGENT_PHONE: '3mtt_pos_agent_phone_v3',
  COMMISSION_TIER: '3mtt_pos_commission_tier_v3',
  ACCOUNTS_LIST: '3mtt_pos_accounts_list_v3'
};

const DEFAULT_STATE = {
  walletBalance: 128450,
  drawerCash: 65000,
  tillNumber: '5538 9535 44',
  tillName: 'Ever Young Business Concept',
  agentBusiness: 'Ever Young Biz',
  agentName: 'Aliyu Musa',
  agentEmail: 'aliyu@everyoung.com',
  agentTag: 'Agent Terminal',
  agentPhone: '0801 234 5678',
  agentPin: '1234',
  commissionTier: 'Super Agent (75%)',
  status: 'Active / Online',
  transactions: [
    {
      id: 'TXN-884920',
      rrn: '003849102931',
      stan: '401928',
      type: 'CASHOUT',
      title: 'Withdrawal (Cash Out)',
      amount: 15000,
      fee: 250,
      commission: 180,
      customerPaid: 15250,
      beneficiary: 'Customer Card / POS',
      status: 'SUCCESSFUL',
      timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
      actionPlain: 'Hand ₦15,000 cash to customer'
    },
    {
      id: 'TXN-884919',
      rrn: '003849102910',
      stan: '401927',
      type: 'TRANSFER',
      title: 'Transfer (Send Funds)',
      amount: 20000,
      fee: 100,
      commission: 70,
      customerPaid: 20100,
      beneficiary: 'Chukwuemeka Okonkwo (Access Bank)',
      status: 'SUCCESSFUL',
      timestamp: new Date(Date.now() - 1000 * 60 * 50).toISOString(),
      actionPlain: 'Send ₦20,000 to Chukwuemeka'
    },
    {
      id: 'TXN-884918',
      rrn: '003849102875',
      stan: '401926',
      type: 'AIRTIME',
      title: 'Airtime Top up',
      amount: 1500,
      fee: 0,
      commission: 45,
      customerPaid: 1500,
      beneficiary: 'MTN - 08039481234',
      status: 'SUCCESSFUL',
      timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
      actionPlain: 'Recharge MTN ₦1,500'
    }
  ],
  businessEntries: [
    {
      id: 'BIZ-101',
      type: 'SALE',
      title: 'Soft Drinks & Snacks Sale',
      category: 'Goods Sold',
      amount: 8500,
      note: 'Cash payment from 3 walk-in customers',
      timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString()
    },
    {
      id: 'BIZ-102',
      type: 'EXPENSE',
      title: 'Generator Fuel (5 Litres)',
      category: 'Utilities & Power',
      amount: 4500,
      note: 'Bought petrol for POS booth power',
      timestamp: new Date(Date.now() - 1000 * 60 * 110).toISOString()
    },
    {
      id: 'BIZ-103',
      type: 'SALE',
      title: 'POS Service Commission',
      category: 'Services',
      amount: 3200,
      note: 'Morning shift cash-out fees collected',
      timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString()
    },
    {
      id: 'BIZ-104',
      type: 'EXPENSE',
      title: 'Thermal Paper Roll (Pack of 5)',
      category: 'Supplies',
      amount: 2000,
      note: 'Receipt rolls for POS terminal',
      timestamp: new Date(Date.now() - 1000 * 60 * 240).toISOString()
    }
  ]
};

export class TransactionStore {
  constructor() {
    this.walletBalance = this.load(STORAGE_KEYS.BALANCE, DEFAULT_STATE.walletBalance);
    this.drawerCash = this.load(STORAGE_KEYS.DRAWER_CASH, DEFAULT_STATE.drawerCash);
    this.tillNumber = this.load(STORAGE_KEYS.TILL_NUMBER, DEFAULT_STATE.tillNumber);
    this.tillName = this.load(STORAGE_KEYS.TILL_NAME, DEFAULT_STATE.tillName);
    this.agentBusiness = this.load(STORAGE_KEYS.AGENT_BUSINESS, DEFAULT_STATE.agentBusiness);
    this.agentName = this.load(STORAGE_KEYS.AGENT_NAME, DEFAULT_STATE.agentName);
    this.agentEmail = this.load(STORAGE_KEYS.AGENT_EMAIL, DEFAULT_STATE.agentEmail);
    this.agentTag = DEFAULT_STATE.agentTag;
    this.agentPhone = this.load(STORAGE_KEYS.AGENT_PHONE, DEFAULT_STATE.agentPhone);
    this.agentPin = this.load(STORAGE_KEYS.AGENT_PIN, DEFAULT_STATE.agentPin);
    this.commissionTier = this.load(STORAGE_KEYS.COMMISSION_TIER, DEFAULT_STATE.commissionTier);
    this.status = DEFAULT_STATE.status;
    this.accounts = this.load(STORAGE_KEYS.ACCOUNTS_LIST, [
      {
        name: DEFAULT_STATE.agentName,
        biz: DEFAULT_STATE.agentBusiness,
        phone: DEFAULT_STATE.agentPhone,
        email: DEFAULT_STATE.agentEmail,
        pin: DEFAULT_STATE.agentPin,
        tillNumber: DEFAULT_STATE.tillNumber,
        tillName: DEFAULT_STATE.tillName,
        commissionTier: DEFAULT_STATE.commissionTier
      }
    ]);
    this.transactions = this.load(STORAGE_KEYS.TRANSACTIONS, DEFAULT_STATE.transactions);
    this.businessEntries = this.load(STORAGE_KEYS.BUSINESS_ENTRIES, DEFAULT_STATE.businessEntries);
  }

  load(key, fallback) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  save(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { }
  }

  calculateFees(type, amount) {
    let customerFee = 0;
    let agentCommission = 0;

    if (type === 'CASHOUT' || type === 'CARD') {
      if (amount <= 5000) customerFee = 100;
      else if (amount <= 10000) customerFee = 200;
      else if (amount <= 20000) customerFee = 300;
      else customerFee = Math.min(1000, Math.ceil(amount * 0.015));
      agentCommission = Math.floor(customerFee * 0.75);
    } else if (type === 'TRANSFER' || type === 'CASHIN') {
      if (amount <= 5000) customerFee = 50;
      else if (amount <= 10000) customerFee = 100;
      else if (amount <= 50000) customerFee = 200;
      else customerFee = 300;
      agentCommission = Math.floor(customerFee * 0.70);
    } else if (type === 'AIRTIME') {
      customerFee = 0;
      agentCommission = Math.floor(amount * 0.03);
    }

    return {
      fee: customerFee,
      commission: agentCommission,
      totalCustomerPay: amount + customerFee,
      netWalletImpact: (type === 'CASHOUT' || type === 'CARD')
        ? +(amount)
        : -(amount + (type === 'TRANSFER' ? 20 : 0))
    };
  }

  processTransaction({ type, amount, beneficiary }) {
    const feeInfo = this.calculateFees(type, amount);
    const stan = String(Math.floor(100000 + Math.random() * 900000));
    const rrn = '00' + String(Date.now()).slice(-10);
    const id = 'TXN-' + stan.slice(-6);

    let actionPlain = '';
    if (type === 'CASHOUT' || type === 'CARD') {
      actionPlain = `Hand ₦${amount.toLocaleString()} cash to customer`;
      this.walletBalance += (amount - (feeInfo.fee - feeInfo.commission));
      this.drawerCash -= amount;
    } else if (type === 'TRANSFER') {
      actionPlain = `Transfer ₦${amount.toLocaleString()} to ${beneficiary}`;
      this.walletBalance -= amount;
    } else {
      actionPlain = `${type} purchase of ₦${amount.toLocaleString()}`;
      this.walletBalance -= amount;
    }

    const newTx = {
      id,
      rrn,
      stan,
      type,
      title: this.getTypeTitle(type),
      amount,
      fee: feeInfo.fee,
      commission: feeInfo.commission,
      customerPaid: feeInfo.totalCustomerPay,
      beneficiary: beneficiary || 'Customer Walk-in',
      status: 'SUCCESSFUL',
      timestamp: new Date().toISOString(),
      actionPlain
    };

    this.transactions.unshift(newTx);

    // Also auto-log transaction commission as a business sale entry
    if (feeInfo.commission > 0) {
      this.recordBusinessEntry({
        type: 'SALE',
        title: `POS Fee: ${this.getTypeTitle(type)}`,
        category: 'POS Commission',
        amount: feeInfo.commission,
        note: `Ref: ${id}`
      });
    }

    this.persist();
    return newTx;
  }

  // Record a new Business Sale or Expense
  recordBusinessEntry({ type, title, category, amount, note }) {
    const id = 'BIZ-' + Math.floor(100 + Math.random() * 900);
    const newEntry = {
      id,
      type, // 'SALE' or 'EXPENSE'
      title,
      category: category || (type === 'SALE' ? 'General Sale' : 'General Expense'),
      amount: parseFloat(amount) || 0,
      note: note || '',
      timestamp: new Date().toISOString()
    };

    if (type === 'SALE') {
      this.drawerCash += newEntry.amount;
    } else if (type === 'EXPENSE') {
      this.drawerCash -= newEntry.amount;
    }

    this.businessEntries.unshift(newEntry);
    this.persist();
    return newEntry;
  }

  getBusinessStats() {
    const totalSales = this.businessEntries
      .filter(e => e.type === 'SALE')
      .reduce((acc, e) => acc + e.amount, 0);

    const totalExpenses = this.businessEntries
      .filter(e => e.type === 'EXPENSE')
      .reduce((acc, e) => acc + e.amount, 0);

    const netProfit = totalSales - totalExpenses;

    return {
      totalSales,
      totalExpenses,
      netProfit,
      drawerCash: this.drawerCash,
      count: this.businessEntries.length
    };
  }

  getTypeTitle(type) {
    switch (type) {
      case 'CASHOUT': return 'Withdrawal (Cash Out)';
      case 'TRANSFER': return 'Transfer (Send Funds)';
      case 'CARD': return 'Card (Pay with Card)';
      case 'AIRTIME': return 'Airtime (Top up)';
      default: return 'POS Transaction';
    }
  }

  persist() {
    this.save(STORAGE_KEYS.BALANCE, this.walletBalance);
    this.save(STORAGE_KEYS.DRAWER_CASH, this.drawerCash);
    this.save(STORAGE_KEYS.TRANSACTIONS, this.transactions);
    this.save(STORAGE_KEYS.BUSINESS_ENTRIES, this.businessEntries);
    this.save(STORAGE_KEYS.TILL_NUMBER, this.tillNumber);
    this.save(STORAGE_KEYS.TILL_NAME, this.tillName);
    this.save(STORAGE_KEYS.AGENT_BUSINESS, this.agentBusiness);
    this.save(STORAGE_KEYS.AGENT_NAME, this.agentName);
    this.save(STORAGE_KEYS.AGENT_EMAIL, this.agentEmail);
    this.save(STORAGE_KEYS.AGENT_PHONE, this.agentPhone);
    this.save(STORAGE_KEYS.AGENT_PIN, this.agentPin);
    this.save(STORAGE_KEYS.COMMISSION_TIER, this.commissionTier);
    // Keep the active account's record up-to-date in the accounts list
    const activeIdx = this.accounts.findIndex(a =>
      (a.phone || '').replace(/\s+/g, '') === (this.agentPhone || '').replace(/\s+/g, '')
    );
    if (activeIdx >= 0) {
      this.accounts[activeIdx] = {
        ...this.accounts[activeIdx],
        walletBalance: this.walletBalance,
        drawerCash: this.drawerCash,
        transactions: this.transactions,
        businessEntries: this.businessEntries,
        tillNumber: this.tillNumber,
        tillName: this.tillName,
        commissionTier: this.commissionTier
      };
    }
    this.save(STORAGE_KEYS.ACCOUNTS_LIST, this.accounts);
  }

  createAccount({ name, biz, phone, email, pin, tillNumber, tillName }) {
    this.agentName = name;
    this.agentBusiness = biz;
    this.agentPhone = phone;
    this.agentEmail = email;
    this.agentPin = pin;
    this.tillNumber = tillNumber;
    this.tillName = tillName || `${biz} Concept`;
    this.commissionTier = 'Super Agent (75%)';
    this.status = 'Active / Online';

    // Fresh initial balances for newly registered agent — no demo funds
    this.walletBalance = 0;
    this.drawerCash = 0;

    // No welcome transaction or opening float — agent starts with a clean ledger
    this.transactions = [];
    this.businessEntries = [];

    // Add or update in accounts list
    const existingIdx = this.accounts.findIndex(a =>
      (a.phone || '').replace(/\s+/g, '') === (phone || '').replace(/\s+/g, '')
    );
    const accountRecord = {
      name: this.agentName,
      biz: this.agentBusiness,
      phone: this.agentPhone,
      email: this.agentEmail,
      pin: this.agentPin,
      tillNumber: this.tillNumber,
      tillName: this.tillName,
      commissionTier: this.commissionTier,
      walletBalance: this.walletBalance,
      drawerCash: this.drawerCash,
      transactions: this.transactions,
      businessEntries: this.businessEntries
    };

    if (existingIdx >= 0) {
      this.accounts[existingIdx] = accountRecord;
    } else {
      this.accounts.push(accountRecord);
    }

    this.persist();
  }

  findAccount(phone, pin) {
    const cleanPhone = (phone || '').replace(/\s+/g, '');
    const cleanPin = (pin || '').trim();
    return this.accounts.find(a => {
      const aPhone = (a.phone || '').replace(/\s+/g, '');
      const aPin = (a.pin || '').trim();
      return aPhone === cleanPhone && aPin === cleanPin;
    });
  }

  setActiveAccount(account) {
    if (!account) return;
    this.agentName = account.name || this.agentName;
    this.agentBusiness = account.biz || account.business || this.agentBusiness;
    this.agentPhone = account.phone || this.agentPhone;
    this.agentEmail = account.email || this.agentEmail;
    this.agentPin = account.pin || this.agentPin;
    this.tillNumber = account.tillNumber || this.tillNumber;
    this.tillName = account.tillName || `${this.agentBusiness} Concept`;
    this.commissionTier = account.commissionTier || 'Super Agent (75%)';
    // Restore this account's saved financial data
    if (account.walletBalance !== undefined) this.walletBalance = account.walletBalance;
    if (account.drawerCash !== undefined) this.drawerCash = account.drawerCash;
    if (account.transactions) this.transactions = account.transactions;
    if (account.businessEntries) this.businessEntries = account.businessEntries;
    this.persist();
  }
}

export const store = new TransactionStore();
