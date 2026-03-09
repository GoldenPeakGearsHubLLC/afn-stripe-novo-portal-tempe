import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import Stripe from 'stripe';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { initDb } from './src/db.js';
import { checkoutVelocity } from './src/middleware/rateLimit.js';
import { hashFingerprint } from './src/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
initDb();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const ENABLE_ACH = String(process.env.ENABLE_ACH || 'false').toLowerCase() === 'true';
const MAX_DONATION_USD = Number(process.env.MAX_DONATION_USD || 5000);
const MAX_INVEST_USD = Number(process.env.MAX_INVEST_USD || 25000);

function moneyToCents(usd){ const n=Number(usd); if(!Number.isFinite(n)) return null; return Math.round(n*100); }
function getProducts(){ return db.prepare('SELECT * FROM products WHERE active=1 ORDER BY price_cents ASC').all(); }
function getProductBySlug(slug){ return db.prepare('SELECT * FROM products WHERE slug=? AND active=1').get(slug); }
function insertOrder(order){
  db.prepare(`INSERT INTO orders(kind,product_id,amount_cents,currency,email,status,stripe_session_id,client_reference_id,ip,device_fingerprint,user_agent,created_at,meta_json)
              VALUES (@kind,@product_id,@amount_cents,@currency,@email,@status,@stripe_session_id,@client_reference_id,@ip,@device_fingerprint,@user_agent,@created_at,@meta_json)`).run(order);
}
function updateOrderPaid(sessionId,paymentIntentId,email){
  db.prepare(`UPDATE orders SET status='paid', stripe_payment_intent_id=?, email=COALESCE(email, ?), paid_at=? WHERE stripe_session_id=?`)
    .run(paymentIntentId, email||null, Date.now(), sessionId);
}
function recordWebhookEvent(evt){
  db.prepare(`INSERT INTO webhook_events(stripe_event_id,type,created_at,payload_json) VALUES (?,?,?,?) ON CONFLICT(stripe_event_id) DO NOTHING`)
    .run(evt.id, evt.type, Date.now(), JSON.stringify(evt));
}

// Stripe webhook: raw body required for signature verification
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), (req,res)=>{
  const sig = req.headers['stripe-signature'];
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); }
  catch(err){ return res.status(400).send(`Webhook Error: ${err.message}`); }

  recordWebhookEvent(event);
  if(event.type==='checkout.session.completed'){
    const session = event.data.object;
    updateOrderPaid(session.id, session.payment_intent, session.customer_details?.email);
  }
  res.json({received:true});
});

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,'public')));

app.get('/api/products', (req,res)=> res.json({products:getProducts()}));

app.post('/api/checkout/product', checkoutVelocity, async (req,res)=>{
  try{
    const {slug,email,client_reference_id,device_fingerprint} = req.body;
    const product = getProductBySlug(slug);
    if(!product) return res.status(404).json({error:'Product not found'});
    const payment_method_types = ENABLE_ACH ? ['card','us_bank_account'] : ['card'];
    const session = await stripe.checkout.sessions.create({
      mode:'payment',
      payment_method_types,
      line_items:[{price_data:{currency:product.currency,product_data:{name:product.name,description:product.description||undefined},unit_amount:product.price_cents},quantity:1}],
      customer_email: email || undefined,
      client_reference_id: client_reference_id || undefined,
      metadata:{kind:'product',slug},
      success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/cancel.html`,
    });
    insertOrder({kind:'product',product_id:product.id,amount_cents:product.price_cents,currency:product.currency,email:email||null,status:'created',stripe_session_id:session.id,client_reference_id:client_reference_id||null,ip:req.ip,device_fingerprint:hashFingerprint(device_fingerprint),user_agent:req.headers['user-agent']||null,created_at:Date.now(),meta_json:JSON.stringify({slug})});
    res.json({url:session.url});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/checkout/donation', checkoutVelocity, async (req,res)=>{
  try{
    const {amount_usd,email,message,client_reference_id,device_fingerprint} = req.body;
    const cents = moneyToCents(amount_usd);
    if(!cents || cents<100) return res.status(400).json({error:'Minimum donation is $1.00'});
    if(cents>MAX_DONATION_USD*100) return res.status(400).json({error:`Max donation is $${MAX_DONATION_USD}`});
    const payment_method_types = ENABLE_ACH ? ['card','us_bank_account'] : ['card'];
    const session = await stripe.checkout.sessions.create({
      mode:'payment',
      payment_method_types,
      line_items:[{price_data:{currency:'usd',product_data:{name:'AFN Donation'},unit_amount:cents},quantity:1}],
      customer_email: email || undefined,
      client_reference_id: client_reference_id || undefined,
      metadata:{kind:'donation',message:(message||'').slice(0,200)},
      success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/cancel.html`,
    });
    insertOrder({kind:'donation',product_id:null,amount_cents:cents,currency:'usd',email:email||null,status:'created',stripe_session_id:session.id,client_reference_id:client_reference_id||null,ip:req.ip,device_fingerprint:hashFingerprint(device_fingerprint),user_agent:req.headers['user-agent']||null,created_at:Date.now(),meta_json:JSON.stringify({message:message||null})});
    res.json({url:session.url});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/checkout/invest', checkoutVelocity, async (req,res)=>{
  try{
    const {amount_usd,email,notes,client_reference_id,device_fingerprint} = req.body;
    const cents = moneyToCents(amount_usd);
    if(!cents || cents<1000) return res.status(400).json({error:'Minimum investor contribution is $10.00'});
    if(cents>MAX_INVEST_USD*100) return res.status(400).json({error:`Max investor contribution is $${MAX_INVEST_USD}`});
    const payment_method_types = ENABLE_ACH ? ['card','us_bank_account'] : ['card'];
    const session = await stripe.checkout.sessions.create({
      mode:'payment',
      payment_method_types,
      line_items:[{price_data:{currency:'usd',product_data:{name:'AFN Investor Contribution'},unit_amount:cents},quantity:1}],
      customer_email: email || undefined,
      client_reference_id: client_reference_id || undefined,
      metadata:{kind:'investment',notes:(notes||'').slice(0,200)},
      success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/cancel.html`,
    });
    insertOrder({kind:'investment',product_id:null,amount_cents:cents,currency:'usd',email:email||null,status:'created',stripe_session_id:session.id,client_reference_id:client_reference_id||null,ip:req.ip,device_fingerprint:hashFingerprint(device_fingerprint),user_agent:req.headers['user-agent']||null,created_at:Date.now(),meta_json:JSON.stringify({notes:notes||null})});
    res.json({url:session.url});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/order_status', (req,res)=>{
  const session_id = req.query.session_id;
  if(!session_id) return res.status(400).json({error:'session_id required'});
  const order = db.prepare('SELECT * FROM orders WHERE stripe_session_id=?').get(session_id);
  if(!order) return res.status(404).json({error:'Order not found'});
  res.json({order:{kind:order.kind,amount_cents:order.amount_cents,currency:order.currency,status:order.status,email:order.email}});
});

app.listen(PORT, ()=>{
  console.log(`AFN portal running on ${BASE_URL}`);
  console.log(`Webhook endpoint: ${BASE_URL}/webhook/stripe`);
  console.log('Novo: set as your Stripe payout bank in Dashboard (no code needed).');
});
