const mongoose = require("mongoose");

const GoatSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  tagId: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  breed: String,
  age: Number,
  addedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Goat", GoatSchema);
