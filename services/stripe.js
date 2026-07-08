import Stripe from 'stripe';
import dotenv from 'dotenv';
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

export default stripe;

export const PRICES = {
  premium: process.env.STRIPE_PRICE_PREMIUM || 'price_placeholder',
  obsesion: process.env.STRIPE_PRICE_OBSESION || 'price_placeholder'
};
