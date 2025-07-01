require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const twilio = require("twilio")(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

const app = express();
const port = process.env.PORT || 3001;

// ✅ Allowed origins for CORS
const allowedOrigins = [
  "https://canadianfitnessrepair.com",
  "https://www.canadianfitnessrepair.com",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://sohelfitter07.onrender.com",
  "http://localhost:3000"
];

// ✅ Middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS: " + origin));
    }
  }
}));
app.use(express.json());

// ✅ Email transporter setup
const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ✅ Canadian carrier email-to-SMS gateways
const carrierGateways = {
  rogers: "pcs.rogers.com",
  bell: "txt.bell.ca",
  telus: "msg.telus.com",
  fido: "fido.ca",
  virgin: "vmobile.ca",
  koodo: "msg.koodomobile.com",
  freedom: "txt.freedommobile.ca",
  chatr: "pcs.rogers.com",
  public: "txt.publicmobile.ca",
  sasktel: "sms.sasktel.com",
  videotron: "texto.videotron.ca"
};

// ✅ Firebase config endpoint
app.get("/api/firebase-config", (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID,
  });
});

// ✅ Logging endpoint
app.post("/api/log", (req, res) => {
  const log = {
    timestamp: new Date().toISOString(),
    action: req.body.action || "unknown action",
    user: req.body.user || "anonymous"
  };

  console.log("[📋 CFR LOG]", log);
  res.status(200).json({ success: true });
});

// ✅ Send Email endpoint
app.post("/api/send-email", async (req, res) => {
  const { recipient, subject, body } = req.body;

  if (!recipient || !subject || !body) {
    return res.status(400).json({ success: false, error: "Missing fields" });
  }

  try {
    await emailTransporter.sendMail({
      from: `"Canadian Fitness Repair" <${process.env.EMAIL_USER}>`,
      to: recipient,
      subject: subject,
      text: body,
      html: `<div>${body}</div>`
    });

    console.log(`[📧 EMAIL SENT] To: ${recipient}, Subject: ${subject}`);
    res.status(200).json({ success: true, message: "Email sent successfully" });
  } catch (error) {
    console.error("Email sending error:", error);
    res.status(500).json({ success: false, error: "Failed to send email" });
  }
});

// ✅ Send SMS via email-to-SMS
app.post("/api/send-sms", async (req, res) => {
  const { phoneNumber, carrier, message } = req.body;

  if (!phoneNumber || !carrier || !message) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields (phoneNumber, carrier, message)"
    });
  }

  const formattedPhone = phoneNumber.replace(/\D/g, '');
  const gateway = carrierGateways[carrier.toLowerCase()];

  if (!gateway) {
    const carriers = Object.keys(carrierGateways).join(', ');
    return res.status(400).json({
      success: false,
      error: `Unsupported carrier. Supported carriers: ${carriers}`
    });
  }

  try {
    await emailTransporter.sendMail({
      from: `"Canadian Fitness Repair" <${process.env.EMAIL_USER}>`,
      to: `${formattedPhone}@${gateway}`,
      subject: '',
      text: message.substring(0, 160)
    });

    console.log(`[📱 SMS SENT] To: ${formattedPhone} via ${carrier} (${gateway})`);
    res.status(200).json({ success: true, message: "SMS sent successfully" });
  } catch (error) {
    console.error("SMS sending error:", error);
    res.status(500).json({ success: false, error: "Failed to send SMS" });
  }
});

const admin = require("firebase-admin");

// Initialize Firebase Admin (only once)
if (!admin.apps.length) {
  admin.initializeApp();
}

// Helper: Retry wrapper
async function retry(fn, attempts = 3, delayMs = 5000) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

// ✅ Send Confirmation Endpoint
app.post("/api/send-confirmation", async (req, res) => {
  const { appointmentId, type } = req.body;

  if (!appointmentId || !type) {
    return res.status(400).json({ success: false, error: "Missing appointmentId or type" });
  }

  const db = admin.firestore();

  try {
    const docRef = db.collection("appointments").doc(appointmentId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: "Appointment not found" });

    const appointment = snap.data();
    if (!appointment.email && !appointment.phone) {
      return res.status(400).json({ success: false, error: "No contact info available" });
    }

    // Format date/time
    const dateObj = appointment.date.toDate?.() || new Date();
    const dateStr = dateObj.toLocaleDateString("en-CA");
    const timeStr = dateObj.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });

    // Messages
    const messages = type === "confirmation"
      ? {
          email: `Hi ${appointment.customer},\n\nYour appointment is confirmed for ${dateStr} at ${timeStr}.\n\nTo reschedule, call 289-925-7239.\n\nCanadian Fitness Repair`,
          sms: `CFR: Appointment on ${dateStr} at ${timeStr}. Call 289-925-7239.`
        }
      : {
          email: `Hi ${appointment.customer},\n\nRepair status update: ${appointment.status}\n\nCall 289-925-7239.\n\nCanadian Fitness Repair`,
          sms: `CFR: Status - ${appointment.status}. Call 289-925-7239.`
        };

    // ✅ Send email
    let emailSent = false;
    if (appointment.email) {
      try {
        await retry(() => emailTransporter.sendMail({
          from: `"Canadian Fitness Repair" <${process.env.EMAIL_USER}>`,
          to: appointment.email,
          subject: "Canadian Fitness Repair Update",
          text: messages.email
        }));
        emailSent = true;
      } catch (err) {
        console.error("Email failed:", err.message);
      }
    }

    // ✅ Send SMS via carrier lookup
    let smsSent = false;
    let smsError = null;
    if (appointment.phone) {
      try {
        const lookup = await retry(() => twilio.lookups.v1.phoneNumbers(appointment.phone).fetch({ type: "carrier" }));
        const carrier = lookup.carrier?.name?.toLowerCase();
        const gateway = carrierGateways[carrier];
        if (!gateway) throw new Error("Unsupported or unknown carrier");

        await retry(() => emailTransporter.sendMail({
          from: `"CFR SMS" <${process.env.EMAIL_USER}>`,
          to: `${appointment.phone}@${gateway}`,
          subject: '',
          text: messages.sms
        }));

        smsSent = true;
      } catch (err) {
        smsError = err.message;
        console.error("SMS failed:", smsError);
      }
    }

    // Determine delivery status
    const status = emailSent && smsSent ? "success"
                 : emailSent ? "partial_success"
                 : "failed";

    // ✅ Update Firestore
    await docRef.update({
      confirmationSent: true,
      confirmationSentAt: new Date(),
      lastStatusSent: type,
      lastAttemptStatus: status,
      needsResend: false
    });

    // ✅ Log to Firestore
    await db.collection("logs").add({
      type: "confirmation",
      appointmentId,
      emailSent,
      smsSent,
      status,
      smsError,
      timestamp: new Date()
    });

    res.status(200).json({ success: true, status });

  } catch (error) {
    console.error("❌ /send-confirmation failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});



// ✅ Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log("Endpoints:");
  console.log("- GET  /api/firebase-config");
  console.log("- POST /api/log");
  console.log("- POST /api/send-email");
  console.log("- POST /api/send-sms");
});
