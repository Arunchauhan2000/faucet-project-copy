const mongoose = require("mongoose");

const FaucetKeySchema = new mongoose.Schema({
  label: { type: String, required: true, unique: true }, // e.g., FAUCET_1
  encryptedKey: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("FaucetKey", FaucetKeySchema);
