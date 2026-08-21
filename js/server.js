/* ==========================================================================
   3MTT POS TERMINAL - OTP SERVER
   Sends a real 6-digit email OTP via Resend and verifies it.
   Deploy this folder to Render as a Web Service (Node).
   ========================================================================== */

import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors()); // for production, restrict this to your front-end's origin
app.use(express.json());

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

app.post('/api/verify-otp', (req, res) => {
  const { email, otp } = req.body || {};
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
  res.json({ success: true });
});

app.get('/', (req, res) => res.send('3MTT POS OTP service is running.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OTP server running on port ${PORT}`));
