const amqp = require('amqplib');

const EXCHANGE = 'riff_events';
const EXCHANGE_TYPE = 'topic';
const QUEUES = [
  {
    name: 'notifications_queue',
    bindings: [
      'auth.tokenGenerated',
      'post.created',
      'event.*',
      'send.resetPassword',
      'follow.*',
    ],
  },
  {
    name: 'content_queue',
    bindings: [
      'auth.tokenGenerated',
      'post.created',
      'event.created',
      'event.updated',
      'event.cancelled',
      'follow.*',
    ],
  },
  { name: 'users_queue', bindings: ['user.*', 'auth.tokenGenerated'] },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

async function connectWithRetry(url, opts = {}) {
  const maxAttempts = parsePositiveInt(opts.maxAttempts, 10);
  const initialDelay = parsePositiveInt(opts.initialDelay, 2000);

  if (!url) {
    throw new Error('RABBIT_URL no esta definido');
  }

  let attempt = 0;
  let lastErr;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      if (attempt > 1) {
        console.log(`Rabbit connect: intento ${attempt}/${maxAttempts}`);
      }
      return await amqp.connect(url);
    } catch (err) {
      lastErr = err;
      console.warn(
        `Conexion a Rabbit fallo en intento ${attempt}/${maxAttempts}: ${err?.message || err}`
      );

      if (attempt >= maxAttempts) {
        break;
      }

      const delay = initialDelay * Math.pow(2, attempt - 1);
      const finalDelay = Math.min(delay, 30000);
      await sleep(finalDelay);
    }
  }

  throw new Error(
    `No se pudo conectar a RabbitMQ tras ${maxAttempts} intentos: ${lastErr?.message || lastErr}`
  );
}

async function setupRabbit() {
  const rabbitUrl = process.env.RABBIT_URL;
  const maxAttempts = parsePositiveInt(
    process.env.RABBIT_SETUP_MAX_ATTEMPTS,
    8
  );
  const initialDelay = parsePositiveInt(
    process.env.RABBIT_SETUP_INITIAL_DELAY,
    2000
  );

  if (!rabbitUrl) {
    throw new Error('Falta RABBIT_URL en variables de entorno');
  }

  let conn;
  let ch;

  try {
    conn = await connectWithRetry(rabbitUrl, { maxAttempts, initialDelay });
    ch = await conn.createChannel();

    await ch.assertExchange(EXCHANGE, EXCHANGE_TYPE, { durable: true });

    for (const q of QUEUES) {
      await ch.assertQueue(q.name, { durable: true });
      for (const rk of q.bindings) {
        await ch.bindQueue(q.name, EXCHANGE, rk);
      }
    }

    console.log('Rabbit setup completed: exchange + queues + bindings created');
  } finally {
    if (ch) {
      try {
        await ch.close();
      } catch (e) {
        console.warn(`No se pudo cerrar canal Rabbit: ${e?.message || e}`);
      }
    }

    if (conn) {
      try {
        await conn.close();
      } catch (e) {
        console.warn(`No se pudo cerrar conexion Rabbit: ${e?.message || e}`);
      }
    }
  }
}

if (require.main === module) {
  setupRabbit().catch((err) => {
    console.error('Rabbit setup failed', err);
    process.exit(1);
  });
}

module.exports = { setupRabbit };