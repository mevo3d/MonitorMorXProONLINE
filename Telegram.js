import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
dotenv.config();

export async function sendToTelegram(message) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message
    })
  });
}
