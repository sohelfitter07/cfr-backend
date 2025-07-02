require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const admin = require("firebase-admin");
const serviceAccount = require("./firebase-service-account.json");

const app = express();
const port = process.env.PORT || 3001;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// ✅ Allowed origins for CORS
const allowedOrigins = [
  "https://canadianfitnessrepair.com",
  "https://www.canadianfitnessrepair.com",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://sohelfitter07.onrender.com",
  "http://localhost:3000"
];

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

// ✅ Email transporter
const emailTransporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ✅ Email-to-SMS carrier gateways (Canada)
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

// ✅ Reusable footer
const EMAIL_FOOTER = `
Thank you,  
Canadian Fitness Repair  
📧 canadianfitnessrepair@gmail.com  
📞 289-925-7239  
🌐 https://canadianfitnessrepair.com`;

// ✅ Retry helper
async function retry(fn, attempts = 3, delayMs = 5000) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
}

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

// ✅ Logging
app.post("/api/log", (req, res) => {
  const log = {
    timestamp: new Date().toISOString(),
    action: req.body.action || "unknown action",
    user: req.body.user || "anonymous"
  };
  console.log("[📋 CFR LOG]", log);
  res.status(200).json({ success: true });
});

// ✅ General email endpoint
app.post("/api/send-email", async (req, res) => {
  const { recipient, subject, body } = req.body;
  if (!recipient || !subject || !body) {
    return res.status(400).json({ success: false, error: "Missing fields" });
  }

  try {
    await emailTransporter.sendMail({
      from: `"Canadian Fitness Repair" <${process.env.EMAIL_USER}>`,
      to: recipient,
      subject,
      text: body,
      html: `<div>${body}</div>`
    });
    res.json({ success: true });
  } catch (error) {
    console.error("Email send error:", error);
    res.status(500).json({ success: false, error: "Email failed" });
  }
});

// ✅ General SMS endpoint
app.post("/api/send-sms", async (req, res) => {
  const { phoneNumber, carrier, message } = req.body;
  if (!phoneNumber || !carrier || !message) {
    return res.status(400).json({ success: false, error: "Missing phone/carrier/message" });
  }

  const formattedPhone = phoneNumber.replace(/\D/g, '');
  const gateway = carrierGateways[carrier.toLowerCase()];
  if (!gateway) {
    return res.status(400).json({ success: false, error: "Unsupported carrier" });
  }

  try {
    await emailTransporter.sendMail({
      from: `"Canadian Fitness Repair" <${process.env.EMAIL_USER}>`,
      to: `${formattedPhone}@${gateway}`,
      subject: '',
      text: message.substring(0, 160)
    });
    res.json({ success: true });
  } catch (error) {
    console.error("SMS error:", error);
    res.status(500).json({ success: false, error: "SMS failed" });
  }
});

// ✅ Appointment confirmation
app.post("/api/send-confirmation", async (req, res) => {
  const { appointmentId, type } = req.body;
  if (!appointmentId || !type) return res.status(400).json({ success: false, error: "Missing data" });

  const db = admin.firestore();
  const docRef = db.collection("appointments").doc(appointmentId);
  const snap = await docRef.get();
  if (!snap.exists) return res.status(404).json({ success: false, error: "Appointment not found" });

  const appointment = snap.data();
  if (!appointment.email && !appointment.phone) return res.status(400).json({ success: false, error: "No contact info" });

  const dateObj = appointment.date.toDate?.() || new Date();
  const dateStr = dateObj.toLocaleDateString("en-CA");
  const timeStr = dateObj.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });

  const { customer, equipment = "", issue = "N/A", basePrice = 0, price = 0, status = "Scheduled" } = appointment;
  const servicePrice = basePrice.toFixed(2);
  const totalPrice = price.toFixed(2);

  const emailSubject = type === "confirmation"
    ? "Appointment Confirmation - Canadian Fitness Repair"
    : "Repair Status Update - Canadian Fitness Repair";

  const emailBody = type === "confirmation"
    ? `Hi ${customer},

This is a confirmation from Canadian Fitness Repair.

Your appointment is scheduled for:
📅 ${dateStr} at ⏰ ${timeStr}

Equipment: ${equipment}
Issue: ${issue}

Service Price: $${servicePrice}
Total (incl. tax): $${totalPrice}
Status: ${status}

If you need to reschedule, please contact us at 289-925-7239 or reply to this email.

${EMAIL_FOOTER}`
    : `Hi ${customer},

Here’s an update regarding your repair:

Status: ${status}
Equipment: ${equipment}

If you have any questions, call us at 289-925-7239 or reply to this email.

${EMAIL_FOOTER}`;

  const smsBody = type === "confirmation"
    ? `Canadian Fitness Repair: Your appt is on ${dateStr} at ${timeStr} for ${equipment}. Call 289-925-7239.`
    : `Canadian Fitness Repair: Current status - ${status} for ${equipment}. Call 289-925-7239.`;

  let emailSent = false, smsSent = false, smsError = null;

  // Email
  if (appointment.email) {
    try {
      await retry(() =>
        emailTransporter.sendMail({
          from: `"Canadian Fitness Repair" <${process.env.EMAIL_USER}>`,
          to: appointment.email,
          subject: emailSubject,
          text: emailBody
        })
      );
      emailSent = true;
    } catch (err) {
      console.error("Email failed:", err.message);
    }
  }

  // SMS
  if (appointment.phone && appointment.carrier && appointment.carrier.toLowerCase() !== "unknown") {
    try {
      const rawPhone = appointment.phone.replace(/\D/g, '');
      const gateway = carrierGateways[appointment.carrier.toLowerCase()];
      if (!gateway) throw new Error("Unsupported or unknown carrier");

      await retry(() =>
        emailTransporter.sendMail({
          from: `"Canadian Fitness Repair" <${process.env.EMAIL_USER}>`,
          to: `${rawPhone}@${gateway}`,
          subject: '',
          text: smsBody
        })
      );
      smsSent = true;
    } catch (err) {
      smsError = err.message;
      console.error("SMS failed:", smsError);
    }
  }

  const deliveryStatus = emailSent && smsSent ? "success"
                      : emailSent ? "partial_success"
                      : "failed";

  await docRef.update({
    confirmationSent: true,
    confirmationSentAt: new Date(),
    lastStatusSent: type,
    lastAttemptStatus: deliveryStatus,
    needsResend: false
  });

  await db.collection("logs").add({
    type: "confirmation",
    appointmentId,
    emailSent,
    smsSent,
    status: deliveryStatus,
    smsError,
    timestamp: new Date()
  });

  res.json({ success: true, status: deliveryStatus });
});

// ✅ Reminder endpoint
app.post("/api/send-reminders", async (req, res) => {
  const db = admin.firestore();
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const snapshot = await db.collection("appointments")
    .where("reminderEnabled", "==", true)
    .where("date", ">=", now)
    .where("date", "<=", tomorrow)
    .get();

  if (snapshot.empty) return res.json({ success: true, message: "No reminders due" });

  const results = [];

  for (const doc of snapshot.docs) {
    const appointment = doc.data();
    const id = doc.id;

    const dateObj = appointment.date.toDate?.() || new Date();
    const dateStr = dateObj.toLocaleDateString("en-CA");
    const timeStr = dateObj.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });

    const emailBody = `Hi ${appointment.customer},

Just a friendly reminder of your upcoming appointment:

📅 ${dateStr} at ⏰ ${timeStr}
Equipment: ${appointment.equipment || ""}
Status: ${appointment.status || "Scheduled"}

Please call or reply if you need to reschedule.

${EMAIL_FOOTER}`;

    const smsBody = `Reminder: Appt on ${dateStr} at ${timeStr} for ${appointment.equipment || "equipment"}. Call 289-925-7239 if needed.`;

    let emailSent = false, smsSent = false, smsError = null;

    if (appointment.email) {
      try {
        await retry(() =>
          emailTransporter.sendMail({
            from: `"Canadian Fitness Repair" <${process.env.EMAIL_USER}>`,
            to: appointment.email,
            subject: "⏰ Appointment Reminder - Canadian Fitness Repair",
            text: emailBody
          })
        );
        emailSent = true;
      } catch (e) {
        console.error("Reminder Email failed:", e.message);
      }
    }

    if (appointment.phone && appointment.carrier && appointment.carrier.toLowerCase() !== "unknown") {
      try {
        const rawPhone = appointment.phone.replace(/\D/g, '');
        const gateway = carrierGateways[appointment.carrier.toLowerCase()];
        if (!gateway) throw new Error("Unsupported carrier");

        await retry(() =>
          emailTransporter.sendMail({
            from: `"Canadian Fitness Repair" <${process.env.EMAIL_USER}>`,
            to: `${rawPhone}@${gateway}`,
            subject: '',
            text: smsBody
          })
        );
        smsSent = true;
      } catch (e) {
        smsError = e.message;
        console.error("Reminder SMS failed:", smsError);
      }
    }

    await db.collection("logs").add({
      type: "reminder",
      appointmentId: id,
      emailSent,
      smsSent,
      smsError,
      timestamp: new Date()
    });

    results.push({ appointmentId: id, emailSent, smsSent });
  }

  res.json({ success: true, results });
});

// ✅ Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
