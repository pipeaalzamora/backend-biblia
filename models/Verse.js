import mongoose from "mongoose";

const verseSchema = new mongoose.Schema({
  libro: {
    type: String,
    required: true,
    lowercase: true,
  },
  capitulo: {
    type: Number,
    required: true,
  },
  versiculo: {
    type: String,
    required: true,
  },
  referencia: {
    type: String,
    required: true,
    unique: true,
  },
  texto: {
    type: String,
    required: true,
  },
  consultaCount: {
    type: Number,
    default: 0,
  },
  compartidoCount: {
    type: Number,
    default: 0,
  },
  favoritoCount: {
    type: Number,
    default: 0,
  },
  lastAccessed: {
    type: Date,
    default: Date.now,
  },
});

// Índices
verseSchema.index({ libro: 1, capitulo: 1, versiculo: 1 });
verseSchema.index({ consultaCount: -1 });
verseSchema.index({ compartidoCount: -1 });
verseSchema.index({ favoritoCount: -1 });

export const Verse = mongoose.model("Verse", verseSchema);
