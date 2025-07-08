const mongoose = require('mongoose');
const { Schema } = mongoose;

const walletSchema = new Schema({
  address: { type: String, required: true, unique: true, index: true },
  workerId: { type: Number, required: true, unique: true }
});

module.exports = mongoose.model('Wallet', walletSchema);