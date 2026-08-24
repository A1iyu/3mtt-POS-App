/* ==========================================================================
   3MTT POS TERMINAL - OTP + LEDGER + ORGANIZATIONS SERVER
   Sends a real 6-digit email OTP via Resend and verifies it, manages the
   real sales/expenses ledger, and manages organizations + their members.
   Deploy this folder to Render as a Web Service (Node).
   ========================================================================== */

import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
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
// Used for both personal account emails and organization emails —
// it doesn't care what the email is "for," just proves ownership of it.
const otpStore = new Map();
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtpEmail(email, name, otp) {
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
          <p style="color:#1f3a2c;">Hi ${name || 'there'}, your verification code is:</p>
          <p style="font-size:34px;font-weight:800;letter-spacing:8px;color:#0f2419;margin:16px 0;">${otp}</p>
          <p style="color:#52796f;font-size:13px;">This code expires in 5 minutes. If you didn't request this, you can safely ignore this email.</p>
        </div>
      `
    })
  });
  return resendRes.ok;
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
    const ok = await sendOtpEmail(email, name, otp);
    if (!ok) {
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
  const { email, otp, name, businessName, phone, password } = req.body || {};
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
  if (name && phone && password) {
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { data: user, error } = await supabase
      .from('users')
      .insert({ name, business_name: businessName || null, phone, email, password_hash: passwordHash })
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

// Login with email OR phone + password, checked against a real bcrypt hash
app.post('/api/login', async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Email/phone and password are required' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, business_name, phone, email, password_hash, created_at')
    .or(`email.eq.${identifier},phone.eq.${identifier}`)
    .maybeSingle();

  if (error) {
    console.error('login lookup error:', error);
    return res.status(500).json({ error: 'Server error during login' });
  }

  const passwordOk = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!user || !passwordOk) {
    return res.status(401).json({ error: 'Incorrect email/phone or password' });
  }

  delete user.password_hash;
  res.json({ success: true, user });
});

// ---- Organizations ----

// Create an organization using the admin's OWN already-verified email — no
// extra OTP needed, since ownership of that email was already proven at
// registration. The server looks up the email itself rather than trusting
// the client, so this can't be spoofed to a different address.
app.post('/api/organizations', async (req, res) => {
  const { orgName, adminUserId, migrateExisting } = req.body || {};
  if (!orgName || !adminUserId) {
    return res.status(400).json({ error: 'orgName and adminUserId are required' });
  }

  const { data: adminUser, error: userErr } = await supabase
    .from('users').select('id, email').eq('id', adminUserId).maybeSingle();
  if (userErr || !adminUser) return res.status(404).json({ error: 'Admin account not found' });

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .insert({ name: orgName, email: adminUser.email, admin_user_id: adminUserId })
    .select()
    .single();

  if (orgErr) {
    if (orgErr.code === '23505') return res.status(409).json({ error: 'That organization email is already in use' });
    console.error('create org error:', orgErr);
    return res.status(500).json({ error: 'Failed to create organization' });
  }

  if (migrateExisting) {
    await supabase.from('sales').update({ org_id: org.id }).eq('user_id', adminUserId).is('org_id', null);
    await supabase.from('expenses').update({ org_id: org.id }).eq('user_id', adminUserId).is('org_id', null);
  }

  res.json({ success: true, organization: org });
});

// Create an organization with a NEW email that needs its own OTP proof —
// same verify pattern as account registration, but creates an organization
// instead of a user.
app.post('/api/verify-org-otp', async (req, res) => {
  const { orgEmail, otp, orgName, adminUserId, migrateExisting } = req.body || {};
  if (!orgEmail || !otp || !orgName || !adminUserId) {
    return res.status(400).json({ error: 'orgEmail, otp, orgName and adminUserId are required' });
  }

  const key = orgEmail.toLowerCase();
  const record = otpStore.get(key);
  if (!record) return res.status(400).json({ error: 'No OTP was requested for this email' });
  if (Date.now() > record.expiresAt) {
    otpStore.delete(key);
    return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
  }
  if (record.otp !== String(otp)) return res.status(400).json({ error: 'Incorrect OTP' });
  otpStore.delete(key);

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .insert({ name: orgName, email: orgEmail, admin_user_id: adminUserId })
    .select()
    .single();

  if (orgErr) {
    if (orgErr.code === '23505') return res.status(409).json({ error: 'That organization email is already in use' });
    console.error('create org error:', orgErr);
    return res.status(500).json({ error: 'Verified, but failed to create the organization' });
  }

  if (migrateExisting) {
    await supabase.from('sales').update({ org_id: org.id }).eq('user_id', adminUserId).is('org_id', null);
    await supabase.from('expenses').update({ org_id: org.id }).eq('user_id', adminUserId).is('org_id', null);
  }

  res.json({ success: true, organization: org });
});

// Which org(s), if any, does this user administer? Called right after
// login/registration so the front-end knows whether to show org-admin UI.
app.get('/api/organizations', async (req, res) => {
  const { adminUserId } = req.query;
  if (!adminUserId) return res.status(400).json({ error: 'adminUserId is required' });

  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, email, created_at')
    .eq('admin_user_id', adminUserId);

  if (error) {
    console.error('list organizations error:', error);
    return res.status(500).json({ error: 'Failed to fetch organizations' });
  }
  res.json({ organizations: data });
});

// Add a member — admin-only. The admin sets the member's username/password
// directly; this is a separate login system from the OTP-verified users table.
app.post('/api/organizations/:orgId/members', async (req, res) => {
  const { orgId } = req.params;
  const { adminUserId, username, email, password } = req.body || {};

  if (!adminUserId || !username || !password) {
    return res.status(400).json({ error: 'adminUserId, username and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const { data: org, error: orgErr } = await supabase
    .from('organizations').select('id, admin_user_id').eq('id', orgId).maybeSingle();
  if (orgErr || !org) return res.status(404).json({ error: 'Organization not found' });
  if (org.admin_user_id !== adminUserId) {
    return res.status(403).json({ error: "Only this organization's admin can add members" });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { data: member, error: memberErr } = await supabase
    .from('org_members')
    .insert({ org_id: orgId, username, email: email || null, password_hash: passwordHash, role: 'member' })
    .select('id, org_id, username, email, role, created_at')
    .single();

  if (memberErr) {
    if (memberErr.code === '23505') return res.status(409).json({ error: 'That username is already taken' });
    console.error('add member error:', memberErr);
    return res.status(500).json({ error: 'Failed to add member' });
  }

  res.json({ success: true, member });
});

// List members — admin-only.
app.get('/api/organizations/:orgId/members', async (req, res) => {
  const { orgId } = req.params;
  const { adminUserId } = req.query;
  if (!adminUserId) return res.status(400).json({ error: 'adminUserId is required' });

  const { data: org, error: orgErr } = await supabase
    .from('organizations').select('id, admin_user_id').eq('id', orgId).maybeSingle();
  if (orgErr || !org) return res.status(404).json({ error: 'Organization not found' });
  if (org.admin_user_id !== adminUserId) return res.status(403).json({ error: 'Not authorized' });

  const { data, error } = await supabase
    .from('org_members')
    .select('id, username, email, role, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('list members error:', error);
    return res.status(500).json({ error: 'Failed to fetch members' });
  }
  res.json({ members: data });
});

// Remove a member — admin-only.
app.delete('/api/organizations/:orgId/members/:memberId', async (req, res) => {
  const { orgId, memberId } = req.params;
  const { adminUserId } = req.query;
  if (!adminUserId) return res.status(400).json({ error: 'adminUserId is required' });

  const { data: org, error: orgErr } = await supabase
    .from('organizations').select('id, admin_user_id').eq('id', orgId).maybeSingle();
  if (orgErr || !org) return res.status(404).json({ error: 'Organization not found' });
  if (org.admin_user_id !== adminUserId) return res.status(403).json({ error: 'Not authorized' });

  const { error } = await supabase.from('org_members').delete().eq('id', memberId).eq('org_id', orgId);
  if (error) {
    console.error('remove member error:', error);
    return res.status(500).json({ error: 'Failed to remove member' });
  }
  res.json({ success: true });
});

// Delete an organization — admin-only. Members are removed automatically
// (cascade). Any sales/expenses that were in this org are KEPT, not deleted —
// their org_id is simply cleared, so the records live on, just no longer
// shared or attributed to a member (ON DELETE SET NULL in the schema).
app.delete('/api/organizations/:orgId', async (req, res) => {
  const { orgId } = req.params;
  const { adminUserId } = req.query;
  if (!adminUserId) return res.status(400).json({ error: 'adminUserId is required' });

  const { data: org, error: orgErr } = await supabase
    .from('organizations').select('id, admin_user_id').eq('id', orgId).maybeSingle();
  if (orgErr || !org) return res.status(404).json({ error: 'Organization not found' });
  if (org.admin_user_id !== adminUserId) return res.status(403).json({ error: 'Not authorized' });

  const { error } = await supabase.from('organizations').delete().eq('id', orgId);
  if (error) {
    console.error('delete org error:', error);
    return res.status(500).json({ error: 'Failed to delete organization' });
  }
  res.json({ success: true });
});

// Org member login — username + password. A separate system from the
// email/phone+password OTP-verified `users` table by design.
app.post('/api/member-login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const { data: member, error } = await supabase
    .from('org_members')
    .select('id, org_id, username, email, role, password_hash, organizations(name)')
    .eq('username', username)
    .maybeSingle();

  if (error) {
    console.error('member login lookup error:', error);
    return res.status(500).json({ error: 'Server error during login' });
  }

  const passwordOk = member ? await bcrypt.compare(password, member.password_hash) : false;
  if (!member || !passwordOk) {
    return res.status(401).json({ error: 'Incorrect username or password' });
  }

  delete member.password_hash;
  const orgName = member.organizations?.name || 'Organization';
  delete member.organizations;

  res.json({ success: true, member: { ...member, orgName } });
});

// ---- Sales & Expenses (personal, or shared org ledger) ----

// Line total rule: for 'pcs' (counting individual items), price is per unit,
// so quantity × price is the line total. For every other unit (kg, litre,
// carton, etc.), quantity is just descriptive — price IS the total for that
// line. Must match app.js exactly, or the total the agent sees won't match
// what actually gets saved.
function lineTotal(item) {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.unitPrice) || 0;
  const unit = (item.unit || 'pcs').trim().toLowerCase();
  return unit === 'pcs' ? qty * price : price;
}

// Record a sale with line items. Either userId (personal, or an admin acting
// with an optional orgId) or orgMemberId (an org member's shared-ledger
// entry — org_id is always derived from the member's own org, never trusted
// from the client) must be provided.
app.post('/api/sales', async (req, res) => {
  const { userId, orgMemberId, orgId: bodyOrgId, items, taxRate, note } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }
  if (!userId && !orgMemberId) {
    return res.status(400).json({ error: 'userId or orgMemberId is required' });
  }

  let insertUserId = null;
  let insertOrgMemberId = null;
  let insertOrgId = null;

  if (orgMemberId) {
    const { data: member, error: memberErr } = await supabase
      .from('org_members').select('id, org_id').eq('id', orgMemberId).maybeSingle();
    if (memberErr || !member) return res.status(404).json({ error: 'Member account not found' });
    insertOrgMemberId = member.id;
    insertOrgId = member.org_id;
  } else {
    insertUserId = userId;
    insertOrgId = bodyOrgId || null;
  }

  const subtotal = items.reduce((sum, it) => sum + lineTotal(it), 0);
  const tax = taxRate ? subtotal * Number(taxRate) : 0;
  const total = subtotal + tax;

  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({
      user_id: insertUserId,
      org_member_id: insertOrgMemberId,
      org_id: insertOrgId,
      subtotal, tax, total,
      note: note || null
    })
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

// List sales. If orgMemberId is given, or userId+orgId together, this
// returns the FULL shared org ledger (every entry in that org, not just
// one person's). Otherwise it returns just that user's personal entries.
app.get('/api/sales', async (req, res) => {
  const { userId, orgMemberId, orgId } = req.query;
  if (!userId && !orgMemberId) return res.status(400).json({ error: 'userId or orgMemberId is required' });

  let effectiveOrgId = orgId || null;

  if (orgMemberId) {
    const { data: member, error: memberErr } = await supabase
      .from('org_members').select('org_id').eq('id', orgMemberId).maybeSingle();
    if (memberErr || !member) return res.status(404).json({ error: 'Member account not found' });
    effectiveOrgId = member.org_id;
  }

  let query = supabase.from('sales').select('*, sale_items(*)').order('created_at', { ascending: false });
  query = effectiveOrgId ? query.eq('org_id', effectiveOrgId) : query.eq('user_id', userId).is('org_id', null);

  const { data, error } = await query;
  if (error) {
    console.error('list sales error:', error);
    return res.status(500).json({ error: 'Failed to fetch sales' });
  }
  res.json({ sales: data });
});

// Record an expense — same personal/org-member actor rules as sales.
app.post('/api/expenses', async (req, res) => {
  const { userId, orgMemberId, orgId: bodyOrgId, category, amount, note } = req.body || {};
  if (!amount) return res.status(400).json({ error: 'amount is required' });
  if (!userId && !orgMemberId) {
    return res.status(400).json({ error: 'userId or orgMemberId is required' });
  }

  let insertUserId = null;
  let insertOrgMemberId = null;
  let insertOrgId = null;

  if (orgMemberId) {
    const { data: member, error: memberErr } = await supabase
      .from('org_members').select('id, org_id').eq('id', orgMemberId).maybeSingle();
    if (memberErr || !member) return res.status(404).json({ error: 'Member account not found' });
    insertOrgMemberId = member.id;
    insertOrgId = member.org_id;
  } else {
    insertUserId = userId;
    insertOrgId = bodyOrgId || null;
  }

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      user_id: insertUserId,
      org_member_id: insertOrgMemberId,
      org_id: insertOrgId,
      category: category || null,
      amount: Number(amount),
      note: note || null
    })
    .select()
    .single();

  if (error) {
    console.error('create expense error:', error);
    return res.status(500).json({ error: 'Failed to record expense' });
  }
  res.json({ success: true, expense: data });
});

// List expenses — same personal-vs-shared-org rules as sales.
app.get('/api/expenses', async (req, res) => {
  const { userId, orgMemberId, orgId } = req.query;
  if (!userId && !orgMemberId) return res.status(400).json({ error: 'userId or orgMemberId is required' });

  let effectiveOrgId = orgId || null;

  if (orgMemberId) {
    const { data: member, error: memberErr } = await supabase
      .from('org_members').select('org_id').eq('id', orgMemberId).maybeSingle();
    if (memberErr || !member) return res.status(404).json({ error: 'Member account not found' });
    effectiveOrgId = member.org_id;
  }

  let query = supabase.from('expenses').select('*').order('created_at', { ascending: false });
  query = effectiveOrgId ? query.eq('org_id', effectiveOrgId) : query.eq('user_id', userId).is('org_id', null);

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
