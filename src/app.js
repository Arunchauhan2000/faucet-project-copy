const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const cors = require("cors"); // ✅ CORS imported
const { isAddress } = require("ethers");
const { connectQueue, getChannel, queueName } = require("../utils/queue");
const redisClient = require("../config/redisClient");

const app = express();

// ✅ CORS middleware to allow frontend access
app.use(cors({
  origin: "*", 
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS" ,"PATCH"],
  credentials: true
}));

app.use(express.json());

// ✅ MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Mongo connected"))
  .catch((err) => console.error("❌ Mongo connection failed:", err));

// ✅ RabbitMQ Initialization
connectQueue();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const GUILD_ID = process.env.GUILD_ID;

const rateLimitMiddleware = async (req, res, next) => {
  try {
    const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({ error: "'to' address is required." });
    }

    const ipKey = `faucet:ip:${ip}`;
    const addressKey = `faucet:address:${to.toLowerCase()}`;

    const [ipExists, addressExists] = await Promise.all([
      redisClient.get(ipKey),
      redisClient.get(addressKey),
    ]);

    if (ipExists) {
      return res.status(429).json({ error: "You have already claimed faucet from this IP in the last 24 hours." });
    }

    if (addressExists) {
      return res.status(429).json({ error: "This address has already claimed faucet in the last 24 hours." });
    }

    // Allow request to proceed
    next();

    // Set keys after request is processed
    redisClient.set(ipKey, "1", { EX: 86400 });
    redisClient.set(addressKey, "1", { EX: 86400 });
  } catch (err) {
    console.error("Rate limit error:", err);
    res.status(500).json({ error: "Internal server error during rate limit check." });
  }
};
async function verifyCaptcha(token) {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;

  try {
    const res = await axios.post(
      "https://www.google.com/recaptcha/api/siteverify",
      null,
      {
        params: {
          secret: secretKey,
          response: token,
        },
      }
    );

    return res.data.success;
  } catch (error) {
    console.error("reCAPTCHA verification failed:", error.message);
    return false;
  }
}


app.post("/api/fund-transfer", rateLimitMiddleware, async (req, res) => {
  console.log(req.body);
const { to, amount, captchaToken } = req.body;

  if (!captchaToken) {
    return res.status(400).json({ error: "Captcha token is missing." });
  }

  // ✅ Verify reCAPTCHA
  const captchaValid = await verifyCaptcha(captchaToken);
  if (!captchaValid) {
    return res.status(400).json({ error: "Captcha verification failed." });
  }
  // ✅ Input Validation
  if (!to || amount === undefined) {
    return res.status(400).json({ error: "Request body must contain 'to' and 'amount'." });
  }

  if (!isAddress(to)) {
    return res.status(400).json({ error: "Invalid 'to' address provided." });
  }

  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "'amount' must be a positive number." });
  }
  const MAX_AMOUNT = parseFloat(process.env.FAUCET_MAX_AMOUNT) || 0.1;
  if (amount > MAX_AMOUNT) {
    return res.status(400).json({ error: `Amount exceeds the maximum limit of ${MAX_AMOUNT}.` });
  }

  try {
    const channel = getChannel();
    if (!channel) {
      return res.status(503).json({ error: "Service temporarily unavailable. Please try again later." });
    }

    // ✅ Send to RabbitMQ queue
    channel.sendToQueue(
      queueName,
      Buffer.from(JSON.stringify({ to, amount })),
      { persistent: true }
    );

    res.json({
      success: true,
      message: "Your request has been queued. Please wait a few moments while we process your transaction."
    });
  } catch (err) {
    console.error("❌ Error during fund transfer:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});
app.get("/auth/discord/callback", async (req, res) => {
  const code = req.query.code;

  try {
    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        scope: "identify guilds",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const { access_token } = tokenRes.data;

    // Get user info
    const userRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const guildsRes = await axios.get(
      "https://discord.com/api/users/@me/guilds",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    const isInGuild = guildsRes.data.some((guild) => guild.id === GUILD_ID);

 if (isInGuild) {
  // Send verified=true back to frontend
  res.redirect(`${process.env.CONFIG_URL}/faucet?verified=true`);
} else {
  // Not in the guild yet
  res.redirect(`${process.env.CONFIG_URL}/faucet?verified=false`);
}

  } catch (err) {
    console.error("OAuth Error", err?.response?.data || err.message || err);
    res.redirect(
      `${process.env.CONFIG_URL}/faucet?error=oauth_failed`
    );
  }
});
// ✅ Start server
const server = app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log(`🚀 API listening on port ${process.env.PORT}`);
});

// ✅ Graceful shutdown
const gracefulShutdown = async () => {
  console.log("🛑 Received shutdown signal, closing connections...");
  server.close(async (err) => {
    if (err) {
      console.error("❌ Error closing HTTP server:", err);
      process.exit(1);
    }

    try {
      const channel = getChannel();
      await Promise.all([
        mongoose.connection.close(false),
        redisClient.quit(),
        channel ? channel.connection.close() : Promise.resolve(),
      ]);
      console.log("✅ All connections closed gracefully.");
      process.exit(0);
    } catch (shutdownErr) {
      console.error("❌ Error during graceful shutdown:", shutdownErr);
      process.exit(1);
    }
  });
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

