/* ==========================================================================
   BIZLEDGER - THERMAL RECEIPT & SHARING MODULE
   ========================================================================== */

import { sound } from './audio.js';
import { store } from './transactions.js';

export class ReceiptManager {
  constructor() {}

  formatDate(isoString) {
    const d = new Date(isoString);
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  renderThermalReceipt(tx, container) {
    if (!tx || !container) return;

    const tillNum = store?.tillNumber || '5538 9535 44';
    const merchant = (store?.tillName || store?.agentBusiness || 'BIZLEDGER MERCHANT').toUpperCase();

    const html = `
      <div class="thermal-receipt-paper" id="printable-receipt">
        <div class="receipt-header">
          <div class="receipt-brand-title">BIZLEDGER TERMINAL</div>
          <div style="font-size:0.65rem; color:#4b5563; margin-top:2px;">TERMINAL ID: ${tillNum}</div>
          <div style="font-size:0.65rem; color:#4b5563;">MERCHANT: ${merchant}</div>
          <div style="font-size:0.65rem; color:#4b5563; margin-top:2px;">${this.formatDate(tx.timestamp)}</div>
        </div>

        <div class="receipt-row">
          <span>TXN TYPE:</span>
          <strong>${tx.type}</strong>
        </div>
        <div class="receipt-row">
          <span>BENEFICIARY:</span>
          <strong>${tx.beneficiary}</strong>
        </div>
        <div class="receipt-row">
          <span>STAN:</span>
          <span>${tx.stan}</span>
        </div>
        <div class="receipt-row">
          <span>RRN:</span>
          <span style="font-weight:700;">${tx.rrn}</span>
        </div>
        <div class="receipt-row">
          <span>STATUS:</span>
          <strong style="color:${tx.status === 'SUCCESSFUL' ? '#059669' : '#dc2626'}">${tx.status}</strong>
        </div>

        <div class="receipt-row bold">
          <span>AMOUNT:</span>
          <span style="font-size:1.1rem;">₦${tx.amount.toLocaleString()}</span>
        </div>
        <div class="receipt-row">
          <span>CONVENIENCE FEE:</span>
          <span>₦${tx.fee.toLocaleString()}</span>
        </div>
        <div class="receipt-row" style="font-weight:700;">
          <span>TOTAL CHARGED:</span>
          <span>₦${tx.customerPaid.toLocaleString()}</span>
        </div>

        <div class="receipt-barcode">
          <div>||| | |||| | ||||| ||| |||| | ||</div>
          <div style="margin-top:4px;">REF: ${tx.id}</div>
          <div style="font-size:0.6rem; color:#9ca3af; margin-top:6px;">*** CUSTOMER COPY - THANK YOU ***</div>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  // Copy receipt text to clipboard
  async copyReceiptText(tx, showToastCallback) {
    sound.playTap();
    const merchant = (store?.tillName || store?.agentBusiness || 'BIZLEDGER MERCHANT').toUpperCase();
    const text = `
🧾 *BIZLEDGER TRANSACTION RECEIPT*
───────────────────────
• Type: ${tx.title}
• Amount: ₦${tx.amount.toLocaleString()}
• Fee: ₦${tx.fee.toLocaleString()}
• Total: ₦${tx.customerPaid.toLocaleString()}
• Beneficiary: ${tx.beneficiary}
• Status: ${tx.status}
• Date: ${this.formatDate(tx.timestamp)}
• Ref/RRN: ${tx.rrn}
───────────────────────
Merchant: ${merchant}
Thank you for your patronage!
    `.trim();

    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        if (showToastCallback) showToastCallback('Receipt copied to clipboard! 📋');
      } else {
        if (showToastCallback) showToastCallback('Reference: ' + tx.rrn);
      }
    } catch (e) {
      if (showToastCallback) showToastCallback('Ref: ' + tx.rrn);
    }
  }

  // Trigger WhatsApp share
  shareWhatsApp(tx) {
    sound.playTap();
    const text = encodeURIComponent(
      `🧾 *BIZLEDGER RECEIPT*\n` +
      `Amount: ₦${tx.amount.toLocaleString()}\n` +
      `Fee: ₦${tx.fee.toLocaleString()}\n` +
      `Beneficiary: ${tx.beneficiary}\n` +
      `Status: ${tx.status}\n` +
      `RRN: ${tx.rrn}\n` +
      `Date: ${this.formatDate(tx.timestamp)}\n` +
      `Thank you!`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }

  // Thermal Print Simulation
  printReceipt() {
    sound.playTap();
    window.print();
  }
}

export const receiptManager = new ReceiptManager();
