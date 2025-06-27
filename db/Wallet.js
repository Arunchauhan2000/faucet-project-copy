const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema({
  encryptedKey: String,
  address: String,
  active: Boolean
});

module.exports = mongoose.model("Wallet", walletSchema);

