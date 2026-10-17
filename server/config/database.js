import mongoose from 'mongoose';

export async function connectDatabase() {
  if (!process.env.MONGODB_URI) {
    console.warn('MongoDB is not configured; farming history is unavailable.');
    return false;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5_000 });
    console.log('MongoDB connected.');
    return true;
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    return false;
  }
}

export function databaseReady() {
  return mongoose.connection.readyState === 1;
}
