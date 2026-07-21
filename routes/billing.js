import { Router } from 'express';
import stripe, { PRICES } from '../services/stripe.js';
import supabase from '../services/supabase.js';
import dotenv from 'dotenv';
dotenv.config();

const router = Router();

/**
 * POST /api/billing/checkout
 * Creates a Stripe Checkout session for upgrading.
 */
router.post('/checkout', async (req, res) => {
  try {
    const { plan } = req.body; // 'premium' or 'obsesion'

    if (!plan || !PRICES[plan]) {
      return res.status(400).json({ error: 'Plan inválido. Usa "premium" o "obsesion".' });
    }

    // Get or create Stripe customer
    const { data: userData } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', req.userId)
      .single();

    let customerId = userData?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.userEmail,
        metadata: { supabase_user_id: req.userId }
      });
      customerId = customer.id;

      await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', req.userId);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: PRICES[plan], quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/?billing=success`,
      cancel_url: `${process.env.FRONTEND_URL}/?billing=cancel`,
      metadata: { supabase_user_id: req.userId, plan }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Error al crear sesión de pago' });
  }
});

/**
 * GET /api/billing/status
 * Returns the user's current billing status.
 */
router.get('/status', async (req, res) => {
  try {
    const { data } = await supabase
      .from('users')
      .select('tier, stripe_customer_id')
      .eq('id', req.userId)
      .single();

    res.json({
      tier: data?.tier || 'free',
      hasStripe: !!data?.stripe_customer_id
    });
  } catch (err) {
    console.error('Billing status error:', err);
    res.status(500).json({ error: 'Error al obtener estado de billing' });
  }
});

/**
 * POST /api/billing/portal
 * Creates a Stripe Customer Portal session for managing subscription.
 */
router.post('/portal', async (req, res) => {
  try {
    const { data } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', req.userId)
      .single();

    if (!data?.stripe_customer_id) {
      return res.status(400).json({ error: 'No hay suscripción activa' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: process.env.FRONTEND_URL
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: 'Error al crear portal' });
  }
});

export default router;

/**
 * Webhook handler — exported separately because it needs raw body.
 * Must be mounted BEFORE json body parser.
 */
export async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body, // raw body
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata.supabase_user_id;
      const plan = session.metadata.plan;

      if (userId && plan) {
        await supabase
          .from('users')
          .update({ tier: plan })
          .eq('id', userId);
        console.log(`✅ User ${userId} upgraded to ${plan}`);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const customerId = sub.customer;
      const status = sub.status;

      const { data } = await supabase
        .from('users')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single();

      if (data) {
        if (['past_due', 'unpaid', 'canceled', 'incomplete_expired'].includes(status)) {
          await supabase
            .from('users')
            .update({ tier: 'free' })
            .eq('id', data.id);
          console.log(`⚠️ Subscription status for user ${data.id} is now ${status}. Downgraded to free.`);
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customerId = sub.customer;

      const { data } = await supabase
        .from('users')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single();

      if (data) {
        await supabase
          .from('users')
          .update({ tier: 'free' })
          .eq('id', data.id);
        console.log(`⬇️ User ${data.id} downgraded to free (subscription cancelled)`);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.warn(`⚠️ Payment failed for customer ${invoice.customer}, invoice ${invoice.id}`);
      break;
    }
  }

  res.json({ received: true });
}
