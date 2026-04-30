# Rabbit Setup

![Node.js](https://img.shields.io/badge/node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)
![RabbitMQ](https://img.shields.io/badge/rabbitmq-FF6600?style=for-the-badge&logo=rabbitmq&logoColor=white)
![amqplib](https://img.shields.io/badge/amqplib-1.0-blue?style=for-the-badge&logoColor=white)

## 📌 Descripción

Script de inicialización que configura la topología de RabbitMQ para Riff. Crea el exchange centralizado `riff_events`, las colas duraderas y sus bindings automáticamente. Se ejecuta una única vez al iniciar la infraestructura antes de levantar los microservicios.

## Problema que resuelve

En una arquitectura de microservicios orientada por eventos, la topología de RabbitMQ (exchanges, queues, bindings) no debe configurarse manualmente en cada servicio. Esto genera inconsistencias, dificulta la depuración y afecta la escalabilidad. rabbit-setup garantiza que la topología sea idempotente, centralizada y reproducible en cualquier entorno.

## Responsabilidades principales

- Crear el exchange `riff_events` como topic exchange durable.
- Crear colas duraderas para cada microservicio.
- Configurar bindings entre el exchange y las colas.
- Reintentar conexión con backoff exponencial si RabbitMQ no está listo.
- Fallar rápidamente si la configuración no se puede completar.

## Flujo general

```text
docker-compose up -> RabbitMQ container starts
  
rabbit-setup starts (init container)
  - Connect to RabbitMQ (with retry)
  - Create exchange (riff_events, topic, durable)
  - Create queues (durable):
    - notifications_queue
    - content_queue
    - users_queue
  - Bind queues to exchange with routing keys
```

Una vez completada, la topología está lista para que los microservicios se conecten y comiencen a producir/consumir eventos.

## Modelo de datos

### Exchange: `riff_events`

- **Tipo**: Topic (permite pattern matching)
- **Durable**: Sí (persiste si RabbitMQ reinicia)

### Queues y Bindings

| Queue | Bindings |
|---|---|
| `notifications_queue` | `auth.tokenGenerated`, `post.created`, `event.*`, `send.resetPassword`, `follow.*` |
| `content_queue` | `auth.tokenGenerated`, `post.created`, `event.created`, `event.updated`, `event.cancelled`, `follow.*` |
| `users_queue` | `user.*`, `auth.tokenGenerated` |

Cada cola está configurada como durable, permitiendo persistencia si los consumidores están caídos.

## Decisiones técnicas

- **Topic Exchange**: Permite que los productores publiquen con routing keys específicas y los consumidores se suscriban a patrones (ej: `event.*` captura `event.created`, `event.updated`, etc).
- **Queues Duraderas**: Garantiza que eventos no se pierdan si los microservicios están caídos.
- **Retry con Backoff Exponencial**: Si RabbitMQ no está listo, el script reintenta con delays crecientes (2s, 4s, 8s... hasta 30s máximo) en lugar de fallar inmediatamente.
- **Idempotente**: Si los queues/exchanges ya existen, el script simplemente verifica que estén correctamente configurados sin errores.

## Desarrollo local

### Requisitos

- Node.js 16+
- RabbitMQ corriendo (via Docker)

### Instalación

```bash
npm install
```

### Ejecución

```bash
# Asegúrate de que RabbitMQ esté corriendo primero
RABBIT_URL=amqp://guest:guest@localhost:5672 npm start
```

### Variables de entorno

```bash
RABBIT_URL=amqp://usuario:password@host:5672
RABBIT_SETUP_MAX_ATTEMPTS=8              # Máximo de reintentos (default: 8)
RABBIT_SETUP_INITIAL_DELAY=2000          # Delay inicial en ms (default: 2000)
```

## Relación con el sistema

Este script es la **pieza fundamental de inicialización** para toda la arquitectura de eventos de Riff. Sin él, los microservicios tendrían que crear sus propias colas y bindings (acoplamiento), o la topología sería manual y frágil. rabbit-setup garantiza que:

- La topología es reproducible en cualquier entorno (local, staging, production).
- Los microservicios solo deben preocuparse por consumir o producir eventos, no por configurar infraestructura.
- Los eventos persisten aunque los servicios estén caídos (no se pierden).
- El sistema escala: agregar nuevos servicios es tan fácil como actualizar `QUEUES` en `setup.js` y redesplegando.
