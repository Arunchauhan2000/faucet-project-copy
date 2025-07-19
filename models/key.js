const mongoose = require('mongoose');
const { Schema } = mongoose;

const keySchema = new Schema({
  workerId: { type: Number, required: true, unique: true, index: true },
  encryptedKey: { type: String, required: true },
  walletAddress: { type: String, required: true }
});

module.exports = mongoose.model('Key', keySchema, 'faucet_key');
