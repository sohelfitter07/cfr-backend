require("dotenv").config(); // Loads .env file if present

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", // change if using other SMTP
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const phone = "2899257239"; // Your test number
const carrierDomain = "msg.koodomobile.com"; // Use correct one
const to = `${phone}@${carrierDomain}`;
const text = "🔧 Test SMS from Canadian Fitness Repair";

transporter.sendMail({
  from: `"CFR Test" <${process.env.EMAIL_USER}>`,
  to,
  subject: "",
  text
}, (err, info) => {
  if (err) {
    console.error("❌ Failed to send:", err);
  } else {
    console.log("✅ Sent:", info.response);
  }
});
