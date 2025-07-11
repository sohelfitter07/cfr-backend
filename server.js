require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const admin = require("firebase-admin");
const axios = require("axios"); // Add axios for Nominatim requests
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

// Function to determine greeting based on the time of day
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// ✅ ADD THIS RIGHT AFTER CARRIERGATEWAYS
function isValidCanadianCarrier(carrier) {
  const validCarriers = [
    'rogers', 'bell', 'telus', 'fido', 'virgin', 
    'koodo', 'freedom', 'chatr', 'public', 'sasktel', 'videotron'
  ];
  return carrier && validCarriers.includes(carrier.toLowerCase());
}
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
// app.post("/api/send-sms", async (req, res) => {
//   const { phoneNumber, carrier, message } = req.body;
//   if (!phoneNumber || !carrier || !message) {
//     return res.status(400).json({ success: false, error: "Missing phone/carrier/message" });
//   }

//   const formattedPhone = phoneNumber.replace(/\D/g, '');
//   const gateway = carrierGateways[carrier.toLowerCase()];
//   if (!gateway) {
//     return res.status(400).json({ success: false, error: "Unsupported carrier" });
//   }

//   try {
//     await emailTransporter.sendMail({
//       from: `"Canadian Fitness Repair" <${process.env.EMAIL_USER}>`,
//       to: `${formattedPhone}@${gateway}`,
//       subject: '',
//       text: message.substring(0, 160)
//     });
//     res.json({ success: true });
//   } catch (error) {
//     console.error("SMS error:", error);
//     res.status(500).json({ success: false, error: "SMS failed" });
//   }
// });

// ✅ General SMS endpoint (Updated to open SMS app instead of sending via gateway)
app.post("/api/send-sms", async (req, res) => {
  const { appointmentId, type } = req.body;
  const db = admin.firestore();
  const docRef = db.collection("appointments").doc(appointmentId);
  const snap = await docRef.get();

  if (!snap.exists) {
    return res.status(404).json({ success: false, error: "Appointment not found" });
  }

  const appointment = snap.data();
  const smsBody = generateSMSBody(appointment, type);

  await db.collection("logs").add({
    type: "sms",
    appointmentId,
    smsSkipped: true, // Log that SMS was skipped (we're opening the SMS app, not sending via carrier)
    timestamp: new Date()
  });

  // Response includes the prefilled phone number and SMS body
  res.json({
    success: true,
    smsBody: smsBody,
    phoneNumber: appointment.phone
  });
});


// ✅ Geocoding endpoint for address autocomplete (via GET)
app.get("/api/geocode", async (req, res) => {
  // Read the query from the URL ?q=...
  const query = (req.query.q || "").trim();
  if (query.length < 3) {
    return res.status(400).json({ error: "Query must be at least 3 characters long" });
  }

  try {
    // Ask Nominatim (Canada only, with a bounding box)
    const response = await axios.get(
      "https://nominatim.openstreetmap.org/search",
      {
        params: {
          q: query,
          format: "json",
          addressdetails: 1,
          limit: 5,
          countrycodes: "ca",
          bounded: 1,
          viewbox: "-141,41,-52,83"
        },
        headers: {
          // Per Nominatim’s usage policy, include a user‐agent identifying your app
          "User-Agent": "CanadianFitnessRepair/1.0 (canadianfitnessrepair@gmail.com)"
        }
      }
    );

    // Keep only Canadian street/house results
    const canadianResults = response.data.filter(r =>
      r.address?.country_code === "ca" &&
      !["waterway", "water", "river", "lake"].includes(r.type)
    );

    res.json(canadianResults);
  } catch (error) {
    console.error("Geocoding proxy error:", error);
    res.status(500).json({ error: "Geocoding service unavailable" });
  }
});


// // ✅ Appointment confirmation
// app.post("/api/send-confirmation", async (req, res) => {
//   const { appointmentId, type } = req.body;
//   if (!appointmentId || !type) {
//     return res.status(400).json({ success: false, error: "Missing appointmentId or type" });
//   }

//   const db = admin.firestore();
//   const docRef = db.collection("appointments").doc(appointmentId);
//   const snap = await docRef.get();
//   if (!snap.exists) {
//     return res.status(404).json({ success: false, error: "Appointment not found" });
//   }

//   const appointment = snap.data();
  
//   // ======== DEBUG LOG ========
//   console.log(`[CONFIRMATION DEBUG] Appointment ${appointmentId}:`, {
//     customer: appointment.customer,
//     phone: appointment.phone,
//     carrier: appointment.carrier || 'MISSING',
//     email: appointment.email || 'MISSING',
//     hasEmail: !!appointment.email,
//     hasSMS: !!(appointment.phone && appointment.carrier)
//   });

//   if (!appointment.email && !appointment.phone) {
//     return res.status(400).json({ success: false, error: "No contact info available" });
//   }

//   const dateObj = appointment.date.toDate?.() || new Date();
//   const dateStr = dateObj.toLocaleDateString("en-CA");
//   const timeStr = dateObj.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });

//   const {
//     customer,
//     equipment = "",
//     issue = "N/A",
//     basePrice = 0,
//     price = 0,
//     status = "Scheduled"
//   } = appointment;

//   const servicePrice = basePrice.toFixed(2);
//   const totalPrice = price.toFixed(2);

//   const emailSubject =
//     type === "confirmation"
//       ? "Appointment Confirmation - Canadian Fitness Repair"
//       : "Repair Status Update - Canadian Fitness Repair";

//       const emailBody =
//       appointment.editedEmailBody?.trim() ||
//       (type === "confirmation"
//         ? `Hi ${customer},\n\nThis is a confirmation from Canadian Fitness Repair.\n\nYour appointment is scheduled for:\n📅 ${dateStr} at ⏰ ${timeStr}\n\nEquipment: ${equipment}\nIssue: ${issue}\n\nService Price: $${servicePrice}\nTotal (incl. tax): $${totalPrice}\nStatus: ${status}\n\nIf you need to reschedule, please contact us at 289-925-7239 or reply to this email.\n\n${EMAIL_FOOTER}`
//         : `Hi ${customer},\n\nHere's an update regarding your repair:\n\nStatus: ${status}\nEquipment: ${equipment}\n\nIf you have any questions, call us at 289-925-7239.\n\n${EMAIL_FOOTER}`);
    
//         const smsBody =
//         appointment.editedSmsBody?.trim() ||
//         (type === "confirmation"
//           ? `Your appt. with Canadian Fitness Repair on ${dateStr} at ${timeStr} is confirmed for ${equipment}. Status: ${status}. Call 289-925-7239.`
//           : `🔧 Repair update: Your ${equipment} status changed to "${status}". Need help? Call 289-925-7239 – Canadian Fitness Repair.`);      
    
//   console.log(smsBody.length);
//   let emailSent = false;
//   let smsSent = false;
//   let smsError = null;
//   let warnings = []; // To collect warnings for frontend

//   // ✅ Send Email
//   if (appointment.email) {
//     try {
//       console.log("✉️ Sending email from:", process.env.EMAIL_USER); // 👈 INSERT HERE
//       await retry(() =>
//         emailTransporter.sendMail({
//           from: `"Canadian Fitness Repair" <${process.env.EMAIL_USER}>`,
//           to: appointment.email,
//           subject: emailSubject,
//           text: emailBody,
//           html: emailBody.replace(/\n/g, "<br>")
//         })
//       );
//       emailSent = true;
//     } catch (err) {
//       console.error("❌ Email failed:", err.message);
//       warnings.push("Email failed: " + err.message); // <-- add this
//     }
//   }

//   // ======== SMS HANDLING ========
//   if (appointment.phone?.trim() && appointment.carrier?.trim()) {
//     const carrierKey = appointment.carrier ? appointment.carrier.toLowerCase() : '';
//     console.log("📲 Carrier key:", carrierKey);

//     // Check if carrier is supported
//     if (carrierKey && carrierGateways[carrierKey]) {
//       try {
//         const rawPhone = appointment.phone.replace(/\D/g, "");
//         console.log("📞 Raw phone number:", rawPhone);

//         const smsGatewayDomain = carrierGateways[carrierKey];
//         console.log("🏁 SMS Gateway domain:", smsGatewayDomain);

//         const smsTo = `${rawPhone}@${smsGatewayDomain}`;
//         console.log("📨 Sending SMS to:", smsTo);
//         console.log("📨 SMS body:", smsBody);

//         // ✅ Check SMS length and log warning if needed
//         if (smsBody.length > 160) {
//           const warningMsg = `⚠️ SMS exceeds 160 chars (${smsBody.length}). May be dropped or split.`;
//           console.warn(warningMsg);
//           warnings.push(warningMsg);

//           await db.collection("logs").add({
//             type: "warning",
//             appointmentId,
//             message: warningMsg,
//             timestamp: new Date()
//           });
//         }

//         await retry(() =>
//           emailTransporter.sendMail({
//             from: `"Canadian Fitness Repair" <${process.env.EMAIL_USER}>`,
//             to: smsTo,
//             subject: "",
//             text: smsBody
//           })
//         );

//         console.log("✅ SMS send succeeded");
//         smsSent = true;

//       } catch (err) {
//         smsError = `SMS failed: ${err.message}`;
//         console.error("❌ SMS failed:", err);
//         warnings.push(smsError);
//       }
//     } else {
//       // If the carrier is not supported, log this as a warning
//       const unsupportedCarrierMsg = `⚠️ SMS skipped: Unsupported carrier '${appointment.carrier}'`;
//       console.warn(unsupportedCarrierMsg);
//       warnings.push(unsupportedCarrierMsg);

//       await db.collection("logs").add({
//         type: "warning",
//         appointmentId,
//         message: unsupportedCarrierMsg,
//         timestamp: new Date()
//       });
//     }
//   }

//   const deliveryStatus =
//     emailSent && smsSent ? "success" :
//     emailSent ? "partial_success" :
//     smsSent && !appointment.email ? "success" : // ✅ If SMS sent and no email was expected
//     smsSent ? "partial_success" :
//     "failed";

//   await docRef.update({
//     confirmationSent: true,
//     confirmationSentAt: new Date(),
//     lastStatusSent: type,
//     lastAttemptStatus: deliveryStatus,
//     needsResend: false
//   });

//   await db.collection("logs").add({
//     type: "confirmation",
//     appointmentId,
//     emailSent,
//     smsSent,
//     status: deliveryStatus,
//     smsError,
//     timestamp: new Date()
//   });

//   // ======== RESPONSE WITH WARNINGS ========
//   res.json({
//     success: true,
//     status: deliveryStatus,
//     warnings
//   });
// });

// ✅ Appointment confirmation
app.post("/api/send-confirmation", async (req, res) => {
  const { appointmentId, type } = req.body;
  if (!appointmentId || !type) {
    return res.status(400).json({ success: false, error: "Missing appointmentId or type" });
  }

  const db = admin.firestore();
  const docRef = db.collection("appointments").doc(appointmentId);
  const snap = await docRef.get();
  if (!snap.exists) {
    return res.status(404).json({ success: false, error: "Appointment not found" });
  }

  const appointment = snap.data();
  
  // ======== DEBUG LOG ========
  console.log(`[CONFIRMATION DEBUG] Appointment ${appointmentId}:`, {
    customer: appointment.customer,
    phone: appointment.phone,
    carrier: appointment.carrier || 'MISSING',
    email: appointment.email || 'MISSING',
    hasEmail: !!appointment.email,
    hasSMS: !!(appointment.phone && appointment.carrier)
  });

  if (!appointment.email && !appointment.phone) {
    return res.status(400).json({ success: false, error: "No contact info available" });
  }

  const dateObj = appointment.date.toDate?.() || new Date();
  const dateStr = dateObj.toLocaleDateString("en-CA");
  const timeStr = dateObj.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });

  const { customer, equipment = "", issue = "N/A", basePrice = 0, price = 0, status = "Scheduled" } = appointment;
  const servicePrice = basePrice.toFixed(2);
  const totalPrice = price.toFixed(2);

  const emailSubject = type === "confirmation" ? "Appointment Confirmation - Canadian Fitness Repair" : "Repair Status Update - Canadian Fitness Repair";

  // Generate Email Body
  const emailBody = appointment.editedEmailBody?.trim() ||
    (type === "confirmation"
      ? `
        <p>${getGreeting()}, ${customer},</p>
        <p>This is a <strong>service appointment booking confirmation</strong> from <strong>Canadian Fitness Repair</strong>.</p>
        <p><strong>Appointment Details:</strong></p>
        <p>📅 <strong>Date:</strong> ${dateStr}<br>⏰ <strong>Time:</strong> ${timeStr}<br>🔧 <strong>Equipment:</strong> ${equipment}<br>📝 <strong>Issue:</strong> ${issue}<br>💵 <strong>Total:</strong> $${totalPrice} (includes 13% Ontario tax)<br>📌 <strong>Status:</strong> ${status}</p>
        <p>If you need to reschedule, please contact us <strong>at least 24 hours in advance</strong> by replying to this email or calling <strong>289-925-7239</strong>.</p>
        <p>To help us prepare, please send clear photos of your <strong>${equipment}</strong>, especially any labels showing the <strong>part number</strong>, <strong>model number</strong>, or <strong>serial number</strong>. You can reply to this email or text us — whichever is more convenient for you.</p>
        <p>Thank you!<br><br>– <strong>Canadian Fitness Repair</strong><br>📧 canadianfitnessrepair@gmail.com<br>📞 289-925-7239<br>🌐 <a href="https://canadianfitnessrepair.com">canadianfitnessrepair.com</a></p>
      `
      : `
        <p>${getGreeting()}, ${customer},</p>
        <p>We’d like to update you regarding your repair with <strong>Canadian Fitness Repair</strong>.</p>
        <p><strong>Equipment:</strong> ${equipment}<br><strong>New Status:</strong> ${status}</p>
        <p>If you have any questions or need clarification, feel free to reply to this email or call us at <strong>289-925-7239</strong>.</p>
        <p>Thank you!<br><br>– <strong>Canadian Fitness Repair</strong><br>📧 canadianfitnessrepair@gmail.com<br>📞 289-925-7239<br>🌐 <a href="https://canadianfitnessrepair.com">canadianfitnessrepair.com</a></p>
      `
    );

  // Generate SMS Body
  const smsBody = appointment.editedSmsBody?.trim() ||
    (type === "confirmation"
      ? `
        ${getGreeting()}, ${customer},  
        This is a service appointment booking confirmation from Canadian Fitness Repair.

        🛠 Appointment Details:
        📅 Date: ${dateStr}
        ⏰ Time: ${timeStr}
        🔧 Equipment: ${equipment}
        📝 Issue: ${issue}
        💵 Total: $${totalPrice} (includes 13% ON tax)
        📌 Status: ${status}

        If you need to reschedule, please notify us at least 24 hours in advance by calling 289-925-7239.

        To help us prepare, please send pictures of your ${equipment} (labels with part, model, or serial numbers). You can reply by text or email — whichever is easier for you.

        – Canadian Fitness Repair
        canadianfitnessrepair.com
        canadianfitnessrepair@gmail.com
      `
      : `
        ${getGreeting()}, ${customer},  
        Your repair update from Canadian Fitness Repair:

        🔧 Equipment: ${equipment}  
        📌 New Status: ${status}

        If you have any questions, reply to this text or call 289-925-7239.

        – Canadian Fitness Repair  
        canadianfitnessrepair.com  
        canadianfitnessrepair@gmail.com
      `
    );

  let emailSent = false;
  let smsSent = false;
  let smsError = null;
  let warnings = [];

  // ✅ Send Email
  if (appointment.email) {
    try {
      console.log("✉️ Sending email from:", process.env.EMAIL_USER);
      await retry(() =>
        emailTransporter.sendMail({
          from: `"Canadian Fitness Repair" <${process.env.EMAIL_USER}>`,
          to: appointment.email,
          subject: emailSubject,
          text: emailBody,
          html: emailBody.replace(/\n/g, "<br>")
        })
      );
      emailSent = true;
    } catch (err) {
      console.error("❌ Email failed:", err.message);
      warnings.push("Email failed: " + err.message);
    }
  }

  // ======== SMS HANDLING ========
  if (appointment.phone?.trim() && appointment.carrier?.trim()) {
    const carrierKey = appointment.carrier ? appointment.carrier.toLowerCase() : '';
    console.log("📲 Carrier key:", carrierKey);

    if (carrierKey && carrierGateways[carrierKey]) {
      smsSent = true;
      console.log("📞 SMS will be handled on frontend, skipping carrier SMS sending.");
    } else {
      // Unsupported carrier
      const unsupportedCarrierMsg = `⚠️ SMS skipped: Unsupported carrier '${appointment.carrier}'`;
      console.warn(unsupportedCarrierMsg);
      warnings.push(unsupportedCarrierMsg);
    }
  }

  const deliveryStatus = emailSent && smsSent ? "success" :
    emailSent ? "partial_success" :
    smsSent && !appointment.email ? "success" : 
    smsSent ? "partial_success" : 
    "failed";

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

  // ======== RESPONSE WITH WARNINGS ========
  res.json({
    success: true,
    status: deliveryStatus,
    warnings
  });
});



// ✅ Reminder email & SMS to customer
app.post("/api/send-reminders", async (req, res) => {
  const db = admin.firestore();
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  try {
    const snapshot = await db.collection("appointments")
      .where("reminderEnabled", "==", true)
      .where("reminderSent", "!=", true) // ✅ Only those that haven't been sent
      .where("date", ">=", now)
      .where("date", "<=", tomorrow)
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ success: true, message: "No reminders to send." });
    }

    const EMAIL_FOOTER = `
--
Thank you,  
Canadian Fitness Repair  
📧 canadianfitnessrepair@gmail.com  
📞 289-925-7239  
🌐 https://canadianfitnessrepair.com
`;

    const results = [];

    for (const doc of snapshot.docs) {
      const appointment = doc.data();
      const appointmentId = doc.id;
      const docRef = db.collection("appointments").doc(appointmentId);

      const dateObj = appointment.date.toDate?.() || new Date();
      const dateStr = dateObj.toLocaleDateString("en-CA");
      const timeStr = dateObj.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });

      const equipment = appointment.equipment || "";
      const status = appointment.status || "Scheduled";
      const customer = appointment.customer || "Customer";

      const emailSubject = "⏰ Appointment Reminder - Canadian Fitness Repair";
      const emailBody =
        `Hi ${customer},

          Just a friendly reminder from Canadian Fitness Repair!

          You have an upcoming service appointment:

          📅 Date: ${dateStr}  
          ⏰ Time: ${timeStr}  
          🔧 Equipment: ${equipment}  
          📌 Current Status: ${status}

          If you need to reschedule, please contact us at 289-925-7239 or reply to this email.

          Thank you,  
          Canadian Fitness Repair  
          📧 canadianfitnessrepair@gmail.com  
          📞 289-925-7239  
          🌐 https://canadianfitnessrepair.com`;

const smsBody = `⏰ Reminder: Appt on ${dateStr} at ${timeStr} for ${equipment}. Status: ${status}. Call 289-925-7239 – Canadian Fitness Repair.`;


      let emailSent = false;
      let smsSent = false;
      let smsError = null;

      // ✅ Send email
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
          console.error("❌ Reminder Email failed:", err.message);
        }
      }

      // ✅ Send SMS
      if (
        appointment.phone &&
        appointment.carrier &&
        appointment.carrier.toLowerCase() !== "unknown"
      ) {
        try {
          const rawPhone = appointment.phone.replace(/\D/g, "");
          const carrier = appointment.carrier.toLowerCase();
          const gateway = carrierGateways[carrier];
          if (!gateway) throw new Error("Unsupported or unknown carrier");

          await retry(() =>
            emailTransporter.sendMail({
              from: `"Canadian Fitness Repair" <${process.env.EMAIL_USER}>`,
              to: `${rawPhone}@${gateway}`,
              subject: "",
              text: smsBody
            })
          );
          smsSent = true;
        } catch (err) {
          smsError = err.message;
          console.error("❌ Reminder SMS failed:", smsError);
        }
      }

      // ✅ Mark reminder as sent to prevent future duplicates
      await docRef.update({
        reminderSent: true,
        reminderSentAt: new Date()
      });

      // ✅ Log the reminder
      await db.collection("logs").add({
        type: "reminder",
        appointmentId,
        emailSent,
        smsSent,
        smsError,
        timestamp: new Date()
      });

      results.push({ appointmentId, emailSent, smsSent });
    }

    res.status(200).json({ success: true, results });

  } catch (error) {
    console.error("❌ /send-reminders failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/dev/preview-template", async (req, res) => {
  const type = req.query.type || "confirmation";
  const format = req.query.format || "email";
  const appointment = req.body;

  // Add dateObj if missing
  appointment.dateObj = appointment.date ? new Date(appointment.date) : new Date();

  try {
    if (format === "email") {
      const html = generateEmailBody(appointment, type);
      res.type("html").send(html);
    } else if (format === "sms") {
      const sms = generateSMSBody(appointment, type);
      res.type("text").send(sms);
    } else {
      res.status(400).send("Unsupported format");
    }
  } catch (err) {
    console.error("Preview template error:", err);
    res.status(500).send("Failed to generate preview");
  }
});


// ✅ Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
