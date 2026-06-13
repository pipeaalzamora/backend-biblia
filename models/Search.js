import mongoose from "mongoose";

const searchSchema = new mongoose.Schema({
  userInput: {
    type: String,
    required: true,
    maxlength: 1000,
  },
  temas: [String],
  versiculosRetornados: [{
    libro: String,
    capitulo: Number,
    versiculo: String,
  }],
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
  ipHash: {
    type: String,
    index: true,
  },
  success: Boolean,
  errorMessage: String,
  responseTime: Number,
});

// Índices para analytics
searchSchema.index({ timestamp: -1 });
searchSchema.index({ success: 1, timestamp: -1 });

export const Search = mongoose.model("Search", searchSchema);
