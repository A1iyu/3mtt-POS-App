/* ==========================================================================
   BIZLEDGER - KEYPAD CONTROLLER & AMOUNT UTILS
   ========================================================================== */

import { sound } from './audio.js';

export class KeypadController {
  constructor(options = {}) {
    this.rawAmount = '0'; // in minor unit (kobo/cents) or whole naira
    this.maxDigits = options.maxDigits || 8;
    this.onAmountChange = options.onAmountChange || null;
    this.mode = options.mode || 'amount'; // 'amount' or 'pin'
    this.pin = '';
    this.pinLength = 4;
    this.onPinComplete = options.onPinComplete || null;
    this.onPinChange = options.onPinChange || null;
  }

  reset() {
    this.rawAmount = '0';
    this.pin = '';
    this.notify();
  }

  setAmount(num) {
    this.rawAmount = String(num);
    this.notify();
  }

  handleDigit(digit) {
    sound.playTap();

    if (this.mode === 'pin') {
      if (this.pin.length < this.pinLength) {
        this.pin += String(digit);
        if (this.onPinChange) this.onPinChange(this.pin);
        if (this.pin.length === this.pinLength && this.onPinComplete) {
          this.onPinComplete(this.pin);
        }
      }
      return;
    }

    // Amount mode
    if (this.rawAmount === '0') {
      if (digit === '0' || digit === '00' || digit === '000') return;
      this.rawAmount = String(digit);
    } else {
      if (this.rawAmount.length >= this.maxDigits) return;
      this.rawAmount += String(digit);
    }

    this.notify();
  }

  handleBackspace() {
    sound.playTap();

    if (this.mode === 'pin') {
      if (this.pin.length > 0) {
        this.pin = this.pin.slice(0, -1);
        if (this.onPinChange) this.onPinChange(this.pin);
      }
      return;
    }

    if (this.rawAmount.length <= 1) {
      this.rawAmount = '0';
    } else {
      this.rawAmount = this.rawAmount.slice(0, -1);
    }

    this.notify();
  }

  handleClear() {
    sound.playTap();
    if (this.mode === 'pin') {
      this.pin = '';
      if (this.onPinChange) this.onPinChange(this.pin);
    } else {
      this.rawAmount = '0';
      this.notify();
    }
  }

  addPreset(amountToAdd) {
    sound.playTap();
    const current = parseInt(this.rawAmount, 10) || 0;
    this.rawAmount = String(current + amountToAdd);
    this.notify();
  }

  getNumericValue() {
    return parseInt(this.rawAmount, 10) || 0;
  }

  getFormattedAmount() {
    const val = this.getNumericValue();
    return new Intl.NumberFormat('en-NG').format(val);
  }

  notify() {
    if (this.onAmountChange) {
      this.onAmountChange({
        raw: this.rawAmount,
        value: this.getNumericValue(),
        formatted: this.getFormattedAmount(),
        words: this.getAmountInWords(this.getNumericValue())
      });
    }
  }

  // Convert numbers to words for foolproof outdoor confirmation
  getAmountInWords(amount) {
    if (!amount || amount === 0) return 'Zero Naira';
    
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 
                  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 
                  'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    
    function convertLessThanOneThousand(num) {
      let result = '';
      if (num >= 100) {
        result += ones[Math.floor(num / 100)] + ' Hundred ';
        num %= 100;
        if (num > 0) result += 'and ';
      }
      if (num >= 20) {
        result += tens[Math.floor(num / 10)] + ' ';
        num %= 10;
      }
      if (num > 0) {
        result += ones[num] + ' ';
      }
      return result.trim();
    }

    let words = '';
    if (amount >= 1000000) {
      words += convertLessThanOneThousand(Math.floor(amount / 1000000)) + ' Million ';
      amount %= 1000000;
    }
    if (amount >= 1000) {
      words += convertLessThanOneThousand(Math.floor(amount / 1000)) + ' Thousand ';
      amount %= 1000;
    }
    if (amount > 0) {
      words += convertLessThanOneThousand(amount);
    }

    return words.trim() + ' Naira Only';
  }
}
