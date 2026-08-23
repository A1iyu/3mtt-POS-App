/* ==========================================================================
   3MTT POS TERMINAL - OTP SERVER
   Sends a real 6-digit email OTP via Resend and verifies it.
   Deploy this folder to Render as a Web Service (Node).
   ========================================================================== */

import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors()); // for production, restrict this to your front-end's origin
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Resend's shared sandbox sender — works with no domain setup.
// Once you verify your own domain on Resend, switch this to e.g. otp@yourdomain.com
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';

// In-memory OTP store: email (lowercased) -> { otp, expiresAt }
// Fine for a single small Render instance; OTPs are short-lived by design.
const otpStore = new Map();
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

app.post('/api/send-otp', async (req, res) => {
  const { email, name } = req.body || {};

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'Email service is not configured on the server' });
  }

  const otp = generateOtp();
  const key = email.toLowerCase();
  otpStore.set(key, { otp, expiresAt: Date.now() + OTP_TTL_MS });

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email,
        subject: 'Your 3MTT POS verification code',
        html: `
          <div style="font-family:Arial,sans-serif;padding:24px;background:#f0fdf4;">
            <h2 style="color:#008751;margin:0 0 12px;">3MTT POS Terminal</h2>
            <p style="color:#1f3a2c;">Hi ${name || 'Agent'}, your verification code is:</p>
            <p style="font-size:34px;font-weight:800;letter-spacing:8px;color:#0f2419;margin:16px 0;">${otp}</p>
            <p style="color:#52796f;font-size:13px;">This code expires in 5 minutes. If you didn't request this, you can safely ignore this email.</p>
          </div>
        `
      })
    });

    if (!resendRes.ok) {
      const errBody = await resendRes.text();
      console.error('Resend error:', errBody);
      otpStore.delete(key);
      return res.status(502).json({ error: 'Failed to send OTP email. Please try again.' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('send-otp error:', err);
    otpStore.delete(key);
    res.status(500).json({ error: 'Server error while sending OTP' });
  }
});

// Verify OTP AND create the real account in one step — an account can only
// be created after a real OTP check passes.
app.post('/api/verify-otp', async (req, res) => {
  const { email, otp, name, businessName, phone, pin } = req.body || {};
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required' });
  }

  const key = email.toLowerCase();
  const record = otpStore.get(key);

  if (!record) {
    return res.status(400).json({ error: 'No OTP was requested for this email' });
  }
  if (Date.now() > record.expiresAt) {
    otpStore.delete(key);
    return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
  }
  if (record.otp !== String(otp)) {
    return res.status(400).json({ error: 'Incorrect OTP' });
  }

  otpStore.delete(key);

  // If registration details were sent along with the OTP, create the account now.
  if (name && phone && pin) {
    const { data: user, error } = await supabase
      .from('users')
      .insert({ name, business_name: businessName || null, phone, email, pin })
      .select('id, name, business_name, phone, email, created_at')
      .single();

    if (error) {
      // Postgres unique_violation
      if (error.code === '23505') {
        return res.status(409).json({ error: 'An account with this phone or email already exists' });
      }
      console.error('create user error:', error);
      return res.status(500).json({ error: 'Verified, but failed to create the account' });
    }

    return res.json({ success: true, user });
  }

  res.json({ success: true });
});

// Login with phone + PIN against the real users table
app.post('/api/login', async (req, res) => {
  const { phone, pin } = req.body || {};
  if (!phone || !pin) {
    return res.status(400).json({ error: 'Phone and PIN are required' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, business_name, phone, email, pin, created_at')
    .eq('phone', phone)
    .maybeSingle();

  if (error) {
    console.error('login lookup error:', error);
    return res.status(500).json({ error: 'Server error during login' });
  }
  if (!user || user.pin !== pin) {
    return res.status(401).json({ error: 'Incorrect phone number or PIN' });
  }

  delete user.pin;
  res.json({ success: true, user });
});

// Record a sale with line items. orgId is optional — omit it for a personal entry.
app.post('/api/sales', async (req, res) => {
  const { userId, orgId, items, taxRate, note } = req.body || {};
  if (!userId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'userId and at least one item are required' });
  }

  const subtotal = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
  const tax = taxRate ? subtotal * Number(taxRate) : 0;
  const total = subtotal + tax;

  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({ user_id: userId, org_id: orgId || null, subtotal, tax, total, note: note || null })
    .select()
    .single();

  if (saleError) {
    console.error('create sale error:', saleError);
    return res.status(500).json({ error: 'Failed to record sale' });
  }

  const itemRows = items.map(it => ({
    sale_id: sale.id,
    name: it.name,
    quantity: Number(it.quantity) || 0,
    unit: it.unit || 'pcs',
    unit_price: Number(it.unitPrice) || 0
  }));

  const { data: savedItems, error: itemsError } = await supabase
    .from('sale_items')
    .insert(itemRows)
    .select();

  if (itemsError) {
    console.error('create sale_items error:', itemsError);
    return res.status(500).json({ error: 'Sale saved, but items failed to save' });
  }

  res.json({ success: true, sale: { ...sale, items: savedItems } });
});

// List sales for a user (and optionally a specific org)
app.get('/api/sales', async (req, res) => {
  const { userId, orgId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  let query = supabase
    .from('sales')
    .select('*, sale_items(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (orgId) query = query.eq('org_id', orgId);

  const { data, error } = await query;
  if (error) {
    console.error('list sales error:', error);
    return res.status(500).json({ error: 'Failed to fetch sales' });
  }
  res.json({ sales: data });
});

// Record an expense. orgId is optional — omit it for a personal entry.
app.post('/api/expenses', async (req, res) => {
  const { userId, orgId, category, amount, note } = req.body || {};
  if (!userId || !amount) {
    return res.status(400).json({ error: 'userId and amount are required' });
  }

  const { data, error } = await supabase
    .from('expenses')
    .insert({ user_id: userId, org_id: orgId || null, category: category || null, amount: Number(amount), note: note || null })
    .select()
    .single();

  if (error) {
    console.error('create expense error:', error);
    return res.status(500).json({ error: 'Failed to record expense' });
  }
  res.json({ success: true, expense: data });
});

// List expenses for a user (and optionally a specific org)
app.get('/api/expenses', async (req, res) => {
  const { userId, orgId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  let query = supabase
    .from('expenses')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (orgId) query = query.eq('org_id', orgId);

  const { data, error } = await query;
  if (error) {
    console.error('list expenses error:', error);
    return res.status(500).json({ error: 'Failed to fetch expenses' });
  }
  res.json({ expenses: data });
});

app.get('/', (req, res) => res.send('3MTT POS OTP service is running.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OTP server running on port ${PORT}`));
