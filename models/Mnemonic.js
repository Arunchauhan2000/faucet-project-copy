const mongoose = require("mongoose");

const mnemonicSchema = new mongoose.Schema({
  workerId: { type: Number, required: true },
  encryptedMnemonic: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model("Mnemonic", mnemonicSchema);
                                                                                    