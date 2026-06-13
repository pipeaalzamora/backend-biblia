import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  favorites: [{
    referencia: String,
    texto: String,
    addedAt: {
      type: Date,
      default: Date.now,
    },
  }],
  searchHistory: [{
    searchTerm: String,
    referencia: String,
    texto: String,
    timestamp: {
      type: Date,
      default: Date.now,
    },
  }],
  preferences: {
    theme: {
      type: String,
      enum: ["claro", "oscuro"],
      default: "claro",
    },
    fontSize: {
      type: String,
      enum: ["small", "medium", "large"],
      default: "medium",
    },
    notificationsEnabled: {
      type: Boolean,
      default: false,
    },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastActive: {
    type: Date,
    default: Date.now,
  },
});

userSchema.index({ lastActive: -1 });

export const User = mongoose.model("User", userSchema);
