import pkg from "pg";
import dotenv from "dotenv";

const { Pool } = pkg;

dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    rejectUnauthorized: false,
  },
  channelBinding: "require",
});

export const dbController = {
  pool: pool,
};

export const query = async (text, params = []) => {
  const client = await dbController.pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
};