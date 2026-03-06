const amqp = require('amqplib');

const EXCHANGE = 'riff_events';
const EXCHANGE_TYPE = 'topic';
const QUEUES = [
  {
    name: 'notifications_queue',
    bindings: ['auth.tokenGenerated', 'post.created', 'event.*', 'send.resetPassword',
    'follow.*'],
  },
  {
    name: 'content_queue',
    bindings: ['auth.tokenGenerated', 'post.created', 'event.created',
        'event.updated', 'event.cancelled', 'follow.*'],
  },
  { name: 'users_queue', bindings: ['user.*', 'auth.tokenGenerated'] },
  // add more queues/bindings as needed
];

// Helper: sleep por ms
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Intentos de conexión con backoff exponencial
async function connectWithRetry(url, opts = {}) {
  const maxAttempts = opts.maxAttempts || 10;
  const initialDelay = opts.initialDelay || 2000; // ms

  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      attempt += 1;
      if (attempt > 1) {
        console.log(`Rabbit connect: intento ${attempt}/${maxAttempts}`);
      }
      // directly return the connection promise to avoid a redundant local variable
      return await amqp.connect(url);
    } catch (err) {
      console.warn(`Conexión a Rabbit falló en intento ${attempt + 1}: ${err.message || err}`);
      attempt += 1;
      if (attempt >= maxAttempts) {
        throw new Error(`No se pudo conectar a RabbitMQ tras ${maxAttempts} intentos: ${err && err.message}`);
      }
      const delay = initialDelay * Math.pow(2, attempt - 1);
      // No exceder 30s de espera entre intentos
      const finalDelay = Math.min(delay, 30000);
      await sleep(finalDelay);
    }
  }
  throw new Error('connectWithRetry: reached unreachable code');
}

async function setupRabbit() {
  // Configurables vía entorno (opcionales)
  const maxAttemptsEnv = process.env.RABBIT_SETUP_MAX_ATTEMPTS ? parseInt(process.env.RABBIT_SETUP_MAX_ATTEMPTS, 10) : undefined;
  const initialDelayEnv = process.env.RABBIT_SETUP_INITIAL_DELAY ? parseInt(process.env.RABBIT_SETUP_INITIAL_DELAY, 10) : undefined;

  const maxAttempts = Number.isInteger(maxAttemptsEnv) ? maxAttemptsEnv : 8;
  const initialDelay = Number.isInteger(initialDelayEnv) ? initialDelayEnv : 2000;

  // Usar connectWithRetry para tolerar arranques lentos del broker
  const conn = await connectWithRetry(process.env.RABBIT_URL, { maxAttempts, initialDelay });
  const ch = await conn.createChannel();

  await ch.assertExchange(EXCHANGE, EXCHANGE_TYPE, { durable: true });

  for (const q of QUEUES) {
    await ch.assertQueue(q.name, { durable: true });
    for (const rk of q.bindings) {
      await ch.bindQueue(q.name, EXCHANGE, rk);
    }
  }

  await ch.close();
  await conn.close();
  console.log('Rabbit setup completed: exchange + queues + bindings created');
}

if (require.main === module) {
  setupRabbit().catch((err) => {
    console.error('Rabbit setup failed', err);
    process.exit(1);
  });
}

module.exports = { setupRabbit };